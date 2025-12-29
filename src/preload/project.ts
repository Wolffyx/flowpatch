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
  ensureProjectRemote: (projectId: string) => Promise<{ project?: Project; error?: string }>
  createCard: (data: {
    title: string
    body?: string
    createType: 'local' | 'repo_issue' | 'github_issue' | 'gitlab_issue'
  }) => Promise<Card>

  // Sync
  sync: () => Promise<void>
  onSyncComplete: (callback: () => void) => () => void

  // Worker
  isWorkerEnabled: () => Promise<boolean>
  toggleWorker: (enabled: boolean) => Promise<void>
  runWorker: (cardId?: string) => Promise<void>
  cancelWorker: (jobId: string) => Promise<void>

  // Plan Approval
  getPendingApprovals: () => Promise<{ approvals: PlanApproval[] }>
  getPlanApproval: (params: { approvalId?: string; jobId?: string }) => Promise<{ approval?: PlanApproval; error?: string }>
  approvePlan: (approvalId: string, notes?: string) => Promise<{ success: boolean; error?: string }>
  rejectPlan: (approvalId: string, notes?: string) => Promise<{ success: boolean; error?: string }>
  skipPlanApproval: (approvalId: string) => Promise<{ success: boolean; error?: string }>
  onPlanApprovalRequired: (callback: (data: { projectId: string; cardId: string; jobId: string; approvalId: string }) => void) => () => void

  // Follow-up Instructions
  getFollowUpInstructions: (params: { jobId?: string; cardId?: string; pendingOnly?: boolean }) => Promise<{ instructions: FollowUpInstruction[]; error?: string }>
  createFollowUpInstruction: (data: {
    jobId: string
    cardId: string
    instructionType: FollowUpInstructionType
    content: string
    priority?: number
  }) => Promise<{ success: boolean; instruction?: FollowUpInstruction; error?: string }>
  deleteFollowUpInstruction: (instructionId: string) => Promise<{ success: boolean; error?: string }>
  countPendingInstructions: (jobId: string) => Promise<{ count: number; error?: string }>

  // Usage Tracking
  getTotalUsage: () => Promise<{ usage: { tokens: number; cost: number } }>
  getUsageWithLimits: () => Promise<{ usageWithLimits: UsageWithLimits[] }>

  // State updates
  onStateUpdate: (callback: () => void) => () => void
  onWorkerLog: (callback: (log: WorkerLogMessage) => void) => () => void

  // Jobs
  getJobs: () => Promise<Job[]>

  // Events
  getEvents: (limit?: number) => Promise<Event[]>

  // Patchwork workspace (.patchwork)
  getWorkspaceStatus: () => Promise<import('../shared/types').PatchworkWorkspaceStatus | null>
  ensureWorkspace: () => Promise<unknown>
  indexBuild: () => Promise<unknown>
  indexRefresh: () => Promise<unknown>
  indexWatchStart: () => Promise<unknown>
  indexWatchStop: () => Promise<unknown>
  validateConfig: () => Promise<unknown>
  docsRefresh: () => Promise<unknown>
  contextPreview: (task: string) => Promise<unknown>
  repairWorkspace: () => Promise<unknown>
  migrateWorkspace: () => Promise<unknown>
  openWorkspaceFolder: () => Promise<unknown>
  retrieve: (kind: 'symbol' | 'text', query: string, limit?: number) => Promise<unknown>
  getPatchworkConfig: () => Promise<unknown>

  // Configuration sync
  syncConfig: (priorityOverride?: 'database' | 'file') => Promise<{
    success: boolean
    source?: 'database' | 'file' | 'merged'
    policy?: PolicyConfig
    errors?: string[]
    warnings?: string[]
  }>
  getConfig: () => Promise<PolicyConfig>
  updateFeatureConfig: (
    featureKey: string,
    config: Record<string, unknown>
  ) => Promise<{
    success: boolean
    policy?: PolicyConfig
    errors?: string[]
    warnings?: string[]
  }>
  getConfigSyncPriority: () => Promise<'database' | 'file'>
  setConfigSyncPriority: (priority: 'database' | 'file') => Promise<{
    success: boolean
    policy?: PolicyConfig
    errors?: string[]
    warnings?: string[]
  }>
  startConfigWatcher: () => Promise<{ success: boolean }>
  stopConfigWatcher: () => Promise<{ success: boolean }>
  onConfigChanged: (
    callback: (data: { policy: PolicyConfig; source: 'database' | 'file' | 'merged' }) => void
  ) => () => void
}

interface PolicyConfig {
  version: number
  features?: Record<string, unknown>
  [key: string]: unknown
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

type PlanningMode = 'skip' | 'lite' | 'spec' | 'full'
type PlanApprovalStatus = 'pending' | 'approved' | 'rejected' | 'skipped'

interface PlanApproval {
  id: string
  job_id: string
  card_id: string
  project_id: string
  plan: string
  planning_mode: PlanningMode
  status: PlanApprovalStatus
  reviewer_notes?: string
  created_at: string
  reviewed_at?: string
}

type FollowUpInstructionStatus = 'pending' | 'processing' | 'applied' | 'rejected'
type FollowUpInstructionType = 'revision' | 'clarification' | 'additional' | 'abort'

interface FollowUpInstruction {
  id: string
  job_id: string
  card_id: string
  project_id: string
  instruction_type: FollowUpInstructionType
  content: string
  status: FollowUpInstructionStatus
  priority: number
  created_at: string
  processed_at?: string
}

type AIToolType = 'claude' | 'codex' | 'other'

interface AIToolLimits {
  tool_type: AIToolType
  daily_token_limit: number | null
  monthly_token_limit: number | null
  daily_cost_limit_usd: number | null
  monthly_cost_limit_usd: number | null
}

interface UsageWithLimits {
  tool_type: AIToolType
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost_usd: number
  invocation_count: number
  avg_duration_ms: number
  limits: AIToolLimits | null
  daily_tokens_used: number
  monthly_tokens_used: number
  daily_cost_used: number
  monthly_cost_used: number
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

type ProjectInfo = { projectId: string; projectKey: string; projectPath: string }

const projectOpenedListeners = new Set<(info: ProjectInfo) => void>()
const projectClosingListeners = new Set<() => void>()
let lastProjectInfo: ProjectInfo | null = null

ipcRenderer.on('projectOpened', (_event: IpcRendererEvent, info: ProjectInfo) => {
  lastProjectInfo = info
  for (const listener of projectOpenedListeners) {
    listener(info)
  }
})

ipcRenderer.on('projectClosing', () => {
  lastProjectInfo = null
  for (const listener of projectClosingListeners) {
    listener()
  }
})

// ============================================================================
// Project API Implementation
// ============================================================================

const projectAPI: ProjectAPI = {
  // -------------------------------------------------------------------------
  // Project Lifecycle
  // -------------------------------------------------------------------------

  onProjectOpened: (callback) => {
    projectOpenedListeners.add(callback)
    if (lastProjectInfo) {
      queueMicrotask(() => {
        if (lastProjectInfo && projectOpenedListeners.has(callback)) {
          callback(lastProjectInfo)
        }
      })
    }
    return () => {
      projectOpenedListeners.delete(callback)
    }
  },

  onProjectClosing: (callback) => {
    projectClosingListeners.add(callback)
    return () => {
      projectClosingListeners.delete(callback)
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

  ensureProjectRemote: (projectId: string) => {
    return ipcRenderer.invoke('ensureProjectRemote', { projectId })
  },

  createCard: async (data: {
    title: string
    body?: string
    createType: 'local' | 'repo_issue' | 'github_issue' | 'gitlab_issue'
  }) => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) throw new Error('No active project')
    const result = (await ipcRenderer.invoke('createCard', {
      projectId,
      title: data.title,
      body: data.body,
      createType: data.createType
    })) as { card?: Card; error?: string }

    if (result?.error) throw new Error(result.error)
    if (!result?.card) throw new Error('Failed to create card')
    return result.card
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
  // Plan Approval
  // -------------------------------------------------------------------------

  getPendingApprovals: () => {
    const projectId = lastProjectInfo?.projectId
    return ipcRenderer.invoke('getPendingApprovals', projectId ? { projectId } : undefined)
  },

  getPlanApproval: (params: { approvalId?: string; jobId?: string }) => {
    return ipcRenderer.invoke('getPlanApproval', params)
  },

  approvePlan: (approvalId: string, notes?: string) => {
    return ipcRenderer.invoke('approvePlan', { approvalId, notes })
  },

  rejectPlan: (approvalId: string, notes?: string) => {
    return ipcRenderer.invoke('rejectPlan', { approvalId, notes })
  },

  skipPlanApproval: (approvalId: string) => {
    return ipcRenderer.invoke('skipPlanApproval', { approvalId })
  },

  onPlanApprovalRequired: (callback: (data: { projectId: string; cardId: string; jobId: string; approvalId: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { projectId: string; cardId: string; jobId: string; approvalId: string }) => {
      callback(data)
    }
    ipcRenderer.on('planApprovalRequired', handler)
    return () => {
      ipcRenderer.removeListener('planApprovalRequired', handler)
    }
  },

  // -------------------------------------------------------------------------
  // Follow-up Instructions
  // -------------------------------------------------------------------------

  getFollowUpInstructions: (params: { jobId?: string; cardId?: string; pendingOnly?: boolean }) => {
    const projectId = lastProjectInfo?.projectId
    return ipcRenderer.invoke('getFollowUpInstructions', { ...params, projectId })
  },

  createFollowUpInstruction: (data: {
    jobId: string
    cardId: string
    instructionType: FollowUpInstructionType
    content: string
    priority?: number
  }) => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('createFollowUpInstruction', { ...data, projectId })
  },

  deleteFollowUpInstruction: (instructionId: string) => {
    return ipcRenderer.invoke('deleteFollowUpInstruction', { instructionId })
  },

  countPendingInstructions: (jobId: string) => {
    return ipcRenderer.invoke('countPendingInstructions', { jobId })
  },

  // -------------------------------------------------------------------------
  // Usage Tracking
  // -------------------------------------------------------------------------

  getTotalUsage: () => {
    return ipcRenderer.invoke('usage:getTotal')
  },

  getUsageWithLimits: () => {
    return ipcRenderer.invoke('usage:getWithLimits')
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
  },

  // -------------------------------------------------------------------------
  // Patchwork workspace (.patchwork)
  // -------------------------------------------------------------------------

  getWorkspaceStatus: () => {
    return ipcRenderer.invoke('project:getWorkspaceStatus')
  },

  ensureWorkspace: () => {
    return ipcRenderer.invoke('project:ensureWorkspace')
  },

  indexBuild: () => {
    return ipcRenderer.invoke('project:indexBuild')
  },

  indexRefresh: () => {
    return ipcRenderer.invoke('project:indexRefresh')
  },

  indexWatchStart: () => {
    return ipcRenderer.invoke('project:indexWatchStart')
  },

  indexWatchStop: () => {
    return ipcRenderer.invoke('project:indexWatchStop')
  },

  validateConfig: () => {
    return ipcRenderer.invoke('project:validateConfig')
  },

  docsRefresh: () => {
    return ipcRenderer.invoke('project:docsRefresh')
  },

  contextPreview: (task: string) => {
    return ipcRenderer.invoke('project:contextPreview', { task })
  },

  repairWorkspace: () => {
    return ipcRenderer.invoke('project:repairWorkspace')
  },

  migrateWorkspace: () => {
    return ipcRenderer.invoke('project:migrateWorkspace')
  },

  openWorkspaceFolder: () => {
    return ipcRenderer.invoke('project:openWorkspaceFolder')
  },

  retrieve: (kind: 'symbol' | 'text', query: string, limit?: number) => {
    return ipcRenderer.invoke('project:retrieve', { kind, query, limit })
  },

  getPatchworkConfig: () => {
    return ipcRenderer.invoke('project:getPatchworkConfig')
  },

  // -------------------------------------------------------------------------
  // Configuration Sync
  // -------------------------------------------------------------------------

  syncConfig: (priorityOverride?: 'database' | 'file') => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('syncProjectConfig', { projectId, priorityOverride })
  },

  getConfig: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('getProjectConfig', { projectId })
  },

  updateFeatureConfig: (featureKey: string, config: Record<string, unknown>) => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('updateFeatureConfig', { projectId, featureKey, config })
  },

  getConfigSyncPriority: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('getConfigSyncPriority', { projectId })
  },

  setConfigSyncPriority: (priority: 'database' | 'file') => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('setConfigSyncPriority', { projectId, priority })
  },

  startConfigWatcher: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('startConfigFileWatcher', { projectId })
  },

  stopConfigWatcher: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('stopConfigFileWatcher', { projectId })
  },

  onConfigChanged: (
    callback: (data: { policy: PolicyConfig; source: 'database' | 'file' | 'merged' }) => void
  ) => {
    const handler = (_event: IpcRendererEvent, data: { policy: PolicyConfig; source: 'database' | 'file' | 'merged' }) => {
      callback(data)
    }
    ipcRenderer.on('configChanged', handler)
    return () => {
      ipcRenderer.removeListener('configChanged', handler)
    }
  }
}

// ============================================================================
// Electron API for CardDrawer compatibility
// ============================================================================

const allowedInvokeChannels = [
  'getThemePreference',
  'setThemePreference',
  'getSystemTheme',
  // AI drafting
  'generateCardDescription',
  'generateCardList',
  'listWorktrees',
  'openWorktreeFolder',
  'removeWorktree',
  'recreateWorktree',
  // Onboarding dialogs (LabelSetupDialog, GithubProjectPromptDialog)
  'getRepoOnboardingState',
  'listRepoLabels',
  'applyLabelConfig',
  'dismissLabelWizard',
  'dismissStarterCardsWizard',
  'completeStarterCardsWizard',
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
