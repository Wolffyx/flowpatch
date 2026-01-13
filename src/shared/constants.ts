/**
 * Shared constants used across the application.
 */

import type { CardStatus, JobType, EventType, WorktreeStatus } from './types'

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
