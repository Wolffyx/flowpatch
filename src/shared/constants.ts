/**
 * Shared constants used across the application.
 */

import type { CardStatus, JobType, EventType, WorktreeStatus, PolicyConfig } from './types'

// ============================================================================
// Card Status Constants
// ============================================================================

/**
 * All valid card statuses in order.
 */
export const CARD_STATUSES: readonly CardStatus[] = [
  'draft',
  'ready',
  'in_progress',
  'in_review',
  'testing',
  'failed',
  'done'
] as const

/**
 * Statuses that indicate active work.
 */
export const ACTIVE_STATUSES: readonly CardStatus[] = [
  'ready',
  'in_progress',
  'in_review',
  'testing'
] as const

/**
 * Statuses that allow worker processing.
 */
export const WORKER_ALLOWED_STATUSES: readonly CardStatus[] = ['ready', 'in_progress'] as const

/**
 * Statuses that allow manual testing.
 */
export const TESTABLE_STATUSES: readonly CardStatus[] = ['ready', 'in_progress', 'in_review'] as const

// ============================================================================
// Job Type Constants
// ============================================================================

/**
 * All valid job types.
 */
export const JOB_TYPES: readonly JobType[] = [
  'sync_poll',
  'sync_push',
  'worker_run',
  'webhook_ingest',
  'workspace_ensure',
  'index_build',
  'index_refresh',
  'index_watch_start',
  'index_watch_stop',
  'docs_refresh',
  'config_validate',
  'context_preview',
  'repair',
  'migrate'
] as const

/**
 * Job states that indicate completion.
 */
export const COMPLETED_JOB_STATES = ['succeeded', 'failed', 'canceled'] as const

/**
 * Job states that indicate active processing.
 */
export const ACTIVE_JOB_STATES = ['queued', 'running'] as const

// ============================================================================
// Event Type Constants
// ============================================================================

/**
 * All valid event types.
 */
export const EVENT_TYPES: readonly EventType[] = [
  'status_changed',
  'synced',
  'worker_plan',
  'worker_run',
  'worker_log',
  'pr_created',
  'error',
  'card_created',
  'card_linked',
  'card_split',
  'task_decomposed'
] as const

// ============================================================================
// Worktree Status Constants
// ============================================================================

/**
 * All valid worktree statuses.
 */
export const WORKTREE_STATUSES: readonly WorktreeStatus[] = [
  'creating',
  'ready',
  'running',
  'cleanup_pending',
  'cleaned',
  'error'
] as const

/**
 * Worktree statuses that indicate active use.
 */
export const ACTIVE_WORKTREE_STATUSES: readonly WorktreeStatus[] = [
  'creating',
  'ready',
  'running'
] as const

// ============================================================================
// Checks / Lint Fix Constants
// ============================================================================

/** Max characters of lint output to include in AI fix prompt (avoids token overflow). */
export const LINT_OUTPUT_MAX_CHARS = 8000

/** Default number of AI fix attempts when lint fails (0 = disable). */
export const LINT_FIX_ATTEMPTS_DEFAULT = 1

/** Maximum allowed lint fix attempts (safety cap). */
export const LINT_FIX_ATTEMPTS_MAX = 3

/** Max characters of test output to include in AI fix prompt. */
export const TEST_OUTPUT_MAX_CHARS = 12000

/** Default number of AI fix attempts when tests fail (0 = disable). */
export const TEST_FIX_ATTEMPTS_DEFAULT = 0

/** Maximum allowed test fix attempts (safety cap). */
export const TEST_FIX_ATTEMPTS_MAX = 3

// ============================================================================
// Default Labels
// ============================================================================

/**
 * Default status label prefix.
 */
export const DEFAULT_STATUS_LABEL_PREFIX = 'status::'

/**
 * Default status labels mapping.
 */
export const DEFAULT_STATUS_LABELS = {
  draft: 'Draft',
  ready: 'Ready',
  inProgress: 'In Progress',
  inReview: 'In Review',
  testing: 'Testing',
  done: 'Done'
} as const

/**
 * Default ready label for sync.
 */
export const DEFAULT_READY_LABEL = 'ready'

// ============================================================================
// Worker Defaults
// ============================================================================

/**
 * Default maximum worker execution time in minutes.
 */
export const DEFAULT_WORKER_MAX_MINUTES = 25

/**
 * Default branch pattern for worker-created branches.
 */
export const DEFAULT_BRANCH_PATTERN = 'kanban/{id}-{slug}'

/**
 * Default commit message pattern.
 */
export const DEFAULT_COMMIT_MESSAGE = '#{issue} {title}'

/**
 * Default worktree branch prefix.
 */
export const DEFAULT_WORKTREE_BRANCH_PREFIX = 'flowpatch/'

/**
 * Default maximum concurrent worktrees.
 */
export const DEFAULT_MAX_CONCURRENT_WORKTREES = 1

/**
 * Default cleanup delay in minutes.
 */
export const DEFAULT_CLEANUP_DELAY_MINUTES = 30

// ============================================================================
// Sync Defaults
// ============================================================================

/**
 * Default polling fallback interval in minutes.
 */
export const DEFAULT_POLLING_FALLBACK_MINUTES = 3

// ============================================================================
// Lease/Lock Defaults
// ============================================================================

/**
 * Default job lease duration in seconds.
 */
export const DEFAULT_JOB_LEASE_SECONDS = 300

/**
 * Default worktree lock duration in minutes.
 */
export const DEFAULT_WORKTREE_LOCK_MINUTES = 10

// ============================================================================
// UI Constants
// ============================================================================

/**
 * Maximum logs to keep in memory per job.
 */
export const MAX_WORKER_LOGS_PER_JOB = 1000

/**
 * Maximum logs to keep in shell logs panel.
 */
export const MAX_SHELL_LOGS = 500

/**
 * Job retry cooldown in minutes.
 */
export const DEFAULT_RETRY_COOLDOWN_MINUTES = 30

// ============================================================================
// Kanban Board Constants
// ============================================================================

/**
 * Column configuration for the Kanban board.
 */
export const KANBAN_COLUMNS: { id: CardStatus; label: string; color: string }[] = [
  { id: 'draft', label: 'Draft', color: 'bg-muted-foreground' },
  { id: 'ready', label: 'Ready', color: 'bg-chart-1' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-chart-4' },
  { id: 'in_review', label: 'In Review', color: 'bg-chart-5' },
  { id: 'testing', label: 'Testing', color: 'bg-chart-3' },
  { id: 'failed', label: 'Failed', color: 'bg-destructive' },
  { id: 'done', label: 'Done', color: 'bg-chart-2' }
]

// ============================================================================
// Default Policy Configuration
// ============================================================================

/**
 * Default policy configuration for new projects.
 */
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
      failed: 'Failed',
      done: 'Done'
    },
    githubProjectsV2: {},
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
    lintFixAttempts: 1,
    testCommand: 'pnpm test',
    buildCommand: 'pnpm build',
    forbidPaths: ['.github/workflows/', '.gitlab-ci.yml'],
    draftAiTimeoutSeconds: 300,
    worktree: {
      enabled: false,
      root: 'repo',
      branchPrefix: 'flowpatch/',
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
      contextCarryover: 'summary',
      minimalContinuationPrompt: true
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
