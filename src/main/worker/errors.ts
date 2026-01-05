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
