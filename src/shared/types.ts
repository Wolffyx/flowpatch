// Shared types between main and renderer processes

// Theme types
export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export type CardStatus = 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'

export type Provider = 'github' | 'gitlab' | 'local'

export type CardType = 'issue' | 'pr' | 'draft' | 'mr' | 'local'

export type SyncState = 'ok' | 'pending' | 'error'

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'blocked'

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
  }
  worker?: {
    enabled?: boolean
    toolPreference?: 'auto' | 'claude' | 'codex'
    planFirst?: boolean
    maxMinutes?: number
    allowNetwork?: boolean
    rollbackOnCancel?: boolean
    branchPattern?: string
    commitMessage?: string
    allowedCommands?: string[]
    lintCommand?: string
    testCommand?: string
    buildCommand?: string
    forbidPaths?: string[]
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
      draft: 'status::draft',
      ready: 'status::ready',
      inProgress: 'status::in-progress',
      inReview: 'status::in-review',
      testing: 'status::testing',
      done: 'status::done'
    },
    githubProjectsV2: {
      enabled: false
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
    }
  }
}

// Re-export IPC types for convenient importing
export * from './types/ipc'
