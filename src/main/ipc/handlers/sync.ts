/**
 * IPC handlers for sync operations.
 * Handles: syncProject, syncScheduler management, updateSyncSettings
 */

import { ipcMain } from 'electron'
import { getProject, createJob, updateJobState, createEvent, updateProjectPolicyJson } from '../../db'
import { runSync } from '../../sync/engine'
import {
  startSyncScheduler,
  stopSyncScheduler,
  getSyncSchedulerStatus,
  getSyncSchedulerConfigFromPolicy
} from '../../sync/scheduler'
import { logAction, parsePolicyJson } from '@shared/utils'
import type { PolicyConfig } from '@shared/types'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerSyncHandlers(notifyRenderer: () => void): void {
  // Sync project (manual trigger)
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

  // Start sync scheduler for a project
  ipcMain.handle('startSyncScheduler', (_e, payload: { projectId: string }) => {
    logAction('startSyncScheduler', payload)

    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }
    if (!project.remote_repo_key) return { error: 'No remote configured' }

    const policy = parsePolicyJson(project.policy_json)
    const config = getSyncSchedulerConfigFromPolicy(policy)

    startSyncScheduler(payload.projectId, config)
    notifyRenderer()

    return { success: true }
  })

  // Stop sync scheduler for a project
  ipcMain.handle('stopSyncScheduler', (_e, payload: { projectId: string }) => {
    logAction('stopSyncScheduler', payload)
    stopSyncScheduler(payload.projectId)
    notifyRenderer()
    return { success: true }
  })

  // Get sync scheduler status
  ipcMain.handle('getSyncSchedulerStatus', (_e, payload: { projectId: string }) => {
    return getSyncSchedulerStatus(payload.projectId)
  })

  // Update sync settings
  ipcMain.handle(
    'updateSyncSettings',
    async (
      _e,
      payload: {
        projectId: string
        pollInterval?: number
        autoSyncOnAction?: boolean
      }
    ) => {
      logAction('updateSyncSettings', payload)

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      // Update policy in database
      const policy: PolicyConfig = parsePolicyJson(project.policy_json)
      policy.sync = {
        ...policy.sync,
        pollInterval: payload.pollInterval ?? policy.sync?.pollInterval,
        autoSyncOnAction: payload.autoSyncOnAction ?? policy.sync?.autoSyncOnAction
      }

      // Save updated policy
      updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))

      // Restart scheduler if running with new config
      const status = getSyncSchedulerStatus(payload.projectId)
      if (status?.running) {
        stopSyncScheduler(payload.projectId)
        const newConfig = getSyncSchedulerConfigFromPolicy(policy)
        startSyncScheduler(payload.projectId, newConfig)
      }

      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )
}
