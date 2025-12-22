/**
 * Project Preload Script
 *
 * Exposes project-specific APIs to the project renderer:
 * - Cards (list, move, create)
 * - Sync operations
 * - Worker control
 * - State updates
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

// ============================================================================
// Types
// ============================================================================

export interface ProjectAPI {
  // Project info (received from shell via IPC)
  onProjectOpened: (
    callback: (info: { projectId: string; projectKey: string; projectPath: string }) => void
  ) => () => void
  onProjectClosing: (callback: () => void) => () => void

  // Project data
  getProject: (projectId: string) => Promise<Project | null>
  getRepoOnboardingState: (projectId: string) => Promise<{
    shouldShowLabelWizard?: boolean
    shouldPromptGithubProject?: boolean
  }>

  // Cards
  getCards: () => Promise<Card[]>
  getCardLinks: () => Promise<CardLink[]>
  moveCard: (cardId: string, status: CardStatus) => Promise<void>
  createCard: (title: string, body?: string) => Promise<Card>

  // Sync
  sync: () => Promise<void>
  onSyncComplete: (callback: () => void) => () => void

  // Worker
  isWorkerEnabled: () => Promise<boolean>
  toggleWorker: (enabled: boolean) => Promise<void>
  runWorker: (cardId?: string) => Promise<void>
  cancelWorker: (jobId: string) => Promise<void>

  // State updates
  onStateUpdate: (callback: () => void) => () => void
  onWorkerLog: (callback: (log: WorkerLogMessage) => void) => () => void

  // Jobs
  getJobs: () => Promise<Job[]>

  // Events
  getEvents: (limit?: number) => Promise<Event[]>
}

// Types from shared (would be imported in actual usage)
type CardStatus = 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'

interface Card {
  id: string
  project_id: string
  title: string
  body: string | null
  status: CardStatus
  remote_url: string | null
  remote_number_or_iid: string | null
}

interface CardLink {
  id: string
  card_id: string
  linked_type: 'pr' | 'mr'
  linked_url: string
  linked_number_or_iid: string | null
}

interface Job {
  id: string
  project_id: string
  card_id: string | null
  type: string
  state: string
  created_at: string
  updated_at: string
}

interface Event {
  id: string
  project_id: string
  card_id: string | null
  type: string
  payload_json: string | null
  created_at: string
}

interface WorkerLogMessage {
  projectId: string
  jobId: string
  cardId?: string
  ts: string
  line: string
  source?: string
  stream?: 'stdout' | 'stderr'
}

interface Project {
  id: string
  name: string
  local_path: string
  selected_remote_name: string | null
  remote_repo_key: string | null
  provider_hint: 'auto' | 'github' | 'gitlab'
  worker_enabled: number
  policy_json: string | null
  last_sync_at: string | null
}

// ============================================================================
// Project API Implementation
// ============================================================================

const projectAPI: ProjectAPI = {
  // -------------------------------------------------------------------------
  // Project Lifecycle
  // -------------------------------------------------------------------------

  onProjectOpened: (callback) => {
    const handler = (
      _event: IpcRendererEvent,
      info: { projectId: string; projectKey: string; projectPath: string }
    ) => {
      callback(info)
    }
    ipcRenderer.on('projectOpened', handler)
    return () => {
      ipcRenderer.removeListener('projectOpened', handler)
    }
  },

  onProjectClosing: (callback) => {
    const handler = () => {
      callback()
    }
    ipcRenderer.on('projectClosing', handler)
    return () => {
      ipcRenderer.removeListener('projectClosing', handler)
    }
  },

  // -------------------------------------------------------------------------
  // Project Data
  // -------------------------------------------------------------------------

  getProject: (projectId: string) => {
    return ipcRenderer.invoke('getProject', { projectId })
  },

  getRepoOnboardingState: (projectId: string) => {
    return ipcRenderer.invoke('getRepoOnboardingState', { projectId })
  },

  // -------------------------------------------------------------------------
  // Cards
  // -------------------------------------------------------------------------

  getCards: () => {
    return ipcRenderer.invoke('project:getCards')
  },

  getCardLinks: () => {
    return ipcRenderer.invoke('project:getCardLinks')
  },

  moveCard: (cardId: string, status: CardStatus) => {
    return ipcRenderer.invoke('moveCard', { cardId, status })
  },

  createCard: (title: string, body?: string) => {
    return ipcRenderer.invoke('project:createCard', { title, body })
  },

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  sync: () => {
    return ipcRenderer.invoke('project:sync')
  },

  onSyncComplete: (callback) => {
    const handler = () => {
      callback()
    }
    ipcRenderer.on('syncComplete', handler)
    return () => {
      ipcRenderer.removeListener('syncComplete', handler)
    }
  },

  // -------------------------------------------------------------------------
  // Worker
  // -------------------------------------------------------------------------

  isWorkerEnabled: () => {
    return ipcRenderer.invoke('project:isWorkerEnabled')
  },

  toggleWorker: (enabled: boolean) => {
    return ipcRenderer.invoke('project:toggleWorker', { enabled })
  },

  runWorker: (cardId?: string) => {
    return ipcRenderer.invoke('project:runWorker', { cardId })
  },

  cancelWorker: (jobId: string) => {
    return ipcRenderer.invoke('project:cancelWorker', { jobId })
  },

  // -------------------------------------------------------------------------
  // State Updates
  // -------------------------------------------------------------------------

  onStateUpdate: (callback) => {
    const handler = () => {
      callback()
    }
    ipcRenderer.on('stateUpdated', handler)
    return () => {
      ipcRenderer.removeListener('stateUpdated', handler)
    }
  },

  onWorkerLog: (callback) => {
    const handler = (_event: IpcRendererEvent, log: WorkerLogMessage) => {
      callback(log)
    }
    ipcRenderer.on('workerLog', handler)
    return () => {
      ipcRenderer.removeListener('workerLog', handler)
    }
  },

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------

  getJobs: () => {
    return ipcRenderer.invoke('project:getJobs')
  },

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  getEvents: (limit?: number) => {
    return ipcRenderer.invoke('project:getEvents', { limit })
  }
}

// ============================================================================
// Electron API for CardDrawer compatibility
// ============================================================================

const allowedInvokeChannels = [
  'getThemePreference',
  'setThemePreference',
  'getSystemTheme',
  'listWorktrees',
  'openWorktreeFolder',
  'removeWorktree',
  'recreateWorktree',
  // Onboarding dialogs (LabelSetupDialog, GithubProjectPromptDialog)
  'listRepoLabels',
  'applyLabelConfig',
  'dismissLabelWizard',
  'dismissGithubProjectPrompt',
  'createGithubProjectV2'
]

const allowedSendChannels = ['openExternal']

const allowedOnChannels = ['themeChanged']

const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      if (allowedInvokeChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args)
      }
      throw new Error(`Channel ${channel} not allowed`)
    },
    send: (channel: string, ...args: unknown[]) => {
      if (allowedSendChannels.includes(channel)) {
        ipcRenderer.send(channel, ...args)
        return
      }
      throw new Error(`Channel ${channel} not allowed`)
    },
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      if (allowedOnChannels.includes(channel)) {
        ipcRenderer.on(channel, callback)
        return
      }
      throw new Error(`Channel ${channel} not allowed for on()`)
    },
    removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
      if (allowedOnChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, callback)
        return
      }
      throw new Error(`Channel ${channel} not allowed for removeListener()`)
    }
  }
}

// ============================================================================
// Expose API
// ============================================================================

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('projectAPI', projectAPI)
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error('Failed to expose projectAPI:', error)
  }
} else {
  // @ts-ignore
  window.projectAPI = projectAPI
  // @ts-ignore
  window.electron = electronAPI
}
