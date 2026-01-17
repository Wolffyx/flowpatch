/**
 * IPC handlers for worker operations.
 * Handles: runWorker, toggleWorker, setWorkerToolPreference, setWorkerRollbackOnCancel
 *
 * Security: All handlers verify IPC origin to prevent unauthorized access.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import {
  getProject,
  updateProjectWorkerEnabled,
  updateProjectPolicyJson,
  createEvent,
  createJob,
  getCard
} from '../../db'
import { getWorktreeByCard } from '../../db/worktrees'
import { runWorker as executeWorkerPipeline } from '../../worker/pipeline'
import { startWorkerLoop, stopWorkerLoop } from '../../worker/loop'
import { parsePolicyJson, logAction } from '@shared/utils'
import { verifySecureRequest } from '../../security'
import { generateWorktreeBranchName } from '@shared/types'
import { checkBranchExists } from '../../worker/git-operations'
import { detectProjectType } from '../../services/project-type-detector'
import { devServerManager } from '../../services/dev-server-manager'

// ============================================================================
// Security Helpers
// ============================================================================

/**
 * Verify IPC request origin for worker operations.
 * Returns error message if verification fails, null if successful.
 */
function verifyWorkerRequest(event: IpcMainInvokeEvent, channel: string): string | null {
  const result = verifySecureRequest(event, channel)
  if (!result.valid) {
    logAction('security:workerRequestRejected', {
      channel,
      error: result.error,
      senderId: event.sender.id
    })
    return result.error ?? 'Security verification failed'
  }
  return null
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerWorkerHandlers(notifyRenderer: () => void): void {
  // Toggle worker
  ipcMain.handle('toggleWorker', (event, payload: { projectId: string; enabled: boolean }) => {
    // Security check
    const securityError = verifyWorkerRequest(event, 'toggleWorker')
    if (securityError) {
      return { error: `Security: ${securityError}` }
    }

    logAction('toggleWorker', payload)
    const project = updateProjectWorkerEnabled(payload.projectId, payload.enabled)
    if (project) {
      createEvent(payload.projectId, 'status_changed', undefined, {
        action: 'worker_toggled',
        enabled: payload.enabled
      })
      logAction('toggleWorker:updated', { projectId: payload.projectId, enabled: payload.enabled })

      // Start or stop worker loop based on toggle state
      if (payload.enabled) {
        startWorkerLoop(payload.projectId)
      } else {
        stopWorkerLoop(payload.projectId)
      }
    }
    notifyRenderer()
    return { project }
  })

  // Update worker tool preference (Claude Code vs Codex)
  ipcMain.handle(
    'setWorkerToolPreference',
    (event, payload: { projectId: string; toolPreference: 'auto' | 'claude' | 'codex' }) => {
      // Security check
      const securityError = verifyWorkerRequest(event, 'setWorkerToolPreference')
      if (securityError) {
        return { error: `Security: ${securityError}` }
      }

      logAction('setWorkerToolPreference', payload)

      const valid: Set<string> = new Set(['auto', 'claude', 'codex'])
      if (!payload?.projectId) return { error: 'Project not found' }
      if (!valid.has(payload.toolPreference)) return { error: 'Invalid tool preference' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      const policy = parsePolicyJson(project.policy_json)

      policy.worker = {
        ...policy.worker,
        toolPreference: payload.toolPreference
      }

      updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))
      createEvent(payload.projectId, 'status_changed', undefined, {
        action: 'worker_tool_preference',
        toolPreference: payload.toolPreference
      })

      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )

  // Set worker rollback on cancel
  ipcMain.handle(
    'setWorkerRollbackOnCancel',
    (event, payload: { projectId: string; rollbackOnCancel: boolean }) => {
      // Security check
      const securityError = verifyWorkerRequest(event, 'setWorkerRollbackOnCancel')
      if (securityError) {
        return { error: `Security: ${securityError}` }
      }

      logAction('setWorkerRollbackOnCancel', payload)

      if (!payload?.projectId) return { error: 'Project not found' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      const policy = parsePolicyJson(project.policy_json)

      policy.worker = {
        ...policy.worker,
        rollbackOnCancel: !!payload.rollbackOnCancel
      }

      updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))
      createEvent(payload.projectId, 'status_changed', undefined, {
        action: 'worker_rollback_on_cancel',
        rollbackOnCancel: !!payload.rollbackOnCancel
      })

      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )

  // Run worker
  ipcMain.handle('runWorker', async (event, payload: { projectId: string; cardId?: string }) => {
    // Security check - this is a critical operation
    const securityError = verifyWorkerRequest(event, 'runWorker')
    if (securityError) {
      return { error: `Security: ${securityError}` }
    }

    logAction('runWorker', payload)
    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }
    if (!project.remote_repo_key) return { error: 'No remote configured' }

    // Create a worker job
    const job = createJob(payload.projectId, 'worker_run', payload.cardId)
    createEvent(payload.projectId, 'worker_run', payload.cardId, { jobId: job.id })
    logAction('runWorker:queued', { projectId: payload.projectId, jobId: job.id })

    // Execute worker asynchronously (don't block IPC response)
    executeWorkerPipeline(job.id)
      .then((result) => {
        logAction('runWorker:complete', {
          jobId: job.id,
          success: result.success,
          phase: result.phase,
          prUrl: result.prUrl
        })
        notifyRenderer()
      })
      .catch((err) => {
        logAction('runWorker:error', {
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err)
        })
        notifyRenderer()
      })

    notifyRenderer()
    return { success: true, job }
  })

  // Get card test info (branch, worktree, project type, commands)
  ipcMain.handle(
    'getCardTestInfo',
    async (event, payload: { projectId: string; cardId: string }) => {
      const securityError = verifyWorkerRequest(event, 'getCardTestInfo')
      if (securityError) {
        return { error: `Security: ${securityError}` }
      }

      try {
        const project = getProject(payload.projectId)
        if (!project) {
          return { error: 'Project not found' }
        }

        const card = getCard(payload.cardId)
        if (!card) {
          return { error: 'Card not found' }
        }

        // Check for worktree first
        const worktree = getWorktreeByCard(payload.cardId)
        let workingDir: string
        let branchName: string | null = null
        let hasWorktree = false

        if (worktree && worktree.status !== 'cleaned' && worktree.status !== 'error') {
          hasWorktree = true
          workingDir = worktree.worktree_path
          branchName = worktree.branch_name
        } else {
          // No worktree, check for branch
          workingDir = project.local_path
          const policy = parsePolicyJson(project.policy_json)
          const branchPrefix = policy.worker?.worktree?.branchPrefix ?? 'flowpatch/'
          branchName = generateWorktreeBranchName(
            card.provider,
            card.remote_number_or_iid,
            card.title,
            branchPrefix
          )

          // Check if branch exists
          const branchCheck = await checkBranchExists(project.local_path, branchName)
          if (!branchCheck.localExists && !branchCheck.remoteExists) {
            branchName = null
          }
        }

        // Detect project type
        const projectType = detectProjectType(workingDir)

        // Parse commands
        const commands: { install?: string; dev?: string; build?: string } = {}
        if (projectType.installCommand) {
          commands.install = projectType.installCommand
        }
        if (projectType.devCommand) {
          commands.dev = projectType.devCommand
        }
        if (projectType.buildCommand) {
          commands.build = projectType.buildCommand
        }

        return {
          success: true,
          hasWorktree,
          worktreePath: hasWorktree ? workingDir : undefined,
          branchName,
          repoPath: project.local_path,
          projectType: {
            type: projectType.type,
            hasPackageJson: projectType.hasPackageJson,
            port: projectType.port
          },
          commands
        }
      } catch (error) {
        logAction('getCardTestInfo:error', {
          projectId: payload.projectId,
          cardId: payload.cardId,
          error: error instanceof Error ? error.message : String(error)
        })
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // Start dev server
  ipcMain.handle(
    'startDevServer',
    async (
      event,
      payload: {
        projectId: string
        cardId: string
        workingDir: string
        command: string
        args: string[]
        env?: Record<string, string>
      }
    ) => {
      const securityError = verifyWorkerRequest(event, 'startDevServer')
      if (securityError) {
        return { error: `Security: ${securityError}` }
      }

      try {
        logAction('startDevServer', { projectId: payload.projectId, cardId: payload.cardId })

        const processInfo = await devServerManager.startServer({
          cardId: payload.cardId,
          projectId: payload.projectId,
          workingDir: payload.workingDir,
          command: payload.command,
          args: payload.args,
          env: payload.env
        })

        return {
          success: true,
          status: processInfo.status,
          port: processInfo.port
        }
      } catch (error) {
        logAction('startDevServer:error', {
          projectId: payload.projectId,
          cardId: payload.cardId,
          error: error instanceof Error ? error.message : String(error)
        })
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // Stop dev server
  ipcMain.handle('stopDevServer', async (event, payload: { cardId: string }) => {
    const securityError = verifyWorkerRequest(event, 'stopDevServer')
    if (securityError) {
      return { error: `Security: ${securityError}` }
    }

    try {
      logAction('stopDevServer', { cardId: payload.cardId })
      await devServerManager.stopServer(payload.cardId)
      return { success: true }
    } catch (error) {
      logAction('stopDevServer:error', {
        cardId: payload.cardId,
        error: error instanceof Error ? error.message : String(error)
      })
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Get dev server status
  ipcMain.handle('getDevServerStatus', (event, payload: { cardId: string }) => {
    const securityError = verifyWorkerRequest(event, 'getDevServerStatus')
    if (securityError) {
      return { error: `Security: ${securityError}` }
    }

    const status = devServerManager.getStatus(payload.cardId)
    if (!status) {
      return { success: false, status: null }
    }

    return {
      success: true,
      status: status.status,
      port: status.port,
      startedAt: status.startedAt.toISOString(),
      error: status.error,
      output: status.output.slice(-100) // Last 100 lines
    }
  })
}
