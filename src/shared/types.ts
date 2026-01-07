// Shared types between main and renderer processes

// Theme types
export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export type CardStatus = 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'

export type Provider = 'github' | 'gitlab' | 'local'

export type CardType = 'issue' | 'pr' | 'draft' | 'mr' | 'local'

export type SyncState = 'ok' | 'pending' | 'error'

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'blocked' | 'pending_approval'

/** Status of plan approval */
export type PlanApprovalStatus = 'pending' | 'approved' | 'rejected' | 'skipped'

export type JobType =
  | 'sync_poll'
  | 'sync_push'
  | 'worker_run'
  | 'webhook_ingest'
  | 'workspace_ensure'
  | 'index_build'
  | 'index_refresh'
  | 'index_watch_start'
  | 'index_watch_stop'
  | 'docs_refresh'
  | 'config_validate'
  | 'context_preview'
  | 'repair'
  | 'migrate'

export interface JobProgress {
  percent?: number
  stage?: string
  detail?: string
}

export interface JobResultEnvelope {
  summary?: string
  progress?: JobProgress
  artifacts?: unknown
}

export type PatchworkIndexState = 'missing' | 'ready' | 'stale' | 'building' | 'blocked'

export interface PatchworkIndexStatus {
  state: PatchworkIndexState
  headSha: string | null
  lastIndexedSha: string | null
  lastIndexedAt: string | null
  warnings?: string[]
}

export interface PatchworkWorkspaceStatus {
  repoRoot: string
  exists: boolean
  writable: boolean
  gitignoreHasStateIgnore: boolean
  hasConfig: boolean
  hasDocs: boolean
  hasScripts: boolean
  hasState: boolean
  index: PatchworkIndexStatus
  watchEnabled: boolean
  autoIndexingEnabled: boolean
}

export type EventType =
  | 'status_changed'
  | 'synced'
  | 'worker_plan'
  | 'worker_run'
  | 'worker_log'
  | 'pr_created'
  | 'error'
  | 'card_created'
  | 'card_linked'
  | 'task_decomposed'
  | 'e2e_tests_run'
  | 'plan_approval_requested'
  | 'plan_approved'
  | 'plan_rejected'
  | 'plan_skipped'
  | 'follow_up_instruction_added'
  | 'follow_up_instruction_applied'
  | 'follow_up_instruction_rejected'
  | 'card_updated'
  | 'card_deleted'

// Subtask status for decomposed tasks
export type SubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

// Worker slot status for pool management
export type WorkerSlotStatus = 'idle' | 'running' | 'cleanup'

// Worker state for UI display
export type WorkerState = 'idle' | 'processing' | 'waiting' | 'error'

// Worktree status for tracking lifecycle
export type WorktreeStatus =
  | 'creating'
  | 'ready'
  | 'running'
  | 'cleanup_pending'
  | 'cleaned'
  | 'error'

// Worktree root location options
export type WorktreeRoot = 'repo' | 'sibling' | 'custom'

// Worktree cleanup timing options
export type WorktreeCleanupTiming = 'immediate' | 'delay' | 'never'

export interface WorkerStatus {
  state: WorkerState
  activeCardId?: string
  activeCardTitle?: string
  activeJobId?: string
  lastError?: string
  lastRunAt?: string
}

export interface WorkerLogMessage {
  projectId: string
  jobId: string
  cardId?: string
  ts: string
  line: string
  source?: string
  stream?: 'stdout' | 'stderr'
}

// ============================================================================
// Shell/Project Architecture Types
// ============================================================================

/**
 * Log entry for the log store.
 */
export interface LogEntry {
  id: string
  ts: string
  projectKey: string
  projectId?: string
  jobId?: string
  cardId?: string
  source: string
  stream: 'stdout' | 'stderr' | 'info' | 'error' | 'warn'
  line: string
}

/**
 * Activity state for a single project.
 */
export interface ProjectActivity {
  projectId: string
  activeRuns: number
  isBusy: boolean
  lastUpdated: string
}

/**
 * Global activity state across all projects.
 */
export interface GlobalActivity {
  totalActiveRuns: number
  isBusy: boolean
  busyProjects: string[]
}

/**
 * Summary of an open project for the shell.
 */
export interface OpenProjectSummary {
  projectId: string
  projectKey: string
  projectPath: string
  projectName: string
}

export interface Project {
  id: string
  name: string
  local_path: string
  local_path_exists?: boolean
  selected_remote_name: string | null
  remote_repo_key: string | null
  provider_hint: 'auto' | 'github' | 'gitlab'
  policy_json: string | null
  worker_enabled: number
  last_sync_at: string | null
  created_at: string
  updated_at: string
}

export interface Card {
  id: string
  project_id: string
  provider: Provider
  type: CardType
  title: string
  body: string | null
  status: CardStatus
  ready_eligible: number
  assignees_json: string | null
  labels_json: string | null
  remote_url: string | null
  remote_repo_key: string | null
  remote_number_or_iid: string | null
  remote_node_id: string | null
  updated_remote_at: string | null
  updated_local_at: string
  sync_state: SyncState
  last_error: string | null
  has_conflicts: number
}

export interface CardLink {
  id: string
  card_id: string
  linked_type: 'pr' | 'mr'
  linked_url: string
  linked_remote_repo_key: string | null
  linked_number_or_iid: string | null
  created_at: string
}

export interface Worktree {
  id: string
  project_id: string
  card_id: string
  job_id: string | null
  worktree_path: string
  branch_name: string
  base_ref: string
  status: WorktreeStatus
  last_error: string | null
  locked_by: string | null
  lock_expires_at: string | null
  cleanup_requested_at: string | null
  created_at: string
  updated_at: string
}

export interface Event {
  id: string
  project_id: string
  card_id: string | null
  type: EventType
  payload_json: string | null
  created_at: string
}

export interface Job {
  id: string
  project_id: string
  card_id: string | null
  type: JobType
  state: JobState
  lease_until: string | null
  attempts: number
  payload_json: string | null
  result_json: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

// ============================================================================
// Usage Tracking Types
// ============================================================================

/** AI tool/agent type for usage tracking */
export type AIToolType = 'claude' | 'codex' | 'opencode' | 'cursor' | 'other'

/** Usage record for a single AI tool invocation */
export interface UsageRecord {
  id: string
  project_id: string
  job_id: string | null
  card_id: string | null
  tool_type: AIToolType
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number | null
  duration_ms: number
  model: string | null
  created_at: string
}

/** Aggregated usage statistics for an AI tool */
export interface UsageStats {
  tool_type: AIToolType
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost_usd: number
  invocation_count: number
  avg_duration_ms: number
}

/** Usage summary across all tools */
export interface UsageSummary {
  total_tokens: number
  total_cost_usd: number
  by_tool: UsageStats[]
  period_start: string
  period_end: string
}

/** Tool limits configuration */
export interface AIToolLimits {
  tool_type: AIToolType
  hourly_token_limit: number | null
  daily_token_limit: number | null
  monthly_token_limit: number | null
  hourly_cost_limit_usd: number | null
  daily_cost_limit_usd: number | null
  monthly_cost_limit_usd: number | null
}

/** Usage with limit info for display */
export interface UsageWithLimits extends UsageStats {
  limits: AIToolLimits | null
  hourly_tokens_used: number
  daily_tokens_used: number
  monthly_tokens_used: number
  hourly_cost_used: number
  daily_cost_used: number
  monthly_cost_used: number
}

/** Reset time information for usage limits */
export interface UsageResetTimes {
  /** Seconds until hourly limit resets */
  hourly_resets_in: number
  /** Seconds until daily limit resets */
  daily_resets_in: number
  /** Seconds until monthly limit resets */
  monthly_resets_in: number
}

/** Response from getUsageWithLimits including reset times */
export interface UsageWithLimitsResponse {
  usageWithLimits: UsageWithLimits[]
  resetTimes: UsageResetTimes
}

// ============================================================================
// Worker Pool & Autonomous Worker Types
// ============================================================================

/**
 * Worker pool configuration for parallel processing
 */
export interface WorkerPoolConfig {
  /** Maximum concurrent workers per project (1-8) */
  maxWorkers: number
  /** Strategy for picking next card to process */
  queueStrategy: 'fifo' | 'priority'
  /** Label prefix for priority (e.g., "priority::") */
  priorityField?: string
}

/**
 * Task decomposition configuration
 */
export interface TaskDecompositionConfig {
  /** Enable automatic task decomposition */
  enabled: boolean
  /** When to decompose: 'auto' uses AI judgment, 'always'/'never' are explicit */
  threshold: 'auto' | 'always' | 'never'
  /** Create GitHub/GitLab issues for subtasks (default: true) */
  createSubIssues: boolean
  /** Maximum subtasks per card (3-10) */
  maxSubtasks: number
}

/**
 * AI session configuration for iterative processing
 */
export interface AISessionConfig {
  /** Single long session vs multiple short sessions */
  sessionMode: 'single' | 'iterative'
  /** Maximum iterations for iterative mode */
  maxIterations: number
  /** Save progress between sessions */
  progressCheckpoint: boolean
  /** How much context to carry between sessions */
  contextCarryover?: 'full' | 'summary' | 'none'
}

/**
 * E2E testing configuration for worker pipeline
 */
export interface E2ETestConfig {
  /** Enable E2E testing phase */
  enabled: boolean
  /** Test framework (currently only playwright supported) */
  framework: 'playwright'
  /** Maximum fix attempts when tests fail (1-10) */
  maxRetries: number
  /** Timeout in minutes for each E2E test run */
  timeoutMinutes: number
  /** E2E test command (e.g., "npx playwright test") */
  testCommand?: string
  /** Whether AI should create tests if none exist */
  createTestsIfMissing: boolean
  /** Directories to look for existing e2e tests */
  testDirectories?: string[]
  /** Tool priority for fixes: always try Claude first, fall back to Codex */
  fixToolPriority: 'claude-first'
}

/**
 * Subtask entity for decomposed tasks
 */
export interface Subtask {
  id: string
  parent_card_id: string
  project_id: string
  title: string
  description: string | null
  estimated_minutes: number | null
  sequence: number
  status: SubtaskStatus
  remote_issue_number: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

/**
 * Worker slot for pool management
 */
export interface WorkerSlot {
  id: string
  project_id: string
  slot_number: number
  card_id: string | null
  job_id: string | null
  worktree_id: string | null
  status: WorkerSlotStatus
  started_at: string | null
  updated_at: string
}

/**
 * Progress tracking for iterative AI sessions
 */
export interface WorkerProgress {
  id: string
  card_id: string
  job_id: string | null
  iteration: number
  total_iterations: number
  subtask_index: number
  subtasks_completed: number
  files_modified_json: string | null
  context_summary: string | null
  progress_file_path: string | null
  last_checkpoint: string
  created_at: string
  updated_at: string
}

export interface RemoteInfo {
  name: string
  url: string
  provider: 'github' | 'gitlab' | 'unknown'
  repoKey: string
}

/**
 * Plan approval request for review before AI execution
 */
export interface PlanApproval {
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

/** Status of follow-up instruction */
export type FollowUpInstructionStatus = 'pending' | 'processing' | 'applied' | 'rejected'

/** Type of follow-up instruction */
export type FollowUpInstructionType = 'revision' | 'clarification' | 'additional' | 'abort'

/**
 * Follow-up instruction for providing feedback to running/paused workers
 */
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

// ============================================================================
// Agent Chat Types
// ============================================================================

/** Role of the chat message sender */
export type AgentChatRole = 'user' | 'agent' | 'system'

/** Status of an agent chat message */
export type AgentChatMessageStatus = 'sent' | 'delivered' | 'read' | 'error'

/**
 * A chat message between user and agent during worker execution
 */
export interface AgentChatMessage {
  id: string
  job_id: string
  card_id: string
  project_id: string
  role: AgentChatRole
  content: string
  status: AgentChatMessageStatus
  /** Optional metadata like tool usage, thinking, etc. */
  metadata_json?: string
  created_at: string
  updated_at?: string
}

/**
 * Summary of unread chat messages for UI badges
 */
export interface AgentChatSummary {
  job_id: string
  total_messages: number
  unread_count: number
  last_message_at?: string
  last_agent_message?: string
}

// ============================================================================
// Feature Configuration Types
// ============================================================================

/** Extended thinking mode for AI reasoning depth */
export type ThinkingMode = 'none' | 'medium' | 'deep' | 'ultra'

/** Planning mode for task execution strategy */
export type PlanningMode = 'skip' | 'lite' | 'spec' | 'full'

/** Merge strategy for multi-agent execution */
export type MergeStrategy = 'sequential' | 'parallel-merge'

/** Conflict resolution strategy for multi-agent merges */
export type ConflictResolution = 'auto' | 'manual'

/** Config sync priority when conflicts occur */
export type ConfigSyncPriority = 'database' | 'file'

/** Diff viewer display mode */
export type DiffViewMode = 'side-by-side' | 'inline'

/** Graph layout algorithm */
export type GraphLayout = 'dagre' | 'force'

/** Usage export format */
export type UsageExportFormat = 'csv' | 'json'

/**
 * Extended thinking configuration for AI reasoning
 */
export interface ThinkingConfig {
  /** Enable extended thinking mode */
  enabled: boolean
  /** Thinking depth level */
  mode: ThinkingMode
  /** Token budget for thinking (medium=1024, deep=4096, ultra=16384) */
  budgetTokens?: number
}

/**
 * Planning mode configuration for task execution
 */
export interface PlanningConfig {
  /** Enable planning modes */
  enabled: boolean
  /** Default planning mode */
  mode: PlanningMode
  /** Require user approval before execution (for full mode) */
  approvalRequired: boolean
}

/**
 * Multi-agent execution configuration
 */
export interface MultiAgentConfig {
  /** Enable multi-agent task execution */
  enabled: boolean
  /** Strategy for merging agent work */
  mergeStrategy: MergeStrategy
  /** How to handle merge conflicts */
  conflictResolution: ConflictResolution
  /** Maximum agents per card */
  maxAgentsPerCard?: number
}

/**
 * Agent chat configuration
 */
export interface ChatConfig {
  /** Enable agent chat feature */
  enabled: boolean
  /** Persist chat sessions to disk */
  persistSessions: boolean
  /** Maximum messages to keep in history */
  maxHistoryMessages: number
}

/**
 * Audio notifications configuration
 */
export interface NotificationsConfig {
  /** Enable audio notifications */
  audioEnabled: boolean
  /** Play sound on task completion */
  soundOnComplete: boolean
  /** Play sound on errors */
  soundOnError: boolean
  /** Play sound when approval is needed */
  soundOnApproval: boolean
}

/**
 * Git diff viewer configuration
 */
export interface DiffViewerConfig {
  /** Enable diff viewer feature */
  enabled: boolean
  /** Default diff display mode */
  defaultView: DiffViewMode
  /** Show minimap in diff editor */
  showMinimap: boolean
}

/**
 * Dependency graph view configuration
 */
export interface GraphViewConfig {
  /** Enable graph view feature */
  enabled: boolean
  /** Default graph layout algorithm */
  defaultLayout: GraphLayout
  /** Show minimap in graph view */
  showMinimap: boolean
}

/**
 * Usage tracking configuration
 */
export interface UsageTrackingConfig {
  /** Enable usage tracking */
  enabled: boolean
  /** Track cost estimates */
  trackCosts: boolean
  /** Default export format */
  exportFormat: UsageExportFormat
}

/**
 * Image attachment configuration
 */
export interface ImagesConfig {
  /** Enable image attachments */
  enabled: boolean
  /** Maximum image size in MB */
  maxSizeMb: number
  /** Allowed image formats */
  allowedFormats: string[]
}

/**
 * AI model provider options
 */
export type AIModelProvider = 'anthropic' | 'openai' | 'auto'

/**
 * Individual AI profile definition
 */
export interface AIProfile {
  /** Unique profile ID */
  id: string
  /** Project ID this profile belongs to */
  project_id: string
  /** Display name for the profile */
  name: string
  /** Optional description */
  description?: string
  /** Whether this is the default profile for the project */
  is_default: boolean

  // Model configuration
  /** Model provider (anthropic, openai, auto) */
  model_provider: AIModelProvider
  /** Specific model name (e.g., claude-3-opus, gpt-4) */
  model_name?: string

  // Model parameters
  /** Temperature setting (0.0-1.0) */
  temperature?: number
  /** Maximum tokens for response */
  max_tokens?: number
  /** Top-p (nucleus sampling) value */
  top_p?: number

  // Custom instructions
  /** Custom system prompt/instructions */
  system_prompt?: string

  // AI Features
  /** Enable extended thinking */
  thinking_enabled?: boolean
  /** Thinking mode level */
  thinking_mode?: ThinkingMode
  /** Token budget for thinking */
  thinking_budget_tokens?: number

  /** Enable planning mode */
  planning_enabled?: boolean
  /** Planning mode level */
  planning_mode?: PlanningMode

  // Timestamps
  created_at: string
  updated_at: string
}

/**
 * AI profiles configuration
 */
export interface AIProfilesConfig {
  /** Enable AI profiles feature */
  enabled: boolean
  /** Default profile ID to use */
  defaultProfileId?: string
}

/**
 * Feature suggestions configuration
 */
export interface FeatureSuggestionsConfig {
  /** Enable feature suggestions */
  enabled: boolean
  /** Auto-generate suggestions on project analysis */
  autoSuggestOnAnalysis: boolean
}

/**
 * Feature suggestion status
 */
export type FeatureSuggestionStatus = 'open' | 'in_progress' | 'completed' | 'rejected'

/**
 * Feature suggestion category
 */
export type FeatureSuggestionCategory = 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'

/**
 * Feature suggestion entity
 */
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

/**
 * Feature suggestion vote
 */
export interface FeatureSuggestionVote {
  id: string
  suggestion_id: string
  voter_id?: string
  vote_type: 'up' | 'down'
  created_at: string
}

/**
 * Dependency type for card relationships
 */
export type DependencyType = 'blocks' | 'blocked_by'

/**
 * Card dependency relationship
 */
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

/**
 * Card dependency with related card info for display
 */
export interface CardDependencyWithCard extends CardDependency {
  depends_on_card?: Card
  card?: Card
}

/**
 * Result of checking if a card can move to a status
 */
export interface DependencyCheckResult {
  canMove: boolean
  blockedBy: CardDependencyWithCard[]
  reason?: string
}

/**
 * Card dependency configuration
 */
export interface DependenciesConfig {
  /** Enable card dependencies */
  enabled: boolean
  /** Block card execution if dependencies incomplete */
  blockOnIncomplete: boolean
  /** Show dependency badges on Kanban cards */
  showInKanban: boolean
}

/**
 * Follow-up instructions configuration
 */
export interface FollowUpInstructionsConfig {
  /** Enable follow-up instructions for running agents */
  enabled: boolean
  /** Maximum pending messages in queue */
  maxQueueSize: number
}

/**
 * All feature configurations grouped together
 */
export interface FeaturesConfig {
  /** Extended thinking configuration */
  thinking?: ThinkingConfig
  /** Planning mode configuration */
  planning?: PlanningConfig
  /** Multi-agent execution configuration */
  multiAgent?: MultiAgentConfig
  /** Agent chat configuration */
  chat?: ChatConfig
  /** Audio notifications configuration */
  notifications?: NotificationsConfig
  /** Diff viewer configuration */
  diffViewer?: DiffViewerConfig
  /** Graph view configuration */
  graphView?: GraphViewConfig
  /** Usage tracking configuration */
  usageTracking?: UsageTrackingConfig
  /** Image attachments configuration */
  images?: ImagesConfig
  /** AI profiles configuration */
  aiProfiles?: AIProfilesConfig
  /** Feature suggestions configuration */
  featureSuggestions?: FeatureSuggestionsConfig
  /** Card dependencies configuration */
  dependencies?: DependenciesConfig
  /** Follow-up instructions configuration */
  followUpInstructions?: FollowUpInstructionsConfig
}

export interface PolicyConfig {
  version: number
  ui?: {
    showPullRequestsSection?: boolean
  }
  repo?: {
    provider?: 'auto' | 'github' | 'gitlab'
    gitlab?: {
      host?: string
    }
  }
  sync?: {
    webhookPreferred?: boolean
    pollingFallbackMinutes?: number
    readyLabel?: string
    statusLabels?: {
      draft?: string
      ready?: string
      inProgress?: string
      inReview?: string
      testing?: string
      done?: string
    }
    githubProjectsV2?: {
      enabled?: boolean
      projectId?: string
      statusFieldName?: string
      statusValues?: {
        draft?: string
        ready?: string
        inProgress?: string
        inReview?: string
        testing?: string
        done?: string
      }
    }
    /** Config sync priority when conflicts occur between DB and file */
    configPriority?: ConfigSyncPriority
    /** Sync config on startup */
    syncOnStartup?: boolean
    /** Watch .patchwork/config.yml for external changes */
    watchFileChanges?: boolean
    /** Interval in milliseconds for automatic polling (default: 180000 = 3 minutes) */
    pollInterval?: number
    /** Enable automatic sync after worker actions (default: true) */
    autoSyncOnAction?: boolean
    /** Debounce delay in milliseconds for rapid actions (default: 5000) */
    debounceDelay?: number
  }
  /** Feature configurations for optional capabilities */
  features?: FeaturesConfig
  worker?: {
    enabled?: boolean
    toolPreference?: 'auto' | 'claude' | 'codex' | 'opencode' | 'cursor'
    planFirst?: boolean
    maxMinutes?: number
    allowNetwork?: boolean
    rollbackOnCancel?: boolean
    branchPattern?: string
    /** Primary branch the worker should pull from before starting (e.g., main or master). */
    baseBranch?: string
    commitMessage?: string
    allowedCommands?: string[]
    lintCommand?: string
    testCommand?: string
    buildCommand?: string
    forbidPaths?: string[]
    /** Lease renewal interval in milliseconds (default: 60000). Used to keep jobs alive. */
    leaseRenewalIntervalMs?: number
    /** Overall pipeline timeout in milliseconds (default: 30 minutes). Prevents infinite runs. */
    pipelineTimeoutMs?: number
    /** Maximum retry attempts for transient failures in pipeline phases (default: 3). */
    maxRetries?: number
    /** Initial retry delay in milliseconds (default: 1000). */
    retryDelayMs?: number
    worktree?: {
      enabled?: boolean
      root?: WorktreeRoot
      customPath?: string
      baseBranch?: string
      branchPrefix?: string
      cleanup?: {
        onSuccess?: WorktreeCleanupTiming
        onFailure?: WorktreeCleanupTiming
        delayMinutes?: number
      }
      maxConcurrent?: number
      skipInstallIfCached?: boolean
    }
    /** Worker pool configuration for parallel processing */
    pool?: WorkerPoolConfig
    /** Task decomposition configuration */
    decomposition?: TaskDecompositionConfig
    /** AI session configuration for iterative processing */
    session?: AISessionConfig
    /** E2E testing configuration */
    e2e?: E2ETestConfig
  }
}

// IPC Request/Response types
export interface OpenRepoResult {
  canceled?: boolean
  error?: string
  project?: Project
  remotes?: RemoteInfo[]
  needSelection?: boolean
}

export type RepoVisibility = 'public' | 'private'
export type RemoteProviderChoice = 'none' | 'github' | 'gitlab'

export interface SelectDirectoryResult {
  canceled?: boolean
  error?: string
  path?: string
}

export interface CreateRepoPayload {
  repoName: string
  localParentPath: string
  addReadme?: boolean
  initialCommit?: boolean
  initialCommitMessage?: string
  remoteProvider?: RemoteProviderChoice
  remoteVisibility?: RepoVisibility
  remoteName?: string
  pushToRemote?: boolean
  githubOwner?: string
  gitlabHost?: string
  gitlabNamespace?: string
}

export interface CreateRepoResult {
  canceled?: boolean
  error?: string
  warnings?: string[]
  repoPath?: string
  project?: Project
  remotes?: RemoteInfo[]
  needSelection?: boolean
}

export interface SelectRemotePayload {
  projectId: string
  remoteName: string
  remoteUrl: string
  repoKey: string
}

export interface MoveCardPayload {
  cardId: string
  status: CardStatus
}

export interface CreateTestCardPayload {
  projectId: string
  title: string
}

export interface SyncPayload {
  projectId: string
}

export interface ToggleWorkerPayload {
  projectId: string
  enabled: boolean
}

export interface RunWorkerPayload {
  projectId: string
  cardId?: string
}

export interface RepoLabel {
  name: string
  color?: string
  description?: string
}

export interface ListRepoLabelsPayload {
  projectId: string
}

export interface ListRepoLabelsResult {
  labels: RepoLabel[]
  error?: string
}

export interface CreateRepoLabelsPayload {
  projectId: string
  labels: RepoLabel[]
}

export interface CreateRepoLabelsResult {
  created: string[]
  skipped: string[]
  error?: string
}

export interface ApplyLabelConfigPayload {
  projectId: string
  readyLabel: string
  statusLabels: NonNullable<NonNullable<PolicyConfig['sync']>['statusLabels']>
  createMissingLabels: boolean
}

export interface RepoOnboardingState {
  shouldShowLabelWizard: boolean
  shouldPromptGithubProject: boolean
  shouldShowStarterCardsWizard: boolean
}

export interface AppState {
  projects: {
    project: Project
    cards: Card[]
    cardLinks: CardLink[]
    events: Event[]
    jobs: Job[]
  }[]
}

// Column configuration for the Kanban board
export const KANBAN_COLUMNS: { id: CardStatus; label: string; color: string }[] = [
  { id: 'draft', label: 'Draft', color: 'bg-muted-foreground' },
  { id: 'ready', label: 'Ready', color: 'bg-chart-1' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-chart-4' },
  { id: 'in_review', label: 'In Review', color: 'bg-chart-5' },
  { id: 'testing', label: 'Testing', color: 'bg-chart-3' },
  { id: 'done', label: 'Done', color: 'bg-chart-2' }
]

// Utility functions
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

/**
 * Generate a safe branch name for worktrees.
 * Format: {prefix}{provider}-{numberOrId}-{slug}
 * Max length: 100 chars, safe charset: a-z0-9-/
 */
export function generateWorktreeBranchName(
  provider: Provider,
  numberOrId: string | number | null,
  title: string,
  prefix: string = 'patchwork/'
): string {
  // Normalize prefix to end with /
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`

  // Create ID part
  const idPart = numberOrId ? String(numberOrId) : 'local'

  // Create slug from title
  const slug = slugify(title)

  // Build full branch name
  const fullName = `${normalizedPrefix}${provider}-${idPart}-${slug}`

  // Ensure max length of 100 chars (git branch name limit is 244, but keep it reasonable)
  if (fullName.length > 100) {
    // Truncate slug to fit
    const prefixAndId = `${normalizedPrefix}${provider}-${idPart}-`
    const maxSlugLen = 100 - prefixAndId.length
    return `${prefixAndId}${slug.slice(0, Math.max(maxSlugLen, 10))}`
  }

  return fullName
}

// Default policy configuration
export const DEFAULT_POLICY: PolicyConfig = {
  version: 1,
  ui: {
    showPullRequestsSection: false
  },
  sync: {
    webhookPreferred: true,
    pollingFallbackMinutes: 3,
    readyLabel: 'ready',
    statusLabels: {
      draft: 'Draft',
      ready: 'Ready',
      inProgress: 'In Progress',
      inReview: 'In Review',
      testing: 'Testing',
      done: 'Done'
    },
    githubProjectsV2: {
      enabled: false
    },
    configPriority: 'database',
    syncOnStartup: true,
    watchFileChanges: true,
    pollInterval: 180000,
    autoSyncOnAction: true,
    debounceDelay: 5000
  },
  features: {
    thinking: {
      enabled: false,
      mode: 'none',
      budgetTokens: 4096
    },
    planning: {
      enabled: true,
      mode: 'lite',
      approvalRequired: false
    },
    multiAgent: {
      enabled: false,
      mergeStrategy: 'sequential',
      conflictResolution: 'auto',
      maxAgentsPerCard: 3
    },
    chat: {
      enabled: true,
      persistSessions: true,
      maxHistoryMessages: 500
    },
    notifications: {
      audioEnabled: false,
      soundOnComplete: true,
      soundOnError: true,
      soundOnApproval: true
    },
    diffViewer: {
      enabled: true,
      defaultView: 'side-by-side',
      showMinimap: false
    },
    graphView: {
      enabled: true,
      defaultLayout: 'dagre',
      showMinimap: true
    },
    usageTracking: {
      enabled: true,
      trackCosts: true,
      exportFormat: 'csv'
    },
    images: {
      enabled: true,
      maxSizeMb: 10,
      allowedFormats: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']
    },
    aiProfiles: {
      enabled: true
    },
    featureSuggestions: {
      enabled: true,
      autoSuggestOnAnalysis: false
    },
    dependencies: {
      enabled: true,
      blockOnIncomplete: true,
      showInKanban: true
    },
    followUpInstructions: {
      enabled: true,
      maxQueueSize: 10
    }
  },
  worker: {
    enabled: true,
    toolPreference: 'auto',
    planFirst: true,
    maxMinutes: 25,
    allowNetwork: false,
    rollbackOnCancel: false,
    branchPattern: 'kanban/{id}-{slug}',
    commitMessage: '#{issue} {title}',
    allowedCommands: ['pnpm install', 'pnpm lint', 'pnpm test', 'pnpm build'],
    lintCommand: 'pnpm lint',
    testCommand: 'pnpm test',
    buildCommand: 'pnpm build',
    forbidPaths: ['.github/workflows/', '.gitlab-ci.yml'],
    worktree: {
      enabled: false,
      root: 'repo',
      branchPrefix: 'patchwork/',
      cleanup: {
        onSuccess: 'immediate',
        onFailure: 'delay',
        delayMinutes: 30
      },
      maxConcurrent: 1,
      skipInstallIfCached: false
    },
    pool: {
      maxWorkers: 1,
      queueStrategy: 'fifo'
    },
    decomposition: {
      enabled: false,
      threshold: 'auto',
      createSubIssues: true,
      maxSubtasks: 5
    },
    session: {
      sessionMode: 'single',
      maxIterations: 5,
      progressCheckpoint: false,
      contextCarryover: 'summary'
    },
    e2e: {
      enabled: false,
      framework: 'playwright',
      maxRetries: 3,
      timeoutMinutes: 10,
      createTestsIfMissing: true,
      testDirectories: ['e2e', 'tests/e2e', 'test/e2e'],
      fixToolPriority: 'claude-first'
    }
  }
}

// ============================================================================
// Security Types
// ============================================================================

/**
 * Security context for IPC requests.
 * Tracks the origin and trust level of a request.
 */
export interface SecurityContext {
  /** Unique identifier for the WebContents that sent the request */
  webContentsId: number
  /** Frame URL that initiated the request */
  frameUrl: string
  /** Whether the request came from a trusted source (main window or project tabs) */
  isTrusted: boolean
  /** Timestamp when the request was made */
  timestamp: number
  /** Request nonce for replay protection */
  nonce: string
}

/**
 * Signed IPC request wrapper.
 * All security-sensitive IPC calls should be wrapped in this structure.
 */
export interface SignedRequest<T = unknown> {
  /** The actual payload of the request */
  payload: T
  /** HMAC signature of the payload + nonce + timestamp */
  signature: string
  /** Unique nonce to prevent replay attacks */
  nonce: string
  /** Timestamp when the request was signed */
  timestamp: number
  /** WebContents ID of the sender (verified by main process) */
  senderId?: number
}

/**
 * Result of security verification.
 */
export interface SecurityVerificationResult {
  /** Whether the request passed all security checks */
  valid: boolean
  /** Error message if validation failed */
  error?: string
  /** The verified security context if valid */
  context?: SecurityContext
}

/**
 * Command execution request that has passed security checks.
 * Only commands wrapped in this type should be executed.
 */
export interface SecureCommandRequest {
  /** The command to execute */
  command: string
  /** Command arguments */
  args: string[]
  /** Working directory */
  cwd: string
  /** Security context proving this request is authorized */
  securityContext: SecurityContext
  /** Whether this command was explicitly allowed by policy */
  policyApproved: boolean
}

/**
 * Security audit log entry.
 * Used for tracking security-related events.
 */
export interface SecurityAuditEntry {
  /** Event type */
  type: 'ipc_request' | 'command_execution' | 'security_violation' | 'origin_rejected'
  /** Timestamp of the event */
  timestamp: string
  /** WebContents ID involved */
  webContentsId?: number
  /** Details about the event */
  details: Record<string, unknown>
  /** Whether the request was allowed */
  allowed: boolean
  /** Reason for rejection if not allowed */
  rejectionReason?: string
}

/**
 * Security configuration for the application.
 */
export interface SecurityConfig {
  /** Whether to enforce IPC origin verification */
  enforceOriginCheck: boolean
  /** Whether to require request signatures */
  requireSignatures: boolean
  /** Maximum age of a signed request in milliseconds (for replay protection) */
  maxRequestAgeMs: number
  /** Whether to log security audit events */
  enableAuditLog: boolean
  /** List of IPC channels that require security verification */
  securedChannels: string[]
}

/**
 * Execution origin types for command execution.
 * Used to distinguish between trusted UI actions and potentially malicious sources.
 */
export type ExecutionOrigin = 
  | 'user_action'      // Direct user interaction (button click, etc.)
  | 'worker_pipeline'  // Internal worker pipeline execution
  | 'ipc_request'      // IPC request from renderer
  | 'ai_output'        // Command suggested by AI (potentially untrusted)
  | 'external'         // External source (should be blocked)

/**
 * Command guard configuration for a project.
 */
export interface CommandGuardConfig {
  /** Allowed commands (from policy) */
  allowedCommands: string[]
  /** Forbidden paths that commands cannot modify */
  forbiddenPaths: string[]
  /** Whether to allow network access */
  allowNetwork: boolean
  /** Maximum execution time in minutes */
  maxMinutes: number
}

// Re-export IPC types for convenient importing
export * from './types/ipc'
