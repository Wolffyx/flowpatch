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
 * 
 * Security: All worker-related handlers verify IPC origin to prevent unauthorized access.
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
import { verifySecureRequest } from '../security'
import { runSync } from '../sync/engine'
import {
  ensureFlowPatchWorkspace,
  getFlowPatchWorkspaceStatus
} from '../services/flowpatch-workspace'
import { buildIndex } from '../services/flowpatch-indexer'
import {
  ensureProjectRegistered,
  registerProject,
  requestIndexNow,
  setProjectIndexingEnabled
} from '../services/flowpatch-index-scheduler'
import { readFlowPatchConfig } from '../services/flowpatch-config'
import { retrieveSymbols, retrieveText } from '../services/flowpatch-retrieve'
import { refreshFlowPatchDocs } from '../services/flowpatch-docs'
import { buildContextBundle, writeLastContext } from '../services/flowpatch-context'
import { join } from 'path'
import { shell } from 'electron'
import type { JobResultEnvelope } from '@shared/types'
import { getResolvedBool, setProjectOverride } from '../settingsStore'

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

/**
 * Verify IPC request origin for security-sensitive operations.
 * Returns error message if verification fails, null if successful.
 */
function verifyProjectRequest(event: IpcMainInvokeEvent, channel: string): string | null {
  const result = verifySecureRequest(event, channel)
  if (!result.valid) {
    logAction('security:projectRequestRejected', {
      channel,
      error: result.error,
      senderId: event.sender.id
    })
    return result.error ?? 'Security verification failed'
  }
  return null
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

  ipcMain.handle('project:createCard', (event, { title }: { title: string; body?: string }) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) {
      throw new Error('No project selected')
    }

    logAction('project:createCard', { projectId, title })
    return createLocalTestCard(projectId, title)
  })

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
    // Security check
    const securityError = verifyProjectRequest(event, 'project:toggleWorker')
    if (securityError) {
      return { error: `Security: ${securityError}` }
    }

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

    return { success: true }
  })

  ipcMain.handle('project:runWorker', async (event, { cardId }: { cardId?: string }) => {
    // Security check - this is a critical operation
    const securityError = verifyProjectRequest(event, 'project:runWorker')
    if (securityError) {
      return { error: `Security: ${securityError}` }
    }

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

  ipcMain.handle('project:cancelWorker', (event, { jobId }: { jobId: string }) => {
    // Security check
    const securityError = verifyProjectRequest(event, 'project:cancelWorker')
    if (securityError) {
      return { error: `Security: ${securityError}` }
    }

    logAction('project:cancelWorker', { jobId })
    // The actual cancel is handled by the existing cancelJob handler
    return { success: true }
  })

  // -------------------------------------------------------------------------
  // Jobs & Events
  // -------------------------------------------------------------------------

  ipcMain.handle('project:getJobs', (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return []
    return listJobs(projectId)
  })

  // -------------------------------------------------------------------------
  // FlowPatch Workspace (.flowpatch)
  // -------------------------------------------------------------------------

  ipcMain.handle('project:getWorkspaceStatus', async (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return null
    const project = getProject(projectId)
    if (!project) return null
    const status = await getFlowPatchWorkspaceStatus(project.local_path)
    return { ...status, autoIndexingEnabled: getResolvedBool(projectId, 'index.autoIndexingEnabled') }
  })

  ipcMain.handle('project:getFlowPatchConfig', (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return null
    const project = getProject(projectId)
    if (!project) return null
    const { config, diagnostics } = readFlowPatchConfig(project.local_path)
    return { config, diagnostics }
  })

  ipcMain.handle('project:ensureWorkspace', async (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const job = createJob(projectId, 'workspace_ensure')
    notifyRendererStateUpdated()

    try {
      updateJobState(job.id, 'running')
      notifyRendererStateUpdated()

      const statusBefore = await getFlowPatchWorkspaceStatus(project.local_path)
      if (!statusBefore.writable) {
        const result: JobResultEnvelope = { summary: 'Repo not writable' }
        updateJobState(job.id, 'blocked', result, 'Repo not writable')
        notifyRendererStateUpdated()
        return { success: false, blocked: true, job }
      }

      const ensured = ensureFlowPatchWorkspace(project.local_path)
      const result: JobResultEnvelope = {
        summary:
          ensured.createdPaths.length > 0
            ? 'Workspace created/updated'
            : 'Workspace already present',
        artifacts: {
          createdPaths: ensured.createdPaths,
          updatedGitignore: ensured.updatedGitignore
        }
      }
      updateJobState(job.id, 'succeeded', result)
      notifyRendererStateUpdated()
      return { success: true, job }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to ensure workspace'
      updateJobState(job.id, 'failed', { summary: message } satisfies JobResultEnvelope, message)
      notifyRendererStateUpdated()
      return { success: false, error: message, job }
    }
  })

  ipcMain.handle('project:indexBuild', async (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const job = createJob(projectId, 'index_build')
    notifyRendererStateUpdated()

    try {
      const status = await getFlowPatchWorkspaceStatus(project.local_path)
      if (!status.writable) {
        updateJobState(
          job.id,
          'blocked',
          { summary: 'Repo not writable' } satisfies JobResultEnvelope,
          'Repo not writable'
        )
        notifyRendererStateUpdated()
        return { success: false, blocked: true, job }
      }

      // Ensure workspace exists before indexing
      ensureFlowPatchWorkspace(project.local_path)

      updateJobState(job.id, 'running', {
        progress: { stage: 'Scanning files' }
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()

      const { meta } = await buildIndex(project.local_path)
      const result: JobResultEnvelope = {
        summary: `Indexed ${meta.totalFiles} files`,
        artifacts: meta
      }
      updateJobState(job.id, 'succeeded', result)
      notifyRendererStateUpdated()
      return { success: true, job }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build index'
      if (message.toLowerCase().includes('already running')) {
        updateJobState(
          job.id,
          'blocked',
          { summary: 'Index already running' } satisfies JobResultEnvelope,
          message
        )
      } else {
        updateJobState(job.id, 'failed', { summary: message } satisfies JobResultEnvelope, message)
      }
      notifyRendererStateUpdated()
      return { success: false, error: message, job }
    }
  })

  ipcMain.handle('project:indexRefresh', async (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const job = createJob(projectId, 'index_refresh')
    notifyRendererStateUpdated()

    try {
      const status = await getFlowPatchWorkspaceStatus(project.local_path)
      if (!status.writable) {
        updateJobState(
          job.id,
          'blocked',
          { summary: 'Repo not writable' } satisfies JobResultEnvelope,
          'Repo not writable'
        )
        notifyRendererStateUpdated()
        return { success: false, blocked: true, job }
      }

      ensureFlowPatchWorkspace(project.local_path)
      updateJobState(job.id, 'running', {
        progress: { stage: 'Refreshing index' }
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()

      const { meta } = await buildIndex(project.local_path)
      const result: JobResultEnvelope = {
        summary: `Refreshed index (${meta.totalFiles} files)`,
        artifacts: meta
      }
      updateJobState(job.id, 'succeeded', result)
      notifyRendererStateUpdated()
      return { success: true, job }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh index'
      if (message.toLowerCase().includes('already running')) {
        updateJobState(
          job.id,
          'blocked',
          { summary: 'Index already running' } satisfies JobResultEnvelope,
          message
        )
      } else {
        updateJobState(job.id, 'failed', { summary: message } satisfies JobResultEnvelope, message)
      }
      notifyRendererStateUpdated()
      return { success: false, error: message, job }
    }
  })

  ipcMain.handle('project:indexWatchStart', async (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const job = createJob(projectId, 'index_watch_start')
    notifyRendererStateUpdated()

    try {
      const status = await getFlowPatchWorkspaceStatus(project.local_path)
      if (!status.writable) {
        updateJobState(
          job.id,
          'blocked',
          { summary: 'Repo not writable' } satisfies JobResultEnvelope,
          'Repo not writable'
        )
        notifyRendererStateUpdated()
        return { success: false, blocked: true, job }
      }

      ensureFlowPatchWorkspace(project.local_path)
      updateJobState(job.id, 'running', { summary: 'Starting watch…' } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()

      setProjectOverride(projectId, 'index.autoIndexingEnabled', 'true')
      registerProject(projectId, project.local_path)
      requestIndexNow(projectId, 'manual:watchStart')

      updateJobState(job.id, 'succeeded', {
        summary: 'Auto indexing enabled'
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()
      return { success: true, job, managed: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start watch'
      updateJobState(job.id, 'failed', { summary: message } satisfies JobResultEnvelope, message)
      notifyRendererStateUpdated()
      return { success: false, error: message, job }
    }
  })

  ipcMain.handle('project:indexWatchStop', (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const job = createJob(projectId, 'index_watch_stop')
    notifyRendererStateUpdated()

    try {
      updateJobState(job.id, 'running', {
        summary: 'Stopping auto indexing...'
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()

      setProjectOverride(projectId, 'index.autoIndexingEnabled', 'false')
      ensureProjectRegistered(projectId, project.local_path)
      setProjectIndexingEnabled(projectId, false)

      updateJobState(job.id, 'succeeded', {
        summary: 'Auto indexing disabled'
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()
      return { success: true, job }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop watch'
      updateJobState(job.id, 'failed', { summary: message } satisfies JobResultEnvelope, message)
      notifyRendererStateUpdated()
      return { success: false, error: message, job }
    }
  })

  ipcMain.handle('project:validateConfig', (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const job = createJob(projectId, 'config_validate')
    notifyRendererStateUpdated()

    try {
      updateJobState(job.id, 'running', {
        summary: 'Validating config…'
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()

      const { diagnostics: diag, config } = readFlowPatchConfig(project.local_path)
      const diagnostics: { level: 'error' | 'warning'; message: string }[] = [
        ...diag.errors.map((m) => ({ level: 'error' as const, message: m })),
        ...diag.warnings.map((m) => ({ level: 'warning' as const, message: m }))
      ]

      const hasErrors = diagnostics.some((d) => d.level === 'error')
      const result: JobResultEnvelope = {
        summary: hasErrors ? 'Config has errors' : 'Config OK',
        artifacts: { diagnostics, config }
      }
      updateJobState(
        job.id,
        hasErrors ? 'failed' : 'succeeded',
        result,
        hasErrors ? 'Config validation failed' : undefined
      )
      notifyRendererStateUpdated()
      return { success: !hasErrors, diagnostics, job }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate config'
      updateJobState(job.id, 'failed', { summary: message } satisfies JobResultEnvelope, message)
      notifyRendererStateUpdated()
      return { success: false, error: message, job }
    }
  })

  ipcMain.handle('project:docsRefresh', async (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const job = createJob(projectId, 'docs_refresh')
    notifyRendererStateUpdated()

    try {
      updateJobState(job.id, 'running', { summary: 'Refreshing docs…' } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()
      const status = await getFlowPatchWorkspaceStatus(project.local_path)
      if (!status.writable) {
        updateJobState(
          job.id,
          'blocked',
          { summary: 'Repo not writable' } satisfies JobResultEnvelope,
          'Repo not writable'
        )
        notifyRendererStateUpdated()
        return { success: false, blocked: true, job }
      }
      ensureFlowPatchWorkspace(project.local_path)
      await buildIndex(project.local_path)
      const { updated } = await refreshFlowPatchDocs(project.local_path)
      updateJobState(job.id, 'succeeded', {
        summary: `Docs refresh completed (${updated.length} updated)`,
        artifacts: { updated }
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()
      return { success: true, job }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh docs'
      updateJobState(job.id, 'failed', { summary: message } satisfies JobResultEnvelope, message)
      notifyRendererStateUpdated()
      return { success: false, error: message, job }
    }
  })

  ipcMain.handle('project:contextPreview', async (event, { task }: { task: string }) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const job = createJob(projectId, 'context_preview', undefined, { task })
    notifyRendererStateUpdated()

    try {
      const status = await getFlowPatchWorkspaceStatus(project.local_path)
      if (!status.writable) {
        updateJobState(
          job.id,
          'blocked',
          { summary: 'Repo not writable' } satisfies JobResultEnvelope,
          'Repo not writable'
        )
        notifyRendererStateUpdated()
        return { success: false, blocked: true, job }
      }

      ensureFlowPatchWorkspace(project.local_path)
      updateJobState(job.id, 'running', {
        summary: 'Building preview…'
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()

      const bundle = await buildContextBundle(project.local_path, task)
      const previewPath = writeLastContext(project.local_path, bundle)
      updateJobState(job.id, 'succeeded', {
        summary: `Preview includes ${bundle.totals.includedFiles} files`,
        artifacts: { previewPath, ...bundle }
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()
      return { success: true, preview: bundle, job }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to preview context'
      updateJobState(job.id, 'failed', { summary: message } satisfies JobResultEnvelope, message)
      notifyRendererStateUpdated()
      return { success: false, error: message, job }
    }
  })

  ipcMain.handle(
    'project:retrieve',
    async (event, payload: { kind: 'symbol' | 'text'; query: string; limit?: number }) => {
      const projectId = getProjectIdFromEvent(event)
      if (!projectId) throw new Error('No project selected')
      const project = getProject(projectId)
      if (!project) throw new Error('Project not found')

      const status = await getFlowPatchWorkspaceStatus(project.local_path)
      if (!status.writable) return { error: 'Repo not writable' }

      ensureFlowPatchWorkspace(project.local_path)
      try {
        await buildIndex(project.local_path)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!msg.toLowerCase().includes('already running')) throw e
      }

      const limit = Math.min(50, Math.max(1, payload.limit ?? 20))
      if (payload.kind === 'symbol') {
        return { matches: retrieveSymbols(project.local_path, payload.query, limit) }
      }
      return { matches: retrieveText(project.local_path, payload.query, limit) }
    }
  )

  ipcMain.handle('project:repairWorkspace', async (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const job = createJob(projectId, 'repair')
    notifyRendererStateUpdated()

    try {
      updateJobState(job.id, 'running', { summary: 'Repairing…' } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()

      const statusBefore = await getFlowPatchWorkspaceStatus(project.local_path)
      if (!statusBefore.writable) {
        updateJobState(
          job.id,
          'blocked',
          { summary: 'Repo not writable' } satisfies JobResultEnvelope,
          'Repo not writable'
        )
        notifyRendererStateUpdated()
        return { success: false, blocked: true, job }
      }

      const ensured = ensureFlowPatchWorkspace(project.local_path)
      updateJobState(job.id, 'succeeded', {
        summary: 'Repair completed',
        artifacts: { createdPaths: ensured.createdPaths }
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()
      return { success: true, job }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to repair workspace'
      updateJobState(job.id, 'failed', { summary: message } satisfies JobResultEnvelope, message)
      notifyRendererStateUpdated()
      return { success: false, error: message, job }
    }
  })

  ipcMain.handle('project:migrateWorkspace', (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const job = createJob(projectId, 'migrate')
    notifyRendererStateUpdated()

    try {
      updateJobState(job.id, 'running', { summary: 'Migrating…' } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()
      // Placeholder migration - schemaVersion upgrades to be added.
      updateJobState(job.id, 'succeeded', {
        summary: 'No migrations needed'
      } satisfies JobResultEnvelope)
      notifyRendererStateUpdated()
      return { success: true, job }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to migrate workspace'
      updateJobState(job.id, 'failed', { summary: message } satisfies JobResultEnvelope, message)
      notifyRendererStateUpdated()
      return { success: false, error: message, job }
    }
  })

  ipcMain.handle('project:openWorkspaceFolder', (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')
    const path = join(project.local_path, '.flowpatch')
    void shell.openPath(path)
    return { success: true }
  })

  ipcMain.handle('project:getEvents', (event, { limit }: { limit?: number }) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return []
    return listEvents(projectId, limit)
  })
}
