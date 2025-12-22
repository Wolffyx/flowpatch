/**
 * Project IPC Handlers
 *
 * Handles IPC requests from the project renderer (WebContentsView):
 * - Cards
 * - Sync
 * - Worker control
 * - Events
 *
 * Each project tab has its own WebContents, so we look up the project ID
 * from the sender's webContents ID.
 */

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  listCards,
  listCardLinksByProject,
  listEvents,
  listJobs,
  getProject,
  createLocalTestCard,
  createJob,
  createEvent,
  updateJobState,
  updateProjectWorkerEnabled
} from '../db'
import { runWorker as executeWorkerPipeline } from '../worker/pipeline'
import { startWorkerLoop, stopWorkerLoop } from '../worker/loop'
import {
  getProjectIdFromWebContents,
  getTabFromWebContents,
  sendToAllTabs,
  sendToTab
} from '../tabManager'
import { logAction } from '@shared/utils'
import { runSync } from '../sync/engine'

/**
 * Helper to get project ID from the event sender.
 * Uses the webContents ID to look up which tab/project sent the request.
 */
function getProjectIdFromEvent(event: IpcMainInvokeEvent): string | null {
  const webContentsId = event.sender.id
  return getProjectIdFromWebContents(webContentsId)
}

function notifyRendererStateUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('stateUpdated')
    }
  }
  sendToAllTabs('stateUpdated')
}

// ============================================================================
// Registration
// ============================================================================

export function registerProjectHandlers(): void {
  // -------------------------------------------------------------------------
  // Cards
  // -------------------------------------------------------------------------

  ipcMain.handle('project:getCards', (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return []
    return listCards(projectId)
  })

  ipcMain.handle('project:getCardLinks', (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return []
    return listCardLinksByProject(projectId)
  })

  ipcMain.handle(
    'project:createCard',
    (event, { title }: { title: string; body?: string }) => {
      const projectId = getProjectIdFromEvent(event)
      if (!projectId) {
        throw new Error('No project selected')
      }

      logAction('project:createCard', { projectId, title })
      return createLocalTestCard(projectId, title)
    }
  )

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  ipcMain.handle('project:sync', async (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) {
      throw new Error('No project selected')
    }

    logAction('project:sync', { projectId })

    const project = getProject(projectId)
    if (!project) {
      throw new Error('Project not found')
    }
    if (!project.remote_repo_key) {
      throw new Error('No remote configured')
    }

    // Create and publish a sync job so the UI can show progress immediately.
    const job = createJob(projectId, 'sync_poll')
    createEvent(projectId, 'synced', undefined, { jobId: job.id })
    notifyRendererStateUpdated()

    const result = await runSync(projectId)

    if (result.success) {
      updateJobState(job.id, 'succeeded')
    } else {
      updateJobState(job.id, 'failed', undefined, result.error)
    }

    notifyRendererStateUpdated()

    const tab = getTabFromWebContents(event.sender.id)
    if (tab) {
      sendToTab(tab.id, 'syncComplete', { success: result.success, error: result.error })
    }

    return { success: result.success, error: result.error, job }
  })

  // -------------------------------------------------------------------------
  // Worker
  // -------------------------------------------------------------------------

  ipcMain.handle('project:isWorkerEnabled', (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return false

    const project = getProject(projectId)
    return project ? Number(project.worker_enabled) === 1 : false
  })

  ipcMain.handle('project:toggleWorker', (event, { enabled }: { enabled: boolean }) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) {
      throw new Error('No project selected')
    }

    logAction('project:toggleWorker', { projectId, enabled })
    updateProjectWorkerEnabled(projectId, enabled)

    if (enabled) {
      startWorkerLoop(projectId)
    } else {
      stopWorkerLoop(projectId)
    }

    notifyRendererStateUpdated()

    // Notify the project renderer via its tab
    const tab = getTabFromWebContents(event.sender.id)
    if (tab) {
      sendToTab(tab.id, 'workerToggled', { enabled })
    }
  })

  ipcMain.handle('project:runWorker', async (event, { cardId }: { cardId?: string }) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) {
      throw new Error('No project selected')
    }

    logAction('project:runWorker', { projectId, cardId })

    const project = getProject(projectId)
    if (!project) {
      return { error: 'Project not found' }
    }
    if (!project.remote_repo_key) {
      return { error: 'No remote configured' }
    }

    const job = createJob(projectId, 'worker_run', cardId)
    createEvent(projectId, 'worker_run', cardId, { jobId: job.id, trigger: 'manual' })
    notifyRendererStateUpdated()

    executeWorkerPipeline(job.id)
      .then(() => notifyRendererStateUpdated())
      .catch(() => notifyRendererStateUpdated())

    return { success: true, job }
  })

  ipcMain.handle('project:cancelWorker', (_event, { jobId }: { jobId: string }) => {
    logAction('project:cancelWorker', { jobId })
    // The actual cancel is handled by the existing cancelJob handler
  })

  // -------------------------------------------------------------------------
  // Jobs & Events
  // -------------------------------------------------------------------------

  ipcMain.handle('project:getJobs', (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return []
    return listJobs(projectId)
  })

  ipcMain.handle('project:getEvents', (event, { limit }: { limit?: number }) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return []
    return listEvents(projectId, limit)
  })
}
