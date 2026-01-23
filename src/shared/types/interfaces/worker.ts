/**
 * Unified worker state for single source of truth.
 */
export type WorkerState =
  | 'idle' // No active work
  | 'queued' // Job queued, waiting to start
  | 'processing' // Worker running (AI, checks, etc.)
  | 'testing' // E2E tests running
  | 'pushing' // Commit/push/PR creation
  | 'paused' // Waiting for plan approval
  | 'failed' // Last run failed
  | 'succeeded' // Last run succeeded

/**
 * Represents a single worker error for error history tracking.
 */
export interface WorkerError {
  error: string
  cardId?: string
  cardTitle?: string
  jobId?: string
  phase?: string
  timestamp: string
}

/**
 * Unified worker status - single source of truth for worker state per project.
 */
export interface WorkerStatus {
  state: WorkerState
  activeCardId?: string
  activeCardTitle?: string
  activeJobId?: string
  currentPhase?: string
  lastError?: string
  lastFailedCardId?: string // Track which card failed for retry functionality
  lastRunAt?: string
  updatedAt: string
  errorHistory?: WorkerError[] // Recent errors (last 10)
}

/**
 * Per-project unified status including worker enabled flag.
 * Used by UI components.
 */
export interface ProjectWorkerStatus {
  projectId: string
  workerEnabled: boolean
  status: WorkerStatus
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
