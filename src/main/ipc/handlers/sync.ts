/**
 * IPC handlers for sync operations.
 * Handles: syncProject
 */

import { ipcMain } from 'electron'
import { getProject, createJob, updateJobState, createEvent } from '../../db'
import { runSync } from '../../sync/engine'
import { logAction } from '@shared/utils'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerSyncHandlers(notifyRenderer: () => void): void {
  // Sync project
  ipcMain.handle('syncProject', async (_e, payload: { projectId: string }) => {
    logAction('syncProject:start', payload)
    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }
    if (!project.remote_repo_key) return { error: 'No remote configured' }

    // Create a sync job
    const job = createJob(payload.projectId, 'sync_poll')
    createEvent(payload.projectId, 'synced', undefined, { jobId: job.id })

    // Run the sync
    const result = await runSync(payload.projectId)
    logAction('syncProject:finished', {
      projectId: payload.projectId,
      success: result.success,
      error: result.error
    })

    // Update job state
    if (result.success) {
      updateJobState(job.id, 'succeeded')
    } else {
      updateJobState(job.id, 'failed', undefined, result.error)
    }

    notifyRenderer()
    return { success: result.success, error: result.error, job }
  })
}
