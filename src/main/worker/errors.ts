/**
 * Worker Pipeline Errors
 *
 * Custom error classes for worker pipeline control flow.
 */

/**
 * Error thrown when a worker job is canceled.
 * Used for control flow to cleanly exit the pipeline.
 */
export class WorkerCanceledError extends Error {
  constructor(message = 'Canceled') {
    super(message)
    this.name = 'WorkerCanceledError'
  }
}

/**
 * Error thrown when a worker is waiting for plan approval.
 * Contains the approval ID for tracking.
 */
export class WorkerPendingApprovalError extends Error {
  constructor(public planApprovalId: string) {
    super('Pending plan approval')
    this.name = 'WorkerPendingApprovalError'
  }
}

/**
 * Error thrown when the pipeline times out.
 */
export class PipelineTimeoutError extends Error {
  public readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Pipeline timed out after ${timeoutMs}ms`)
    this.name = 'PipelineTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * Error thrown when a git operation fails.
 */
export class GitOperationError extends Error {
  public readonly command: string
  public readonly exitCode?: number

  constructor(message: string, command: string, exitCode?: number) {
    super(message)
    this.name = 'GitOperationError'
    this.command = command
    this.exitCode = exitCode
  }
}

/**
 * Error thrown when slot acquisition fails due to race condition.
 */
export class SlotAcquisitionError extends Error {
  public readonly slotNumber: number

  constructor(slotNumber: number) {
    super(`Failed to acquire slot ${slotNumber}`)
    this.name = 'SlotAcquisitionError'
    this.slotNumber = slotNumber
  }
}

/**
 * Error thrown when a transient operation fails after retries.
 */
export class RetryExhaustedError extends Error {
  public readonly operation: string
  public readonly attempts: number
  public readonly lastError?: Error

  constructor(operation: string, attempts: number, lastError?: Error) {
    super(`${operation} failed after ${attempts} attempts`)
    this.name = 'RetryExhaustedError'
    this.operation = operation
    this.attempts = attempts
    this.lastError = lastError
  }
}
