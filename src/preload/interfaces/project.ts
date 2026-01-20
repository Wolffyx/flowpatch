import type {
  AIToolType,
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
} from '../../shared/types'
import type { Card } from '../../shared/types'

export interface ProjectAPI {
  onProjectOpened: (
    callback: (info: { projectId: string; projectKey: string; projectPath: string }) => void
  ) => () => void
  onProjectClosing: (callback: () => void) => () => void

  getProject: (projectId: string) => Promise<Project | null>
  getRepoOnboardingState: (projectId: string) => Promise<{
    shouldShowLabelWizard?: boolean
    shouldPromptGithubProject?: boolean
    shouldShowStarterCardsWizard?: boolean
  }>

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
  pushCardToRemote: (cardId: string) => Promise<{
    card?: Card
    issueNumber?: number
    url?: string
    error?: string
  }>
  updateCardTimestamp: (cardId: string, timestamp: string) => Promise<{ success: boolean }>

  sync: () => Promise<void>
  onSyncComplete: (callback: () => void) => () => void

  isWorkerEnabled: () => Promise<boolean>
  toggleWorker: (enabled: boolean) => Promise<void>
  runWorker: (cardId?: string) => Promise<void>
  cancelWorker: (jobId: string) => Promise<void>

  getCardTestInfo: (
    projectId: string,
    cardId: string
  ) => Promise<{
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
  onDevServerOutput: (
    callback: (data: {
      cardId: string
      line: string
      stream: 'stdout' | 'stderr'
      timestamp: string
    }) => void
  ) => () => void
  onDevServerStatus: (
    callback: (data: { cardId: string; status: string; timestamp: string }) => void
  ) => () => void
  onDevServerPort: (
    callback: (data: { cardId: string; port: number; url: string; timestamp: string }) => void
  ) => () => void

  getPendingApprovals: () => Promise<{ approvals: PlanApproval[] }>
  getPlanApproval: (params: {
    approvalId?: string
    jobId?: string
  }) => Promise<{ approval?: PlanApproval; error?: string }>
  approvePlan: (approvalId: string, notes?: string) => Promise<{ success: boolean; error?: string }>
  rejectPlan: (approvalId: string, notes?: string) => Promise<{ success: boolean; error?: string }>
  skipPlanApproval: (approvalId: string) => Promise<{ success: boolean; error?: string }>
  onPlanApprovalRequired: (
    callback: (data: {
      projectId: string
      cardId: string
      jobId: string
      approvalId: string
    }) => void
  ) => () => void

  getFollowUpInstructions: (params: {
    jobId?: string
    cardId?: string
    pendingOnly?: boolean
  }) => Promise<{ instructions: FollowUpInstruction[]; error?: string }>
  createFollowUpInstruction: (data: {
    jobId: string
    cardId: string
    instructionType: FollowUpInstructionType
    content: string
    priority?: number
  }) => Promise<{ success: boolean; instruction?: FollowUpInstruction; error?: string }>
  deleteFollowUpInstruction: (
    instructionId: string
  ) => Promise<{ success: boolean; error?: string }>
  countPendingInstructions: (jobId: string) => Promise<{ count: number; error?: string }>

  getTotalUsage: () => Promise<{ usage: { tokens: number; cost: number } }>
  getUsageWithLimits: () => Promise<{
    usageWithLimits: UsageWithLimits[]
    resetTimes: UsageResetTimes
  }>
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

  getDiffFiles: (worktreeId: string) => Promise<{ files: DiffFile[]; error?: string }>
  getDiffStats: (worktreeId: string) => Promise<{ stats: DiffStats | null; error?: string }>
  getFileDiff: (
    worktreeId: string,
    filePath: string
  ) => Promise<{ diff: FileDiff | null; error?: string }>
  getUnifiedDiff: (
    worktreeId: string,
    filePath?: string
  ) => Promise<{ patch: string; error?: string }>

  sendChatMessage: (params: {
    jobId: string
    cardId: string
    content: string
    metadata?: Record<string, unknown>
  }) => Promise<{ message: AgentChatMessage; error?: string }>
  getChatMessages: (
    jobId: string,
    limit?: number
  ) => Promise<{ messages: AgentChatMessage[]; error?: string }>
  getChatMessagesByCard: (
    cardId: string,
    limit?: number
  ) => Promise<{ messages: AgentChatMessage[]; error?: string }>
  getChatSummary: (jobId: string) => Promise<{ summary: AgentChatSummary; error?: string }>
  getChatUnreadCount: (jobId: string) => Promise<{ count: number; error?: string }>
  markChatAsRead: (jobId: string) => Promise<{ success: boolean; error?: string }>
  clearChatHistory: (jobId: string) => Promise<{ success: boolean; count: number; error?: string }>
  onChatMessage: (
    callback: (data: { type: string; message: AgentChatMessage; jobId: string }) => void
  ) => () => void

  getAIProfiles: () => Promise<{ profiles: AIProfile[]; error?: string }>
  getAIProfile: (profileId: string) => Promise<{ profile: AIProfile | null; error?: string }>
  getDefaultAIProfile: () => Promise<{ profile: AIProfile | null; error?: string }>
  createAIProfile: (
    data: CreateAIProfileData
  ) => Promise<{ profile: AIProfile | null; error?: string }>
  updateAIProfile: (
    profileId: string,
    data: UpdateAIProfileData
  ) => Promise<{ profile: AIProfile | null; error?: string }>
  deleteAIProfile: (profileId: string) => Promise<{ success: boolean; error?: string }>
  setDefaultAIProfile: (profileId: string) => Promise<{ success: boolean; error?: string }>
  duplicateAIProfile: (
    profileId: string,
    newName: string
  ) => Promise<{ profile: AIProfile | null; error?: string }>

  getFeatureSuggestions: (options?: {
    status?: FeatureSuggestionStatus
    category?: FeatureSuggestionCategory
    sortBy?: 'vote_count' | 'created_at' | 'priority' | 'updated_at'
    sortOrder?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }) => Promise<{ suggestions: FeatureSuggestion[]; error?: string }>
  getFeatureSuggestion: (
    suggestionId: string
  ) => Promise<{ suggestion: FeatureSuggestion | null; error?: string }>
  createFeatureSuggestion: (data: {
    title: string
    description: string
    category?: FeatureSuggestionCategory
    priority?: number
    createdBy?: string
  }) => Promise<{ suggestion: FeatureSuggestion | null; error?: string }>
  updateFeatureSuggestion: (
    suggestionId: string,
    data: UpdateFeatureSuggestionData
  ) => Promise<{ suggestion: FeatureSuggestion | null; error?: string }>
  updateFeatureSuggestionStatus: (
    suggestionId: string,
    status: FeatureSuggestionStatus
  ) => Promise<{ success: boolean; error?: string }>
  deleteFeatureSuggestion: (suggestionId: string) => Promise<{ success: boolean; error?: string }>
  voteOnSuggestion: (
    suggestionId: string,
    voteType: 'up' | 'down',
    voterId?: string
  ) => Promise<{ voteCount: number; userVote: 'up' | 'down' | null; error?: string }>
  getUserVote: (
    suggestionId: string,
    voterId?: string
  ) => Promise<{ voteType: 'up' | 'down' | null; error?: string }>

  createDependency: (data: {
    cardId: string
    dependsOnCardId: string
    blockingStatuses?: CardStatus[]
    requiredStatus?: CardStatus
  }) => Promise<{ dependency: CardDependency | null; error?: string }>
  getDependency: (
    dependencyId: string
  ) => Promise<{ dependency: CardDependency | null; error?: string }>
  getDependenciesForCard: (
    cardId: string
  ) => Promise<{ dependencies: CardDependency[]; error?: string }>
  getDependenciesForCardWithCards: (
    cardId: string
  ) => Promise<{ dependencies: CardDependencyWithCard[]; error?: string }>
  getDependentsOfCard: (
    cardId: string
  ) => Promise<{ dependencies: CardDependency[]; error?: string }>
  getDependenciesByProject: () => Promise<{ dependencies: CardDependency[]; error?: string }>
  countDependenciesForCard: (
    cardId: string
  ) => Promise<{ count: number; dependentsCount: number; error?: string }>
  checkCanMoveToStatus: (cardId: string, targetStatus: CardStatus) => Promise<DependencyCheckResult>
  checkWouldCreateCycle: (
    cardId: string,
    dependsOnCardId: string
  ) => Promise<{ wouldCreateCycle: boolean; error?: string }>
  updateDependency: (
    dependencyId: string,
    data: {
      blockingStatuses?: CardStatus[]
      requiredStatus?: CardStatus
      isActive?: boolean
    }
  ) => Promise<{ dependency: CardDependency | null; error?: string }>
  toggleDependency: (
    dependencyId: string,
    isActive: boolean
  ) => Promise<{ success: boolean; error?: string }>
  deleteDependency: (dependencyId: string) => Promise<{ success: boolean; error?: string }>
  deleteDependencyBetween: (
    cardId: string,
    dependsOnCardId: string
  ) => Promise<{ success: boolean; error?: string }>

  onStateUpdate: (callback: () => void) => () => void
  onWorkerLog: (callback: (log: WorkerLogMessage) => void) => () => void

  getJobs: () => Promise<Job[]>
  getEvents: (limit?: number) => Promise<Event[]>
  getCardEvents: (cardId: string, limit?: number) => Promise<Event[]>
  getCardUsage: (cardId: string) => Promise<import('../../shared/types').UsageRecord[]>

  getWorkspaceStatus: () => Promise<import('../../shared/types').FlowPatchWorkspaceStatus | null>
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

  // Diagnostic methods for debugging worker issues
  getCardEligibilityDiagnostic: (cardId: string) => Promise<{
    diagnostic: CardEligibilityDiagnostic | null
  }>
  getReadyCardsNotProcessing: () => Promise<{
    diagnostics: CardEligibilityDiagnostic[]
    error?: string
  }>
}

export interface CardEligibilityDiagnostic {
  cardId: string
  cardTitle: string
  isEligible: boolean
  reasons: string[]
  details: {
    status: CardStatus
    provider: string
    hasRemoteRepoKey: boolean
    hasActiveJob: boolean
    isInCooldown: boolean
    isBlockedByDependencies: boolean
    cooldownEndsAt?: string
    blockingDependencies?: string[]
  }
}

export interface FollowUpInstruction {
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

export interface AIToolLimits {
  tool_type: AIToolType
  hourly_token_limit: number | null
  daily_token_limit: number | null
  monthly_token_limit: number | null
  hourly_cost_limit_usd: number | null
  daily_cost_limit_usd: number | null
  monthly_cost_limit_usd: number | null
}

export interface UsageWithLimits {
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

export interface UsageResetTimes {
  hourly_resets_in: number
  daily_resets_in: number
  monthly_resets_in: number
}

export interface DiffFile {
  path: string
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
  additions: number
  deletions: number
  oldPath?: string
}

export interface DiffStats {
  filesChanged: number
  additions: number
  deletions: number
}

export interface FileDiff {
  filePath: string
  oldContent: string
  newContent: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

export type AgentChatRole = 'user' | 'agent' | 'system'
export type AgentChatMessageStatus = 'sent' | 'delivered' | 'read' | 'error'

export interface AgentChatMessage {
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

export interface AgentChatSummary {
  job_id: string
  total_messages: number
  unread_count: number
  last_message_at?: string
  last_agent_message?: string
}

export type AIModelProvider = 'anthropic' | 'openai' | 'auto'
export type ThinkingMode = 'none' | 'medium' | 'deep' | 'ultra'

export interface AIProfile {
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

export interface CreateAIProfileData {
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

export interface UpdateAIProfileData {
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

export type FeatureSuggestionStatus = 'open' | 'in_progress' | 'completed' | 'rejected'
export type FeatureSuggestionCategory =
  | 'ui'
  | 'performance'
  | 'feature'
  | 'bug'
  | 'documentation'
  | 'other'

export interface FeatureSuggestion {
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

export interface CreateFeatureSuggestionData {
  projectId: string
  title: string
  description: string
  category?: FeatureSuggestionCategory
  priority?: number
  createdBy?: string
}

export interface UpdateFeatureSuggestionData {
  title?: string
  description?: string
  category?: FeatureSuggestionCategory
  priority?: number
  status?: FeatureSuggestionStatus
}

export interface CardDependency {
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

export interface CardDependencyWithCard extends CardDependency {
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

export interface DependencyCheckResult {
  canMove: boolean
  blockedBy: CardDependencyWithCard[]
  reason?: string
}

export type ProjectInfo = { projectId: string; projectKey: string; projectPath: string }
