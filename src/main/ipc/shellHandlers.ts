/**
 * Shell IPC Handlers
 *
 * Handles IPC requests from the shell renderer:
 * - Project management
 * - Settings
 * - Activity
 * - Logs
 */

import { ipcMain, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import {
  listProjects,
  getProject,
  upsertProject,
  deleteProject,
  listRecentJobs,
  createJob,
  updateJobState
} from '../db'
import {
  initTabManager,
  createTab,
  closeTab,
  activateTab,
  getAllTabs,
  getActiveTabId,
  moveTab,
  closeOtherTabs,
  closeTabsToRight,
  duplicateTab,
  deactivateAllTabs,
  setLogsPanelHeight,
  setModalOpen,
  restoreTabs
} from '../tabManager'
import {
  getDefault,
  getResolved,
  getResolvedBool,
  patchDefaults,
  patchProjectOverrides,
  getAllResolvedSettings,
  SETTINGS_SCHEMA
} from '../settingsStore'
import { getGlobalActivity, getProjectActivity } from '../activityStore'
import {
  getAllLogs,
  getProjectLogs,
  getRecentLogs,
  exportLogs,
  clearAllLogs,
  clearProjectLogs
} from '../logStore'
import { closeProjectView, getCurrentProjectState } from '../projectView'
import {
  detectProjectIdentity,
  detectProviderFromRemote,
  getDefaultRemote,
  normalizeProjectPath
} from '../projectIdentity'
import { logAction } from '@shared/utils'
import { registerProjectHandlers } from './projectHandlers'
import { broadcastToRenderers } from './broadcast'
import { getAllShortcuts, setShortcuts } from '../shortcuts'
import {
  ensurePatchworkWorkspace,
  getPatchworkWorkspaceStatus
} from '../services/patchwork-workspace'
import { buildIndex } from '../services/patchwork-indexer'
import { registerProject, setActiveProject } from '../services/patchwork-index-scheduler'

function cryptoId(): string {
  const buf = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ============================================================================
// State
// ============================================================================

let currentProjectId: string | null = null

// ============================================================================
// Registration
// ============================================================================

export function registerShellHandlers(mainWindow: BrowserWindow): void {
  // Initialize tab manager
  initTabManager(mainWindow)

  // Register project handlers (for WebContentsView tabs)
  registerProjectHandlers()

  // Restore any tabs from the previous session.
  void restoreTabs().then(() => {
    const active = getActiveTabId()
    const tab = active ? getAllTabs().find((t) => t.id === active) : null
    setActiveProject(tab?.projectId ?? null)
  })

  // -------------------------------------------------------------------------
  // Tab Management
  // -------------------------------------------------------------------------

  ipcMain.handle(
    'tabs:create',
    async (_event, { projectId, projectPath }: { projectId: string; projectPath: string }) => {
      logAction('tabs:create', { projectId, projectPath })

      try {
        const project = getProject(projectId)
        if (!project) {
          throw new Error('Project not found')
        }

        const identity = await detectProjectIdentity(projectPath)
        const tab = await createTab(projectId, identity.projectKey, projectPath, project.name)

        return {
          id: tab.id,
          projectId: tab.projectId,
          projectKey: tab.projectKey,
          projectPath: tab.projectPath,
          projectName: tab.projectName,
          isLoading: tab.isLoading
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create tab'
        logAction('tabs:create:error', { message })
        throw error
      }
    }
  )

  ipcMain.handle('tabs:close', async (_event, { tabId }: { tabId: string }) => {
    logAction('tabs:close', { tabId })
    await closeTab(tabId)
    const active = getActiveTabId()
    const tab = active ? getAllTabs().find((t) => t.id === active) : null
    setActiveProject(tab?.projectId ?? null)
  })

  ipcMain.handle('tabs:activate', async (_event, { tabId }: { tabId: string }) => {
    logAction('tabs:activate', { tabId })
    await activateTab(tabId)
    const tab = getAllTabs().find((t) => t.id === tabId)
    setActiveProject(tab?.projectId ?? null)
  })

  ipcMain.handle('tabs:getAll', () => {
    return {
      tabs: getAllTabs(),
      activeTabId: getActiveTabId()
    }
  })

  ipcMain.handle(
    'tabs:move',
    (_event, { tabId, newIndex }: { tabId: string; newIndex: number }) => {
      logAction('tabs:move', { tabId, newIndex })
      moveTab(tabId, newIndex)
    }
  )

  ipcMain.handle('tabs:closeOthers', async (_event, { tabId }: { tabId: string }) => {
    logAction('tabs:closeOthers', { tabId })
    await closeOtherTabs(tabId)
  })

  ipcMain.handle('tabs:closeToRight', async (_event, { tabId }: { tabId: string }) => {
    logAction('tabs:closeToRight', { tabId })
    await closeTabsToRight(tabId)
  })

  ipcMain.handle('tabs:duplicate', async (_event, { tabId }: { tabId: string }) => {
    logAction('tabs:duplicate', { tabId })
    const tab = await duplicateTab(tabId)
    if (!tab) return null

    return {
      id: tab.id,
      projectId: tab.projectId,
      projectKey: tab.projectKey,
      projectPath: tab.projectPath,
      projectName: tab.projectName,
      isLoading: tab.isLoading
    }
  })

  ipcMain.handle('tabs:deactivateAll', () => {
    logAction('tabs:deactivateAll')
    deactivateAllTabs()
    setActiveProject(null)
  })

  // -------------------------------------------------------------------------
  // Project Management
  // -------------------------------------------------------------------------

  ipcMain.handle('shell:openProject', async (_event, { projectRoot }: { projectRoot: string }) => {
    logAction('shell:openProject', { projectRoot })

    try {
      // Detect project identity
      const identity = await detectProjectIdentity(projectRoot)

      if (!identity.isGit) {
        return { error: 'Selected folder is not a git repository.' }
      }

      // Find or create project in database (by local path)
      const projects = listProjects()
      const normalizedRoot = normalizeProjectPath(projectRoot)
      let project = projects.find((p) => normalizeProjectPath(p.local_path) === normalizedRoot)

      if (!project) {
        const name = projectRoot.split(/[\\/]/).pop() || projectRoot
        const selectedRemote = getDefaultRemote(identity.remotes)

        project = upsertProject({
          id: cryptoId(),
          name,
          local_path: projectRoot,
          selected_remote_name: selectedRemote ? selectedRemote.name.split(':')[0] : null,
          remote_repo_key: selectedRemote ? selectedRemote.repoKey : null,
          provider_hint: selectedRemote ? detectProviderFromRemote(selectedRemote.url) : 'auto',
          policy_json: null
        })

        // Best-effort auto-configure worktree for autonomous workers
        try {
          const { initializeProjectWorktree } = await import('../services/project-initializer')
          const initResult = await initializeProjectWorktree(project.id)
          if (initResult.configured) {
            logAction('project:worktreeInitialized', {
              projectId: project.id,
              worktreeRoot: initResult.worktreeRoot,
              maxWorkers: initResult.maxWorkers
            })
          } else if (initResult.error) {
            logAction('project:worktreeInitError', {
              projectId: project.id,
              error: initResult.error
            })
          }
        } catch (error) {
          logAction('project:worktreeInitException', {
            projectId: project.id,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      // Shell UI doesn't currently provide remote selection; default it to keep GitHub features usable.
      if (!project.remote_repo_key) {
        const selectedRemote = getDefaultRemote(identity.remotes)
        if (selectedRemote) {
          project = upsertProject({
            id: project.id,
            name: project.name,
            local_path: project.local_path,
            selected_remote_name: selectedRemote.name.split(':')[0],
            remote_repo_key: selectedRemote.repoKey,
            provider_hint: detectProviderFromRemote(selectedRemote.url),
            policy_json: project.policy_json
          })
        }
      }

      // Auto-indexing is user-togglable and off by default.
      const autoIndexingEnabled = getResolvedBool(project.id, 'index.autoIndexingEnabled')
      if (autoIndexingEnabled) {
        registerProject(project.id, project.local_path)
        setActiveProject(project.id)
      }

      // Ensure .patchwork workspace exists (non-blocking) and index once on open.
      void (async () => {
        const ensureJob = createJob(project.id, 'workspace_ensure')
        broadcastToRenderers('stateUpdated')
        try {
          updateJobState(ensureJob.id, 'running')
          broadcastToRenderers('stateUpdated')

          const status = await getPatchworkWorkspaceStatus(project.local_path)
          if (!status.writable) {
            updateJobState(
              ensureJob.id,
              'blocked',
              { summary: 'Repo not writable' },
              'Repo not writable'
            )
            broadcastToRenderers('stateUpdated')
            return
          }

          const ensured = ensurePatchworkWorkspace(project.local_path)
          updateJobState(ensureJob.id, 'succeeded', {
            summary: ensured.createdPaths.length
              ? 'Workspace created/updated'
              : 'Workspace already present',
            artifacts: ensured
          })
          broadcastToRenderers('stateUpdated')
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Workspace ensure failed'
          updateJobState(ensureJob.id, 'failed', { summary: msg }, msg)
          broadcastToRenderers('stateUpdated')
          return
        }

        if (!autoIndexingEnabled) return

        const indexJob = createJob(project.id, 'index_build')
        broadcastToRenderers('stateUpdated')
        try {
          updateJobState(indexJob.id, 'running', { summary: 'Indexing…' })
          broadcastToRenderers('stateUpdated')
          const { meta } = await buildIndex(project.local_path)
          updateJobState(indexJob.id, 'succeeded', {
            summary: `Indexed ${meta.totalFiles} files`,
            artifacts: meta
          })
          broadcastToRenderers('stateUpdated')
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Index build failed'
          updateJobState(indexJob.id, 'failed', { summary: msg }, msg)
          broadcastToRenderers('stateUpdated')
        }
      })()

      currentProjectId = project.id

      return {
        project,
        remotes: identity.remotes,
        needSelection: false
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open project'
      logAction('shell:openProject:error', { message })
      return { error: message }
    }
  })

  ipcMain.handle('shell:closeProject', async () => {
    logAction('shell:closeProject')
    try {
      await closeProjectView(mainWindow)
      currentProjectId = null
    } catch (error) {
      console.error('Failed to close project:', error)
    }
  })

  ipcMain.handle('shell:getProjects', () => {
    return listProjects().map((p) => ({
      ...p,
      local_path_exists: existsSync(p.local_path)
    }))
  })

  ipcMain.handle('shell:deleteProject', async (_event, { projectId }: { projectId: string }) => {
    logAction('shell:deleteProject', { projectId })

    const tabsToClose = getAllTabs().filter((t) => t.projectId === projectId)
    for (const tab of tabsToClose) {
      await closeTab(tab.id)
    }

    const deleted = deleteProject(projectId)
    if (currentProjectId === projectId) currentProjectId = null

    const active = getActiveTabId()
    const tab = active ? getAllTabs().find((t) => t.id === active) : null
    setActiveProject(tab?.projectId ?? null)

    return { deleted }
  })

  ipcMain.handle('shell:getCurrentProject', () => {
    const state = getCurrentProjectState()
    if (!state) return null

    const project = getProject(state.projectId)
    if (!project) return null

    return {
      projectId: state.projectId,
      projectKey: state.projectKey,
      projectPath: state.projectPath,
      projectName: project.name
    }
  })

  ipcMain.handle(
    'shell:getProjectIdentity',
    async (_event, { projectId }: { projectId: string }) => {
      const project = getProject(projectId)
      if (!project) {
        return { repoId: null, remotes: [], identityRemote: null }
      }

      const identity = await detectProjectIdentity(project.local_path)
      return {
        repoId: identity.repoId,
        remotes: identity.remotes,
        identityRemote: project.selected_remote_name
      }
    }
  )

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  ipcMain.handle('settings:getDefaults', () => {
    const result: Record<string, string | null> = {}
    for (const key of Object.keys(SETTINGS_SCHEMA)) {
      result[key] = getDefault(key) ?? getResolved(null, key)
    }
    return result
  })

  ipcMain.handle(
    'settings:setDefaults',
    (_event, { patch }: { patch: Record<string, string | null> }) => {
      patchDefaults(patch)
    }
  )

  ipcMain.handle(
    'settings:getProjectResolved',
    (_event, { projectKey }: { projectKey: string }) => {
      return getAllResolvedSettings(projectKey)
    }
  )

  ipcMain.handle(
    'settings:setProjectOverride',
    (
      _event,
      { projectKey, patch }: { projectKey: string; patch: Record<string, string | null> }
    ) => {
      patchProjectOverrides(projectKey, patch)
    }
  )

  ipcMain.handle(
    'settings:clearProjectOverride',
    (_event, { projectKey, keys }: { projectKey: string; keys?: string[] }) => {
      if (!keys || keys.length === 0) {
        logAction('settings:clearProjectOverride:noKeys', { projectKey })
        return
      }
      const patch: Record<string, null> = {}
      for (const key of keys) patch[key] = null
      patchProjectOverrides(projectKey, patch)
    }
  )

  // -------------------------------------------------------------------------
  // Shortcuts
  // -------------------------------------------------------------------------

  ipcMain.handle('shortcuts:getAll', () => {
    return getAllShortcuts()
  })

  ipcMain.handle(
    'shortcuts:setAll',
    (_event, { patch }: { patch: Record<string, string | null> }) => {
      setShortcuts(patch)
      broadcastToRenderers('shortcutsUpdated')
    }
  )

  // -------------------------------------------------------------------------
  // Activity
  // -------------------------------------------------------------------------

  ipcMain.handle('activity:getGlobal', () => {
    return getGlobalActivity()
  })

  ipcMain.handle('activity:getProject', (_event, { projectId }: { projectId: string }) => {
    return getProjectActivity(projectId)
  })

  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  ipcMain.handle('logs:getBuffer', (_event, { projectKey }: { projectKey?: string }) => {
    if (projectKey) {
      return getProjectLogs(projectKey)
    }
    return getAllLogs()
  })

  ipcMain.handle('logs:getRecent', (_event, { count }: { count: number }) => {
    return getRecentLogs(count)
  })

  ipcMain.handle('logs:export', (_event, { projectKey }: { projectKey?: string }) => {
    return exportLogs(projectKey)
  })

  ipcMain.handle('logs:clear', (_event, { projectKey }: { projectKey?: string }) => {
    if (projectKey) {
      clearProjectLogs(projectKey)
    } else {
      clearAllLogs()
    }
  })

  // -------------------------------------------------------------------------
  // Jobs (Activity feed)
  // -------------------------------------------------------------------------

  ipcMain.handle('jobs:getRecent', (_event, { limit }: { limit?: number }) => {
    return listRecentJobs(limit ?? 200)
  })

  // -------------------------------------------------------------------------
  // Window Controls
  // -------------------------------------------------------------------------

  ipcMain.on('window:minimize', () => {
    mainWindow.minimize()
  })

  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.on('window:close', () => {
    mainWindow.close()
  })

  // -------------------------------------------------------------------------
  // View Layer Management (for modals and panels)
  // -------------------------------------------------------------------------

  ipcMain.on('ui:setLogsPanelHeight', (_event, height: number) => {
    setLogsPanelHeight(height)
  })

  ipcMain.on('ui:setModalOpen', (_event, open: boolean) => {
    setModalOpen(open)
  })
}

// ============================================================================
// Helpers
// ============================================================================

export function getCurrentProjectId(): string | null {
  return currentProjectId
}
