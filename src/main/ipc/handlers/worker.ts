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
  getCard,
  deleteFailedWorkerRunJobsForCard,
  updateCardTimestamp
} from '../../db'
import { getWorktreeByCard } from '../../db/worktrees'
import { runWorker as executeWorkerPipeline } from '../../worker/pipeline'
import { startWorkerLoop, stopWorkerLoop } from '../../worker/loop'
import {
  getWorkerStatus,
  clearErrorStatus,
  getErrorHistory,
  clearErrorHistory
} from '../../worker/worker-status-store'
import { wakeUpWorkerLoop } from '../../worker/loop'
import { updateCardStatus } from '../../db'
import { parsePolicyJson, logAction } from '@shared/utils'
import { verifySecureRequest } from '../../security'
import { generateWorktreeBranchName } from '@shared/types'
import type {
  ProjectWorkerStatus,
  WorkerError,
  TestLocation,
  ManualTestInfo,
  PrepareTestEnvironmentResult
} from '@shared/types'
import { checkBranchExists } from '../../worker/git-operations'
import { detectProjectType } from '../../services/project-type-detector'
import { devServerManager } from '../../services/dev-server-manager'
import {
  GitWorktreeManager,
  type WorktreeConfig
} from '../../services/git-worktree-manager'
import {
  createWorktree as createWorktreeRecord,
  updateWorktreeStatus
} from '../../db/worktrees'

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

    if (payload.cardId) {
      const card = getCard(payload.cardId, payload.projectId)
      if (!card) {
        logAction('runWorker:cardNotFound', {
          projectId: payload.projectId,
          cardId: payload.cardId
        })
      } else {
        deleteFailedWorkerRunJobsForCard(payload.cardId, payload.projectId)
        updateCardTimestamp(payload.cardId, new Date().toISOString(), payload.projectId)
        logAction('runWorker:clearedFailedJobs', {
          projectId: payload.projectId,
          cardId: payload.cardId
        })
      }
    }

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
    async (
      event,
      payload: { projectId: string; cardId: string }
    ): Promise<ManualTestInfo | { error: string }> => {
      const securityError = verifyWorkerRequest(event, 'getCardTestInfo')
      if (securityError) {
        return { error: `Security: ${securityError}` }
      }

      try {
        const project = getProject(payload.projectId)
        if (!project) {
          return {
            success: false,
            error: 'Project not found',
            hasWorktree: false,
            branchName: null,
            branchExistsLocal: false,
            branchExistsRemote: false,
            repoPath: '',
            canRecreateWorktree: false,
            canCheckoutInMainRepo: false
          }
        }

        const card = getCard(payload.cardId)
        if (!card) {
          return {
            success: false,
            error: 'Card not found',
            hasWorktree: false,
            branchName: null,
            branchExistsLocal: false,
            branchExistsRemote: false,
            repoPath: project.local_path,
            canRecreateWorktree: false,
            canCheckoutInMainRepo: false
          }
        }

        const policy = parsePolicyJson(project.policy_json)
        const branchPrefix = policy.worker?.worktree?.branchPrefix ?? 'flowpatch/'

        // Generate expected branch name
        const branchName = generateWorktreeBranchName(
          card.provider,
          card.remote_number_or_iid,
          card.title,
          branchPrefix
        )

        // Check for worktree
        const worktree = getWorktreeByCard(payload.cardId)
        let hasWorktree = false
        let worktreePath: string | undefined

        if (worktree && worktree.status !== 'cleaned' && worktree.status !== 'error') {
          // Verify worktree is actually healthy
          const worktreeManager = new GitWorktreeManager(project.local_path)
          const health = worktreeManager.verifyWorktree(
            worktree.worktree_path,
            worktree.branch_name
          )
          if (health.healthy) {
            hasWorktree = true
            worktreePath = worktree.worktree_path
          }
        }

        // Check branch existence
        const branchCheck = await checkBranchExists(project.local_path, branchName)
        const branchExistsLocal = branchCheck.localExists
        const branchExistsRemote = branchCheck.remoteExists
        const branchExists = branchExistsLocal || branchExistsRemote

        // Determine what actions are available
        const canRecreateWorktree = !hasWorktree && branchExists
        const canCheckoutInMainRepo = branchExists

        // Detect project type from worktree if available, otherwise main repo
        const workingDir = hasWorktree && worktreePath ? worktreePath : project.local_path
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
          worktreePath,
          branchName: branchExists ? branchName : null,
          branchExistsLocal,
          branchExistsRemote,
          repoPath: project.local_path,
          projectType: {
            type: projectType.type,
            hasPackageJson: projectType.hasPackageJson,
            port: projectType.port
          },
          commands,
          canRecreateWorktree,
          canCheckoutInMainRepo
        }
      } catch (error) {
        logAction('getCardTestInfo:error', {
          projectId: payload.projectId,
          cardId: payload.cardId,
          error: error instanceof Error ? error.message : String(error)
        })
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          hasWorktree: false,
          branchName: null,
          branchExistsLocal: false,
          branchExistsRemote: false,
          repoPath: '',
          canRecreateWorktree: false,
          canCheckoutInMainRepo: false
        }
      }
    }
  )

  // Prepare test environment (recreate worktree or checkout branch in main repo)
  ipcMain.handle(
    'prepareTestEnvironment',
    async (
      event,
      payload: { projectId: string; cardId: string; location: TestLocation }
    ): Promise<PrepareTestEnvironmentResult> => {
      const securityError = verifyWorkerRequest(event, 'prepareTestEnvironment')
      if (securityError) {
        return { success: false, error: `Security: ${securityError}` }
      }

      try {
        logAction('prepareTestEnvironment', {
          projectId: payload.projectId,
          cardId: payload.cardId,
          location: payload.location
        })

        const project = getProject(payload.projectId)
        if (!project) {
          return { success: false, error: 'Project not found' }
        }

        const card = getCard(payload.cardId)
        if (!card) {
          return { success: false, error: 'Card not found' }
        }

        const policy = parsePolicyJson(project.policy_json)
        const branchPrefix = policy.worker?.worktree?.branchPrefix ?? 'flowpatch/'
        const branchName = generateWorktreeBranchName(
          card.provider,
          card.remote_number_or_iid,
          card.title,
          branchPrefix
        )

        // Check branch exists
        const branchCheck = await checkBranchExists(project.local_path, branchName)
        if (!branchCheck.localExists && !branchCheck.remoteExists) {
          return {
            success: false,
            error: `Branch ${branchName} not found locally or on remote`
          }
        }

        const worktreeManager = new GitWorktreeManager(project.local_path)

        if (payload.location === 'worktree') {
          // Recreate or reuse worktree
          const wtConfig: WorktreeConfig = {
            root: policy.worker?.worktree?.root ?? 'repo',
            customPath: policy.worker?.worktree?.customPath
          }
          const worktreePath = worktreeManager.computeWorktreePath(branchName, wtConfig)
          const baseBranch =
            policy.worker?.baseBranch || policy.worker?.worktree?.baseBranch || 'main'

          const result = await worktreeManager.ensureWorktree(
            worktreePath,
            branchName,
            baseBranch,
            {
              fetchFirst: true,
              config: wtConfig
            }
          )

          // Update or create DB record
          let worktreeRecord = getWorktreeByCard(payload.cardId, payload.projectId)
          if (worktreeRecord) {
            updateWorktreeStatus(worktreeRecord.id, 'ready', undefined, payload.projectId)
          } else {
            createWorktreeRecord({
              projectId: payload.projectId,
              cardId: payload.cardId,
              worktreePath: result.worktreePath,
              branchName: result.branchName,
              baseRef: baseBranch,
              status: 'ready'
            })
          }

          logAction('prepareTestEnvironment:worktreeCreated', {
            projectId: payload.projectId,
            cardId: payload.cardId,
            worktreePath: result.worktreePath,
            created: result.created
          })

          return {
            success: true,
            workingDir: result.worktreePath,
            branchName: result.branchName,
            location: 'worktree',
            wasRecreated: result.created
          }
        } else {
          // Checkout branch in main repo
          // Check if working tree is clean first
          if (worktreeManager.isDirty(project.local_path)) {
            return {
              success: false,
              error:
                'Main repository has uncommitted changes. Please commit or stash them first.'
            }
          }

          // Checkout the branch
          try {
            const { execSync } = await import('child_process')
            execSync(`git checkout "${branchName}"`, {
              cwd: project.local_path,
              encoding: 'utf-8',
              windowsHide: true
            })

            logAction('prepareTestEnvironment:checkedOut', {
              projectId: payload.projectId,
              cardId: payload.cardId,
              branchName
            })

            return {
              success: true,
              workingDir: project.local_path,
              branchName,
              location: 'mainRepo',
              wasRecreated: false
            }
          } catch (err) {
            return {
              success: false,
              error: `Failed to checkout branch: ${err instanceof Error ? err.message : String(err)}`
            }
          }
        }
      } catch (error) {
        logAction('prepareTestEnvironment:error', {
          projectId: payload.projectId,
          cardId: payload.cardId,
          error: error instanceof Error ? error.message : String(error)
        })
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
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

  // Get unified worker status for a project
  ipcMain.handle(
    'worker:getStatus',
    (event, projectId: string): ProjectWorkerStatus | null => {
      const securityError = verifyWorkerRequest(event, 'worker:getStatus')
      if (securityError) {
        return null
      }

      const project = getProject(projectId)
      if (!project) return null

      return {
        projectId,
        workerEnabled: project.worker_enabled === 1,
        status: getWorkerStatus(projectId)
      }
    }
  )

  // Clear error status back to idle
  ipcMain.handle('worker:clearErrorStatus', (event, projectId: string): boolean => {
    const securityError = verifyWorkerRequest(event, 'worker:clearErrorStatus')
    if (securityError) return false

    clearErrorStatus(projectId)
    return true
  })

  // Get error history for a project
  ipcMain.handle('worker:getErrorHistory', (event, projectId: string): WorkerError[] => {
    const securityError = verifyWorkerRequest(event, 'worker:getErrorHistory')
    if (securityError) return []

    return getErrorHistory(projectId)
  })

  // Clear error history for a project
  ipcMain.handle('worker:clearErrorHistory', (event, projectId: string): boolean => {
    const securityError = verifyWorkerRequest(event, 'worker:clearErrorHistory')
    if (securityError) return false

    clearErrorHistory(projectId)
    return true
  })

  // Retry last failed card
  ipcMain.handle(
    'worker:retryLastFailed',
    async (
      event,
      projectId: string
    ): Promise<{ success: boolean; cardId?: string; error?: string }> => {
      const securityError = verifyWorkerRequest(event, 'worker:retryLastFailed')
      if (securityError) return { success: false, error: 'Security error' }

      const status = getWorkerStatus(projectId)
      if (!status.lastFailedCardId) {
        return { success: false, error: 'No failed card to retry' }
      }

      const card = getCard(status.lastFailedCardId)
      if (!card) {
        return { success: false, error: 'Card not found' }
      }

      // Clear error status first
      clearErrorStatus(projectId)

      // Move card to ready if not already
      if (card.status !== 'ready') {
        updateCardStatus(card.id, 'ready', projectId)
      }

      // Wake up worker to process
      wakeUpWorkerLoop(projectId)

      return { success: true, cardId: card.id }
    }
  )
}
