/**
 * Shell Preload Script
 *
 * Exposes shell-specific APIs to the shell renderer:
 * - Project management (open, close, list)
 * - Settings (defaults and project overrides)
 * - Activity monitoring (busy states)
 * - Log access and export
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { ShortcutBinding } from '../shared/shortcuts'

// ============================================================================
// Types (for TypeScript consumers)
// ============================================================================

export interface ShellAPI {
  // Tab management
  createTab: (projectId: string, projectPath: string) => Promise<TabData>
  closeTab: (tabId: string) => Promise<void>
  activateTab: (tabId: string) => Promise<void>
  deactivateAllTabs: () => Promise<void>
  getTabs: () => Promise<TabManagerState>
  moveTab: (tabId: string, newIndex: number) => Promise<void>
  closeOtherTabs: (tabId: string) => Promise<void>
  closeTabsToRight: (tabId: string) => Promise<void>
  duplicateTab: (tabId: string) => Promise<TabData | null>
  onTabsChanged: (callback: (state: TabManagerState) => void) => () => void

  // Project management
  openProject: (projectRoot: string) => Promise<OpenProjectResult>
  closeProject: () => Promise<void>
  getProjects: () => Promise<Project[]>
  getCurrentProject: () => Promise<OpenProjectSummary | null>
  selectDirectory: () => Promise<SelectDirectoryResult>

  // Project identity
  getProjectIdentity: (
    projectId: string
  ) => Promise<{ repoId: string | null; remotes: RemoteInfo[]; identityRemote: string | null }>
  setIdentityRemote: (projectId: string, remoteName: string) => Promise<void>

  // Settings
  getDefaults: () => Promise<Record<string, string | null>>
  setDefaults: (patch: Record<string, string | null>) => Promise<void>
  getProjectSettings: (projectKey: string) => Promise<Record<string, string | null>>
  setProjectOverride: (projectKey: string, patch: Record<string, string | null>) => Promise<void>
  clearProjectOverrides: (projectKey: string, keys?: string[]) => Promise<void>

  // Activity
  getActivity: () => Promise<GlobalActivity>
  getProjectActivity: (projectId: string) => Promise<ProjectActivity>
  onActivityUpdate: (callback: (activity: ProjectActivity) => void) => () => void

  // Jobs (Activity feed)
  getRecentJobs: (limit?: number) => Promise<import('../shared/types').Job[]>
  onStateUpdated: (callback: () => void) => () => void

  // Logs
  getLogs: (projectKey?: string) => Promise<LogEntry[]>
  getRecentLogs: (count: number) => Promise<LogEntry[]>
  exportLogs: (projectKey?: string) => Promise<string>
  clearLogs: (projectKey?: string) => Promise<void>
  onLogEntry: (callback: (entry: LogEntry) => void) => () => void

  // Window
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void

  // UI Layer Management (for modals/panels)
  setLogsPanelHeight: (height: number) => void
  setModalOpen: (open: boolean) => void

  // Theme
  getThemePreference: () => Promise<'light' | 'dark' | 'system'>
  setThemePreference: (theme: 'light' | 'dark' | 'system') => Promise<void>
  getSystemTheme: () => Promise<'light' | 'dark'>

  // Shortcuts
  getShortcuts: () => Promise<ShortcutBinding[]>
  setShortcuts: (patch: Record<string, string | null>) => Promise<void>
  onShortcutsUpdated: (callback: () => void) => () => void
}

// Re-export types from shared (these would be imported in actual usage)
interface Project {
  id: string
  name: string
  local_path: string
  selected_remote_name: string | null
  remote_repo_key: string | null
  provider_hint: 'auto' | 'github' | 'gitlab'
  worker_enabled: number
}

interface RemoteInfo {
  name: string
  url: string
  provider: 'github' | 'gitlab' | 'unknown'
  repoKey: string
}

interface OpenProjectResult {
  canceled?: boolean
  error?: string
  project?: Project
  remotes?: RemoteInfo[]
  needSelection?: boolean
}

interface OpenProjectSummary {
  projectId: string
  projectKey: string
  projectPath: string
  projectName: string
}

interface SelectDirectoryResult {
  canceled?: boolean
  error?: string
  path?: string
}

interface GlobalActivity {
  totalActiveRuns: number
  isBusy: boolean
  busyProjects: string[]
}

interface ProjectActivity {
  projectId: string
  activeRuns: number
  isBusy: boolean
  lastUpdated: string
}

interface LogEntry {
  id: string
  ts: string
  projectKey: string
  jobId?: string
  source: string
  stream: 'stdout' | 'stderr' | 'info' | 'error' | 'warn'
  line: string
}

interface TabData {
  id: string
  projectId: string
  projectKey: string
  projectPath: string
  projectName: string
  isLoading?: boolean
}

interface TabManagerState {
  tabs: TabData[]
  activeTabId: string | null
}

// ============================================================================
// Shell API Implementation
// ============================================================================

const shellAPI: ShellAPI = {
  // -------------------------------------------------------------------------
  // Tab Management
  // -------------------------------------------------------------------------

  createTab: (projectId: string, projectPath: string) => {
    return ipcRenderer.invoke('tabs:create', { projectId, projectPath })
  },

  closeTab: (tabId: string) => {
    return ipcRenderer.invoke('tabs:close', { tabId })
  },

  activateTab: (tabId: string) => {
    return ipcRenderer.invoke('tabs:activate', { tabId })
  },

  deactivateAllTabs: () => {
    return ipcRenderer.invoke('tabs:deactivateAll')
  },

  getTabs: () => {
    return ipcRenderer.invoke('tabs:getAll')
  },

  moveTab: (tabId: string, newIndex: number) => {
    return ipcRenderer.invoke('tabs:move', { tabId, newIndex })
  },

  closeOtherTabs: (tabId: string) => {
    return ipcRenderer.invoke('tabs:closeOthers', { tabId })
  },

  closeTabsToRight: (tabId: string) => {
    return ipcRenderer.invoke('tabs:closeToRight', { tabId })
  },

  duplicateTab: (tabId: string) => {
    return ipcRenderer.invoke('tabs:duplicate', { tabId })
  },

  onTabsChanged: (callback: (state: TabManagerState) => void) => {
    const handler = (_event: IpcRendererEvent, state: TabManagerState) => {
      callback(state)
    }
    ipcRenderer.on('tabsChanged', handler)
    return () => {
      ipcRenderer.removeListener('tabsChanged', handler)
    }
  },

  // -------------------------------------------------------------------------
  // Project Management
  // -------------------------------------------------------------------------

  openProject: (projectRoot: string) => {
    return ipcRenderer.invoke('shell:openProject', { projectRoot })
  },

  closeProject: () => {
    return ipcRenderer.invoke('shell:closeProject')
  },

  getProjects: () => {
    return ipcRenderer.invoke('shell:getProjects')
  },

  getCurrentProject: () => {
    return ipcRenderer.invoke('shell:getCurrentProject')
  },

  selectDirectory: () => {
    return ipcRenderer.invoke('selectDirectory')
  },

  // -------------------------------------------------------------------------
  // Project Identity
  // -------------------------------------------------------------------------

  getProjectIdentity: (projectId: string) => {
    return ipcRenderer.invoke('shell:getProjectIdentity', { projectId })
  },

  setIdentityRemote: (projectId: string, remoteName: string) => {
    return ipcRenderer.invoke('shell:setIdentityRemote', { projectId, remoteName })
  },

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  getDefaults: () => {
    return ipcRenderer.invoke('settings:getDefaults')
  },

  setDefaults: (patch: Record<string, string | null>) => {
    return ipcRenderer.invoke('settings:setDefaults', { patch })
  },

  getProjectSettings: (projectKey: string) => {
    return ipcRenderer.invoke('settings:getProjectResolved', { projectKey })
  },

  setProjectOverride: (projectKey: string, patch: Record<string, string | null>) => {
    return ipcRenderer.invoke('settings:setProjectOverride', { projectKey, patch })
  },

  clearProjectOverrides: (projectKey: string, keys?: string[]) => {
    return ipcRenderer.invoke('settings:clearProjectOverride', { projectKey, keys })
  },

  // -------------------------------------------------------------------------
  // Activity
  // -------------------------------------------------------------------------

  getActivity: () => {
    return ipcRenderer.invoke('activity:getGlobal')
  },

  getProjectActivity: (projectId: string) => {
    return ipcRenderer.invoke('activity:getProject', { projectId })
  },

  onActivityUpdate: (callback: (activity: ProjectActivity) => void) => {
    const handler = (_event: IpcRendererEvent, activity: ProjectActivity) => {
      callback(activity)
    }
    ipcRenderer.on('activityUpdated', handler)
    return () => {
      ipcRenderer.removeListener('activityUpdated', handler)
    }
  },

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------

  getRecentJobs: (limit?: number) => {
    return ipcRenderer.invoke('jobs:getRecent', { limit })
  },

  onStateUpdated: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('stateUpdated', handler)
    return () => {
      ipcRenderer.removeListener('stateUpdated', handler)
    }
  },

  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  getLogs: (projectKey?: string) => {
    return ipcRenderer.invoke('logs:getBuffer', { projectKey })
  },

  getRecentLogs: (count: number) => {
    return ipcRenderer.invoke('logs:getRecent', { count })
  },

  exportLogs: (projectKey?: string) => {
    return ipcRenderer.invoke('logs:export', { projectKey })
  },

  clearLogs: (projectKey?: string) => {
    return ipcRenderer.invoke('logs:clear', { projectKey })
  },

  onLogEntry: (callback: (entry: LogEntry) => void) => {
    const handler = (_event: IpcRendererEvent, entry: LogEntry) => {
      callback(entry)
    }
    ipcRenderer.on('logEntry', handler)
    return () => {
      ipcRenderer.removeListener('logEntry', handler)
    }
  },

  // -------------------------------------------------------------------------
  // Window Controls
  // -------------------------------------------------------------------------

  minimizeWindow: () => {
    ipcRenderer.send('window:minimize')
  },

  maximizeWindow: () => {
    ipcRenderer.send('window:maximize')
  },

  closeWindow: () => {
    ipcRenderer.send('window:close')
  },

  // -------------------------------------------------------------------------
  // UI Layer Management
  // -------------------------------------------------------------------------

  setLogsPanelHeight: (height: number) => {
    ipcRenderer.send('ui:setLogsPanelHeight', height)
  },

  setModalOpen: (open: boolean) => {
    ipcRenderer.send('ui:setModalOpen', open)
  },

  // -------------------------------------------------------------------------
  // Theme
  // -------------------------------------------------------------------------

  getThemePreference: () => {
    return ipcRenderer.invoke('getThemePreference')
  },

  setThemePreference: (theme: 'light' | 'dark' | 'system') => {
    return ipcRenderer.invoke('setThemePreference', theme)
  },

  getSystemTheme: () => {
    return ipcRenderer.invoke('getSystemTheme')
  },

  // -------------------------------------------------------------------------
  // Shortcuts
  // -------------------------------------------------------------------------

  getShortcuts: () => {
    return ipcRenderer.invoke('shortcuts:getAll')
  },

  setShortcuts: (patch: Record<string, string | null>) => {
    return ipcRenderer.invoke('shortcuts:setAll', { patch })
  },

  onShortcutsUpdated: (callback: () => void) => {
    const handler = (_event: IpcRendererEvent) => callback()
    ipcRenderer.on('shortcutsUpdated', handler)
    return () => ipcRenderer.removeListener('shortcutsUpdated', handler)
  }
}

// ============================================================================
// Electron IPC Bridge (for compatibility with shared components)
// ============================================================================

const allowedInvokeChannels = [
  'updateProjectPolicy',
  'setApiKey',
  'getApiKey',
  'resetLabelWizard',
  'resetGithubProjectPrompt',
  'unlinkProject',
  'createRepo'
]

const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      if (allowedInvokeChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args)
      }
      throw new Error(`Channel ${channel} not allowed in shell context`)
    }
  }
}

// ============================================================================
// Expose API
// ============================================================================

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('shellAPI', shellAPI)
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error('Failed to expose shellAPI:', error)
  }
} else {
  // @ts-ignore
  window.shellAPI = shellAPI
  // @ts-ignore
  window.electron = electronAPI
}
