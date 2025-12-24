/**
 * IPC handlers for worker operations.
 * Handles: runWorker, toggleWorker, setWorkerToolPreference, setWorkerRollbackOnCancel
 */

import { ipcMain } from 'electron'
import {
  getProject,
  updateProjectWorkerEnabled,
  updateProjectPolicyJson,
  createEvent,
  createJob
} from '../../db'
import { runWorker as executeWorkerPipeline } from '../../worker/pipeline'
import { startWorkerLoop, stopWorkerLoop } from '../../worker/loop'
import { parsePolicyJson, logAction } from '@shared/utils'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerWorkerHandlers(notifyRenderer: () => void): void {
  // Toggle worker
  ipcMain.handle('toggleWorker', (_e, payload: { projectId: string; enabled: boolean }) => {
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
    (_e, payload: { projectId: string; toolPreference: 'auto' | 'claude' | 'codex' }) => {
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
    (_e, payload: { projectId: string; rollbackOnCancel: boolean }) => {
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
  ipcMain.handle('runWorker', async (_e, payload: { projectId: string; cardId?: string }) => {
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
}
