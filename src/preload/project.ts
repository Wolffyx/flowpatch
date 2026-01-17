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
import type {
  AIToolType,
  Card,
  CardLink,
  CardStatus,
  Event,
  FollowUpInstructionStatus,
  FollowUpInstructionType,
  Job,
  PlanApproval,
  PlanningMode,
  PolicyConfig,
  Project,
  WorkerLogMessage
} from '../shared/types'

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
    shouldShowStarterCardsWizard?: boolean
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
  splitCard: (data: {
    cardId: string
    items: Array<{ title: string; body?: string }>
  }) => Promise<{ cards: Card[]; error?: string }>
  editCardBody: (cardId: string, body: string | null) => Promise<{ card?: Card; error?: string }>
  deleteCard: (cardId: string) => Promise<{ success: boolean; error?: string }>

  // Sync
  sync: () => Promise<void>
  onSyncComplete: (callback: () => void) => () => void

  // Worker
  isWorkerEnabled: () => Promise<boolean>
  toggleWorker: (enabled: boolean) => Promise<void>
  runWorker: (cardId?: string) => Promise<void>
  cancelWorker: (jobId: string) => Promise<void>

  // Dev Server (Test Mode)
  getCardTestInfo: (projectId: string, cardId: string) => Promise<{
    success: boolean
    hasWorktree?: boolean
    worktreePath?: string
    branchName?: string | null
    repoPath?: string
    projectType?: { type: string; hasPackageJson: boolean; port?: number }
    commands?: { install?: string; dev?: string; build?: string }
    error?: string
  }>
  startDevServer: (params: {
    projectId: string
    cardId: string
    workingDir: string
    command: string
    args: string[]
    env?: Record<string, string>
  }) => Promise<{ success: boolean; status?: string; port?: number; error?: string }>
  stopDevServer: (cardId: string) => Promise<{ success: boolean; error?: string }>
  getDevServerStatus: (cardId: string) => Promise<{
    success: boolean
    status?: string | null
    port?: number
    startedAt?: string
    error?: string
    output?: string[]
  }>
  onDevServerOutput: (callback: (data: { cardId: string; line: string; stream: 'stdout' | 'stderr'; timestamp: string }) => void) => () => void
  onDevServerStatus: (callback: (data: { cardId: string; status: string; timestamp: string }) => void) => () => void
  onDevServerPort: (callback: (data: { cardId: string; port: number; url: string; timestamp: string }) => void) => () => void

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
  getUsageWithLimits: () => Promise<{ usageWithLimits: UsageWithLimits[]; resetTimes: UsageResetTimes }>
  setToolLimits: (
    toolType: AIToolType,
    limits: {
      hourlyTokenLimit?: number | null
      dailyTokenLimit?: number | null
      monthlyTokenLimit?: number | null
      hourlyCostLimitUsd?: number | null
      dailyCostLimitUsd?: number | null
      monthlyCostLimitUsd?: number | null
    }
  ) => Promise<{ success: boolean; limits: AIToolLimits; error?: string }>

  // Diff Viewer
  getDiffFiles: (worktreeId: string) => Promise<{ files: DiffFile[]; error?: string }>
  getDiffStats: (worktreeId: string) => Promise<{ stats: DiffStats | null; error?: string }>
  getFileDiff: (worktreeId: string, filePath: string) => Promise<{ diff: FileDiff | null; error?: string }>
  getUnifiedDiff: (worktreeId: string, filePath?: string) => Promise<{ patch: string; error?: string }>

  // Agent Chat
  sendChatMessage: (params: {
    jobId: string
    cardId: string
    content: string
    metadata?: Record<string, unknown>
  }) => Promise<{ message: AgentChatMessage; error?: string }>
  getChatMessages: (jobId: string, limit?: number) => Promise<{ messages: AgentChatMessage[]; error?: string }>
  getChatMessagesByCard: (cardId: string, limit?: number) => Promise<{ messages: AgentChatMessage[]; error?: string }>
  getChatSummary: (jobId: string) => Promise<{ summary: AgentChatSummary; error?: string }>
  getChatUnreadCount: (jobId: string) => Promise<{ count: number; error?: string }>
  markChatAsRead: (jobId: string) => Promise<{ success: boolean; error?: string }>
  clearChatHistory: (jobId: string) => Promise<{ success: boolean; count: number; error?: string }>
  onChatMessage: (callback: (data: { type: string; message: AgentChatMessage; jobId: string }) => void) => () => void

  // AI Profiles
  getAIProfiles: () => Promise<{ profiles: AIProfile[]; error?: string }>
  getAIProfile: (profileId: string) => Promise<{ profile: AIProfile | null; error?: string }>
  getDefaultAIProfile: () => Promise<{ profile: AIProfile | null; error?: string }>
  createAIProfile: (data: CreateAIProfileData) => Promise<{ profile: AIProfile | null; error?: string }>
  updateAIProfile: (profileId: string, data: UpdateAIProfileData) => Promise<{ profile: AIProfile | null; error?: string }>
  deleteAIProfile: (profileId: string) => Promise<{ success: boolean; error?: string }>
  setDefaultAIProfile: (profileId: string) => Promise<{ success: boolean; error?: string }>
  duplicateAIProfile: (profileId: string, newName: string) => Promise<{ profile: AIProfile | null; error?: string }>

  // Feature Suggestions
  getFeatureSuggestions: (options?: {
    status?: FeatureSuggestionStatus
    category?: FeatureSuggestionCategory
    sortBy?: 'vote_count' | 'created_at' | 'priority' | 'updated_at'
    sortOrder?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }) => Promise<{ suggestions: FeatureSuggestion[]; error?: string }>
  getFeatureSuggestion: (suggestionId: string) => Promise<{ suggestion: FeatureSuggestion | null; error?: string }>
  createFeatureSuggestion: (data: {
    title: string
    description: string
    category?: FeatureSuggestionCategory
    priority?: number
    createdBy?: string
  }) => Promise<{ suggestion: FeatureSuggestion | null; error?: string }>
  updateFeatureSuggestion: (suggestionId: string, data: UpdateFeatureSuggestionData) => Promise<{ suggestion: FeatureSuggestion | null; error?: string }>
  updateFeatureSuggestionStatus: (suggestionId: string, status: FeatureSuggestionStatus) => Promise<{ success: boolean; error?: string }>
  deleteFeatureSuggestion: (suggestionId: string) => Promise<{ success: boolean; error?: string }>
  voteOnSuggestion: (suggestionId: string, voteType: 'up' | 'down', voterId?: string) => Promise<{ voteCount: number; userVote: 'up' | 'down' | null; error?: string }>
  getUserVote: (suggestionId: string, voterId?: string) => Promise<{ voteType: 'up' | 'down' | null; error?: string }>

  // Card Dependencies
  createDependency: (data: {
    cardId: string
    dependsOnCardId: string
    blockingStatuses?: CardStatus[]
    requiredStatus?: CardStatus
  }) => Promise<{ dependency: CardDependency | null; error?: string }>
  getDependency: (dependencyId: string) => Promise<{ dependency: CardDependency | null; error?: string }>
  getDependenciesForCard: (cardId: string) => Promise<{ dependencies: CardDependency[]; error?: string }>
  getDependenciesForCardWithCards: (cardId: string) => Promise<{ dependencies: CardDependencyWithCard[]; error?: string }>
  getDependentsOfCard: (cardId: string) => Promise<{ dependencies: CardDependency[]; error?: string }>
  getDependenciesByProject: () => Promise<{ dependencies: CardDependency[]; error?: string }>
  countDependenciesForCard: (cardId: string) => Promise<{ count: number; dependentsCount: number; error?: string }>
  checkCanMoveToStatus: (cardId: string, targetStatus: CardStatus) => Promise<DependencyCheckResult>
  checkWouldCreateCycle: (cardId: string, dependsOnCardId: string) => Promise<{ wouldCreateCycle: boolean; error?: string }>
  updateDependency: (dependencyId: string, data: {
    blockingStatuses?: CardStatus[]
    requiredStatus?: CardStatus
    isActive?: boolean
  }) => Promise<{ dependency: CardDependency | null; error?: string }>
  toggleDependency: (dependencyId: string, isActive: boolean) => Promise<{ success: boolean; error?: string }>
  deleteDependency: (dependencyId: string) => Promise<{ success: boolean; error?: string }>
  deleteDependencyBetween: (cardId: string, dependsOnCardId: string) => Promise<{ success: boolean; error?: string }>

  // State updates
  onStateUpdate: (callback: () => void) => () => void
  onWorkerLog: (callback: (log: WorkerLogMessage) => void) => () => void

  // Jobs
  getJobs: () => Promise<Job[]>

  // Events
  getEvents: (limit?: number) => Promise<Event[]>

  // FlowPatch workspace (.flowpatch)
  getWorkspaceStatus: () => Promise<import('../shared/types').FlowPatchWorkspaceStatus | null>
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
  getFlowPatchConfig: () => Promise<unknown>
  createPlanFile: () => Promise<{
    success: boolean
    created?: boolean
    path?: string
    error?: string
    message?: string
  }>

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

// Local types not in @shared/types
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

interface AIToolLimits {
  tool_type: AIToolType
  hourly_token_limit: number | null
  daily_token_limit: number | null
  monthly_token_limit: number | null
  hourly_cost_limit_usd: number | null
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
  hourly_tokens_used: number
  daily_tokens_used: number
  monthly_tokens_used: number
  hourly_cost_used: number
  daily_cost_used: number
  monthly_cost_used: number
}

interface UsageResetTimes {
  hourly_resets_in: number
  daily_resets_in: number
  monthly_resets_in: number
}

// Diff viewer types
interface DiffFile {
  path: string
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
  additions: number
  deletions: number
  oldPath?: string
}

interface DiffStats {
  filesChanged: number
  additions: number
  deletions: number
}

interface FileDiff {
  filePath: string
  oldContent: string
  newContent: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

// Agent Chat types
type AgentChatRole = 'user' | 'agent' | 'system'
type AgentChatMessageStatus = 'sent' | 'delivered' | 'read' | 'error'

interface AgentChatMessage {
  id: string
  job_id: string
  card_id: string
  project_id: string
  role: AgentChatRole
  content: string
  status: AgentChatMessageStatus
  metadata_json?: string
  created_at: string
  updated_at?: string
}

interface AgentChatSummary {
  job_id: string
  total_messages: number
  unread_count: number
  last_message_at?: string
  last_agent_message?: string
}

// AI Profile types
type AIModelProvider = 'anthropic' | 'openai' | 'auto'
type ThinkingMode = 'none' | 'medium' | 'deep' | 'ultra'
// PlanningMode already defined above

interface AIProfile {
  id: string
  project_id: string
  name: string
  description?: string
  is_default: boolean
  model_provider: AIModelProvider
  model_name?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  system_prompt?: string
  thinking_enabled?: boolean
  thinking_mode?: ThinkingMode
  thinking_budget_tokens?: number
  planning_enabled?: boolean
  planning_mode?: PlanningMode
  created_at: string
  updated_at: string
}

interface CreateAIProfileData {
  projectId: string
  name: string
  description?: string
  isDefault?: boolean
  modelProvider?: AIModelProvider
  modelName?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  systemPrompt?: string
  thinkingEnabled?: boolean
  thinkingMode?: ThinkingMode
  thinkingBudgetTokens?: number
  planningEnabled?: boolean
  planningMode?: PlanningMode
}

interface UpdateAIProfileData {
  name?: string
  description?: string
  isDefault?: boolean
  modelProvider?: AIModelProvider
  modelName?: string | null
  temperature?: number | null
  maxTokens?: number | null
  topP?: number | null
  systemPrompt?: string | null
  thinkingEnabled?: boolean | null
  thinkingMode?: ThinkingMode | null
  thinkingBudgetTokens?: number | null
  planningEnabled?: boolean | null
  planningMode?: PlanningMode | null
}

// Feature Suggestion types
type FeatureSuggestionStatus = 'open' | 'in_progress' | 'completed' | 'rejected'
type FeatureSuggestionCategory = 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'

interface FeatureSuggestion {
  id: string
  project_id: string
  title: string
  description: string
  category: FeatureSuggestionCategory
  priority: number
  vote_count: number
  status: FeatureSuggestionStatus
  created_by?: string
  created_at: string
  updated_at: string
}

interface CreateFeatureSuggestionData {
  projectId: string
  title: string
  description: string
  category?: FeatureSuggestionCategory
  priority?: number
  createdBy?: string
}

interface UpdateFeatureSuggestionData {
  title?: string
  description?: string
  category?: FeatureSuggestionCategory
  priority?: number
  status?: FeatureSuggestionStatus
}

// Card Dependency types
interface CardDependency {
  id: string
  project_id: string
  card_id: string
  depends_on_card_id: string
  blocking_statuses: CardStatus[]
  required_status: CardStatus
  is_active: number
  created_at: string
  updated_at: string
}

interface CardDependencyWithCard extends CardDependency {
  depends_on_card?: {
    id: string
    project_id: string
    title: string
    status: CardStatus
  }
  card?: {
    id: string
    project_id: string
    title: string
    status: CardStatus
  }
}

interface DependencyCheckResult {
  canMove: boolean
  blockedBy: CardDependencyWithCard[]
  reason?: string
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
  splitCard: (data) => {
    return ipcRenderer.invoke('splitCard', data)
  },

  editCardBody: (cardId: string, body: string | null) => {
    return ipcRenderer.invoke('editCardBody', { cardId, body })
  },

  deleteCard: (cardId: string) => {
    return ipcRenderer.invoke('deleteCard', { cardId })
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
  // Dev Server (Test Mode)
  // -------------------------------------------------------------------------

  getCardTestInfo: (projectId: string, cardId: string) => {
    return ipcRenderer.invoke('getCardTestInfo', { projectId, cardId })
  },

  startDevServer: (params: {
    projectId: string
    cardId: string
    workingDir: string
    command: string
    args: string[]
    env?: Record<string, string>
  }) => {
    return ipcRenderer.invoke('startDevServer', params)
  },

  stopDevServer: (cardId: string) => {
    return ipcRenderer.invoke('stopDevServer', { cardId })
  },

  getDevServerStatus: (cardId: string) => {
    return ipcRenderer.invoke('getDevServerStatus', { cardId })
  },

  onDevServerOutput: (
    callback: (data: { cardId: string; line: string; stream: 'stdout' | 'stderr'; timestamp: string }) => void
  ) => {
    const handler = (_event: IpcRendererEvent, data: { cardId: string; line: string; stream: 'stdout' | 'stderr'; timestamp: string }) => {
      callback(data)
    }
    ipcRenderer.on('dev-server:output', handler)
    return () => {
      ipcRenderer.removeListener('dev-server:output', handler)
    }
  },

  onDevServerStatus: (callback: (data: { cardId: string; status: string; timestamp: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { cardId: string; status: string; timestamp: string }) => {
      callback(data)
    }
    ipcRenderer.on('dev-server:status', handler)
    return () => {
      ipcRenderer.removeListener('dev-server:status', handler)
    }
  },

  onDevServerPort: (callback: (data: { cardId: string; port: number; url: string; timestamp: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { cardId: string; port: number; url: string; timestamp: string }) => {
      callback(data)
    }
    ipcRenderer.on('dev-server:port', handler)
    return () => {
      ipcRenderer.removeListener('dev-server:port', handler)
    }
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

  setToolLimits: (
    toolType: AIToolType,
    limits: {
      hourlyTokenLimit?: number | null
      dailyTokenLimit?: number | null
      monthlyTokenLimit?: number | null
      hourlyCostLimitUsd?: number | null
      dailyCostLimitUsd?: number | null
      monthlyCostLimitUsd?: number | null
    }
  ) => {
    return ipcRenderer.invoke('usage:setToolLimits', {
      toolType,
      hourlyTokenLimit: limits.hourlyTokenLimit,
      dailyTokenLimit: limits.dailyTokenLimit,
      monthlyTokenLimit: limits.monthlyTokenLimit,
      hourlyCostLimitUsd: limits.hourlyCostLimitUsd,
      dailyCostLimitUsd: limits.dailyCostLimitUsd,
      monthlyCostLimitUsd: limits.monthlyCostLimitUsd
    })
  },

  // -------------------------------------------------------------------------
  // Diff Viewer
  // -------------------------------------------------------------------------

  getDiffFiles: (worktreeId: string) => {
    return ipcRenderer.invoke('diff:getFiles', worktreeId)
  },

  getDiffStats: (worktreeId: string) => {
    return ipcRenderer.invoke('diff:getStats', worktreeId)
  },

  getFileDiff: (worktreeId: string, filePath: string) => {
    return ipcRenderer.invoke('diff:getFileDiff', worktreeId, filePath)
  },

  getUnifiedDiff: (worktreeId: string, filePath?: string) => {
    return ipcRenderer.invoke('diff:getUnifiedDiff', worktreeId, filePath)
  },

  // -------------------------------------------------------------------------
  // Agent Chat
  // -------------------------------------------------------------------------

  sendChatMessage: (params: {
    jobId: string
    cardId: string
    content: string
    metadata?: Record<string, unknown>
  }) => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('chat:sendMessage', { ...params, projectId })
  },

  getChatMessages: (jobId: string, limit?: number) => {
    return ipcRenderer.invoke('chat:getMessages', { jobId, limit })
  },

  getChatMessagesByCard: (cardId: string, limit?: number) => {
    return ipcRenderer.invoke('chat:getMessagesByCard', { cardId, limit })
  },

  getChatSummary: (jobId: string) => {
    return ipcRenderer.invoke('chat:getSummary', jobId)
  },

  getChatUnreadCount: (jobId: string) => {
    return ipcRenderer.invoke('chat:getUnreadCount', jobId)
  },

  markChatAsRead: (jobId: string) => {
    return ipcRenderer.invoke('chat:markAsRead', jobId)
  },

  clearChatHistory: (jobId: string) => {
    return ipcRenderer.invoke('chat:clearHistory', jobId)
  },

  onChatMessage: (callback: (data: { type: string; message: AgentChatMessage; jobId: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { type: string; message: AgentChatMessage; jobId: string }) => {
      callback(data)
    }
    ipcRenderer.on('agentChatMessage', handler)
    return () => {
      ipcRenderer.removeListener('agentChatMessage', handler)
    }
  },

  // -------------------------------------------------------------------------
  // AI Profiles
  // -------------------------------------------------------------------------

  getAIProfiles: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.resolve({ profiles: [], error: 'No active project' })
    return ipcRenderer.invoke('aiProfiles:list', projectId)
  },

  getAIProfile: (profileId: string) => {
    return ipcRenderer.invoke('aiProfiles:get', profileId)
  },

  getDefaultAIProfile: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.resolve({ profile: null, error: 'No active project' })
    return ipcRenderer.invoke('aiProfiles:getDefault', projectId)
  },

  createAIProfile: (data: Omit<CreateAIProfileData, 'projectId'>) => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('aiProfiles:create', { ...data, projectId })
  },

  updateAIProfile: (profileId: string, data: UpdateAIProfileData) => {
    return ipcRenderer.invoke('aiProfiles:update', { profileId, data })
  },

  deleteAIProfile: (profileId: string) => {
    return ipcRenderer.invoke('aiProfiles:delete', profileId)
  },

  setDefaultAIProfile: (profileId: string) => {
    return ipcRenderer.invoke('aiProfiles:setDefault', profileId)
  },

  duplicateAIProfile: (profileId: string, newName: string) => {
    return ipcRenderer.invoke('aiProfiles:duplicate', { profileId, newName })
  },

  // -------------------------------------------------------------------------
  // Feature Suggestions
  // -------------------------------------------------------------------------

  getFeatureSuggestions: (options?: {
    status?: FeatureSuggestionStatus
    category?: FeatureSuggestionCategory
    sortBy?: 'vote_count' | 'created_at' | 'priority' | 'updated_at'
    sortOrder?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }) => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.resolve({ suggestions: [], error: 'No active project' })
    return ipcRenderer.invoke('featureSuggestions:list', { projectId, ...options })
  },

  getFeatureSuggestion: (suggestionId: string) => {
    return ipcRenderer.invoke('featureSuggestions:get', suggestionId)
  },

  createFeatureSuggestion: (data: Omit<CreateFeatureSuggestionData, 'projectId'>) => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('featureSuggestions:create', { ...data, projectId })
  },

  updateFeatureSuggestion: (suggestionId: string, data: UpdateFeatureSuggestionData) => {
    return ipcRenderer.invoke('featureSuggestions:update', { suggestionId, data })
  },

  updateFeatureSuggestionStatus: (suggestionId: string, status: FeatureSuggestionStatus) => {
    return ipcRenderer.invoke('featureSuggestions:updateStatus', { suggestionId, status })
  },

  deleteFeatureSuggestion: (suggestionId: string) => {
    return ipcRenderer.invoke('featureSuggestions:delete', suggestionId)
  },

  voteOnSuggestion: (suggestionId: string, voteType: 'up' | 'down', voterId?: string) => {
    return ipcRenderer.invoke('featureSuggestions:vote', { suggestionId, voteType, voterId })
  },

  getUserVote: (suggestionId: string, voterId?: string) => {
    return ipcRenderer.invoke('featureSuggestions:getUserVote', { suggestionId, voterId })
  },

  // -------------------------------------------------------------------------
  // Card Dependencies
  // -------------------------------------------------------------------------

  createDependency: (data: {
    cardId: string
    dependsOnCardId: string
    blockingStatuses?: CardStatus[]
    requiredStatus?: CardStatus
  }) => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.reject(new Error('No active project'))
    return ipcRenderer.invoke('dependencies:create', { ...data, projectId })
  },

  getDependency: (dependencyId: string) => {
    return ipcRenderer.invoke('dependencies:get', dependencyId)
  },

  getDependenciesForCard: (cardId: string) => {
    return ipcRenderer.invoke('dependencies:getForCard', cardId)
  },

  getDependenciesForCardWithCards: (cardId: string) => {
    return ipcRenderer.invoke('dependencies:getForCardWithCards', cardId)
  },

  getDependentsOfCard: (cardId: string) => {
    return ipcRenderer.invoke('dependencies:getDependents', cardId)
  },

  getDependenciesByProject: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.resolve({ dependencies: [], error: 'No active project' })
    return ipcRenderer.invoke('dependencies:getByProject', projectId)
  },

  countDependenciesForCard: (cardId: string) => {
    return ipcRenderer.invoke('dependencies:countForCard', cardId)
  },

  checkCanMoveToStatus: (cardId: string, targetStatus: CardStatus) => {
    return ipcRenderer.invoke('dependencies:checkCanMove', { cardId, targetStatus })
  },

  checkWouldCreateCycle: (cardId: string, dependsOnCardId: string) => {
    return ipcRenderer.invoke('dependencies:checkCycle', { cardId, dependsOnCardId })
  },

  updateDependency: (dependencyId: string, data: {
    blockingStatuses?: CardStatus[]
    requiredStatus?: CardStatus
    isActive?: boolean
  }) => {
    return ipcRenderer.invoke('dependencies:update', { dependencyId, data })
  },

  toggleDependency: (dependencyId: string, isActive: boolean) => {
    return ipcRenderer.invoke('dependencies:toggle', { dependencyId, isActive })
  },

  deleteDependency: (dependencyId: string) => {
    return ipcRenderer.invoke('dependencies:delete', dependencyId)
  },

  deleteDependencyBetween: (cardId: string, dependsOnCardId: string) => {
    return ipcRenderer.invoke('dependencies:deleteBetween', { cardId, dependsOnCardId })
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
  // FlowPatch workspace (.flowpatch)
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

  getFlowPatchConfig: () => {
    return ipcRenderer.invoke('project:getFlowPatchConfig')
  },

  createPlanFile: () => {
    return ipcRenderer.invoke('project:createPlanFile')
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
  'generateSplitCards',
  'listWorktrees',
  'openWorktreeFolder',
  'removeWorktree',
  'recreateWorktree',
  // Dev Server (Test Mode)
  'getCardTestInfo',
  'startDevServer',
  'stopDevServer',
  'getDevServerStatus',
  // Onboarding dialogs (LabelSetupDialog, GithubProjectPromptDialog)
  'getRepoOnboardingState',
  'listRepoLabels',
  'applyLabelConfig',
  'dismissLabelWizard',
  'dismissStarterCardsWizard',
  'completeStarterCardsWizard',
  'dismissGithubProjectPrompt',
  'createGithubProjectV2',
  'listGithubRepositoryProjects',
  'linkGithubProjectV2',
  // Sync Scheduler
  'getSyncSchedulerStatus'
]

const allowedSendChannels = ['openExternal']

const allowedOnChannels = ['themeChanged', 'dev-server:output', 'dev-server:status', 'dev-server:port']

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
