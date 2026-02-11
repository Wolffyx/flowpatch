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
  listCardEvents,
  listJobs,
  getProject,
  createLocalTestCard,
  createJob,
  createEvent,
  updateJobState,
  updateProjectWorkerEnabled,
  getUsageRecordsByCard,
  getCard,
  updateCardStatus,
  updateCardLabels,
  checkCanMoveToStatus,
  getActiveWorkerJobForCard,
  cancelJob,
  resetWorkerState,
  deleteFailedWorkerRunJobsForCard
} from '../db'
import { runWorker as executeWorkerPipeline } from '../worker/pipeline'
import { startWorkerLoop, stopWorkerLoop, wakeUpWorkerLoop } from '../worker/loop'
import {
  getProjectIdFromWebContents,
  getTabFromWebContents,
  sendToAllTabs,
  sendToTab
} from '../tabManager'
import { parsePolicyJson, getStatusLabelFromPolicy, getAllStatusLabelsFromPolicy } from '@shared/utils'
import { logAction } from '../utils/main-logger'
import { verifySecureRequest } from '../security'
import { runSync, SyncEngine } from '../sync/engine'
import { triggerProjectSync } from '../sync/scheduler'
import type { CardStatus } from '@shared/types'
import {
  ensureFlowPatchWorkspace,
  getFlowPatchWorkspaceStatus,
  createPlanFile
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

  ipcMain.handle(
    'project:moveCard',
    async (
      event,
      payload: {
        cardId: string
        status: CardStatus
        skipDependencyCheck?: boolean
      }
    ) => {
      const projectId = getProjectIdFromEvent(event)
      if (!projectId) {
        throw new Error('No project selected')
      }

      // Check dependencies unless explicitly skipped
      if (!payload.skipDependencyCheck) {
        const dependencyCheck = checkCanMoveToStatus(payload.cardId, payload.status, projectId)
        if (!dependencyCheck.canMove) {
          logAction('project:moveCard:blocked_by_dependencies', {
            cardId: payload.cardId,
            projectId,
            targetStatus: payload.status,
            blockedBy: dependencyCheck.blockedBy.map((b) => b.depends_on_card_id)
          })
          return {
            card: null,
            error: dependencyCheck.reason ?? 'Blocked by dependencies',
            blockedByDependencies: dependencyCheck.blockedBy
          }
        }
      }

      // Get card with projectId to ensure we check the right DB
      const before = getCard(payload.cardId, projectId)
      if (!before) {
        logAction('project:moveCard:card_not_found', {
          cardId: payload.cardId,
          projectId
        })
        return {
          card: null,
          error: 'Card not found'
        }
      }

      logAction('project:moveCard:before_update', {
        cardId: payload.cardId,
        projectId,
        fromStatus: before.status,
        toStatus: payload.status
      })

      const card = updateCardStatus(payload.cardId, payload.status, projectId)
      if (card) {
        logAction('project:moveCard', { cardId: payload.cardId, projectId, status: payload.status })
        createEvent(projectId, 'status_changed', card.id, {
          from: before?.status,
          to: payload.status
        })

        // Update local labels to reflect new status
        const project = getProject(projectId)
        if (project) {
          const policy = parsePolicyJson(project.policy_json)

          // Get current labels
          const currentLabels: string[] = card.labels_json ? JSON.parse(card.labels_json) : []

          // Get status label configuration
          const newStatusLabel = getStatusLabelFromPolicy(payload.status, policy)
          const allStatusLabels = getAllStatusLabelsFromPolicy(policy)

          // Replace old status labels with new one
          const filteredLabels = currentLabels.filter((l) => !allStatusLabels.includes(l))
          const updatedLabels = [...filteredLabels, newStatusLabel]

          // Update in database
          updateCardLabels(card.id, JSON.stringify(updatedLabels), projectId)
        }

        // If the user moves a card out of Ready/In Progress, cancel any active worker job for it.
        if (
          payload.status === 'draft' ||
          payload.status === 'in_review' ||
          payload.status === 'testing' ||
          payload.status === 'failed' ||
          payload.status === 'done'
        ) {
          const activeJob = getActiveWorkerJobForCard(payload.cardId, projectId)
          if (activeJob) {
            cancelJob(activeJob.id, `Canceled: moved to ${payload.status}`)
            createEvent(projectId, 'worker_run', card.id, {
              jobId: activeJob.id,
              action: 'canceled',
              reason: `moved_to_${payload.status}`
            })
          }
        }

        // When card moves to Ready, clear failed jobs so it is immediately eligible and wake worker pool
        if (payload.status === 'ready') {
          deleteFailedWorkerRunJobsForCard(payload.cardId, projectId)
          wakeUpWorkerLoop(projectId)
        }

        // Queue async remote sync in background (fire-and-forget for fast UI response)
        if (card.remote_repo_key) {
          const cardId = payload.cardId
          const status = payload.status

          setImmediate(async () => {
            const job = createJob(projectId, 'sync_push', cardId, { status })
            try {
              const engine = new SyncEngine(projectId)
              const initialized = await engine.initialize()
              if (initialized) {
                const success = await engine.pushStatusChange(cardId, status)
                updateJobState(job.id, success ? 'succeeded' : 'failed')
                logAction('project:moveCard:pushStatus', { cardId, projectId, success })
              } else {
                updateJobState(job.id, 'failed', undefined, 'Failed to initialize sync engine')
                logAction('project:moveCard:pushStatus:init_failed', { cardId, projectId })
              }
            } catch (error) {
              updateJobState(job.id, 'failed', undefined, String(error))
              logAction('project:moveCard:pushStatus:error', {
                cardId,
                projectId,
                error: String(error)
              })
            }
            notifyRendererStateUpdated() // Notify when sync completes

            // Trigger a full poll sync to catch any remote changes (debounced)
            triggerProjectSync(projectId)
          })
        }
      }
      notifyRendererStateUpdated()
      return { card }
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

    const job = createJob(projectId, 'worker_run', cardId, { trigger: 'manual' })
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

  ipcMain.handle('project:resetWorkerState', (event) => {
    // Security check
    const securityError = verifyProjectRequest(event, 'project:resetWorkerState')
    if (securityError) {
      return {
        success: false,
        canceledJobs: 0,
        releasedSlots: 0,
        deletedFailedJobs: 0,
        error: `Security: ${securityError}`
      }
    }

    const projectId = getProjectIdFromEvent(event)
    if (!projectId) {
      return {
        success: false,
        canceledJobs: 0,
        releasedSlots: 0,
        deletedFailedJobs: 0,
        error: 'No project selected'
      }
    }

    logAction('project:resetWorkerState', { projectId })

    try {
      const result = resetWorkerState(projectId)
      notifyRendererStateUpdated()
      return {
        success: true,
        canceledJobs: result.canceledJobs,
        releasedSlots: result.releasedSlots,
        deletedFailedJobs: result.deletedFailedJobs
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logAction('project:resetWorkerState:error', { projectId, error: errorMessage })
      return {
        success: false,
        canceledJobs: 0,
        releasedSlots: 0,
        deletedFailedJobs: 0,
        error: errorMessage
      }
    }
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
    return {
      ...status,
      autoIndexingEnabled: getResolvedBool(projectId, 'index.autoIndexingEnabled')
    }
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

  ipcMain.handle('project:createPlanFile', async (event) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) throw new Error('No project selected')
    const project = getProject(projectId)
    if (!project) throw new Error('Project not found')

    const status = await getFlowPatchWorkspaceStatus(project.local_path)
    if (!status.writable) {
      return { success: false, error: 'Repo not writable' }
    }

    // Ensure workspace exists first
    ensureFlowPatchWorkspace(project.local_path)

    const { created, path } = createPlanFile(project.local_path)
    notifyRendererStateUpdated()

    return {
      success: true,
      created,
      path,
      message: created ? 'Plan file created' : 'Plan file already exists'
    }
  })

  ipcMain.handle('project:getEvents', (event, { limit }: { limit?: number }) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return []
    return listEvents(projectId, limit)
  })

  ipcMain.handle(
    'project:getCardEvents',
    (event, { cardId, limit }: { cardId: string; limit?: number }) => {
      const projectId = getProjectIdFromEvent(event)
      if (!projectId) return []
      // Clamp limit to max 500 for performance
      const clampedLimit = limit ? Math.min(limit, 500) : 200
      return listCardEvents(cardId, clampedLimit, projectId)
    }
  )

  ipcMain.handle('project:getCardUsage', (event, { cardId }: { cardId: string }) => {
    const projectId = getProjectIdFromEvent(event)
    if (!projectId) return []
    return getUsageRecordsByCard(cardId, projectId)
  })
}
