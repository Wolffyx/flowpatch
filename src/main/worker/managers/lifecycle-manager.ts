/**
 * Lifecycle Manager
 *
 * Manages pipeline lifecycle concerns:
 * - Lease renewal to keep job alive
 * - Pipeline timeout to prevent infinite runs
 * - Cancellation detection (job state, worker enabled, card status)
 */

import { getProject, getCard, getJob, cancelJob, renewJobLease } from '../../db'
import { WorkerCanceledError, PipelineTimeoutError } from '../errors'

// Default configuration
const DEFAULT_LEASE_RENEWAL_MS = 60_000
const DEFAULT_PIPELINE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const DEFAULT_CANCEL_CHECK_THROTTLE_MS = 100 // Check cancellation at most every 100ms

export interface LifecycleConfig {
  projectId: string
  cardId: string
  jobId: string
  
  // Configurable intervals from policy
  leaseRenewalMs?: number
  pipelineTimeoutMs?: number
  cancelCheckThrottleMs?: number
}

/**
 * Manages pipeline lifecycle, lease renewal, timeout, and cancellation.
 */
export class LifecycleManager {
  private projectId: string
  private cardId: string
  private jobId: string
  
  private leaseRenewalMs: number
  private pipelineTimeoutMs: number
  private cancelCheckThrottleMs: number
  
  private leaseInterval: NodeJS.Timeout | null = null
  private pipelineTimeout: NodeJS.Timeout | null = null
  private pipelineStartTime: number = 0
  private lastCancelCheck: number = 0
  
  constructor(config: LifecycleConfig) {
    this.projectId = config.projectId
    this.cardId = config.cardId
    this.jobId = config.jobId
    
    this.leaseRenewalMs = config.leaseRenewalMs ?? DEFAULT_LEASE_RENEWAL_MS
    this.pipelineTimeoutMs = config.pipelineTimeoutMs ?? DEFAULT_PIPELINE_TIMEOUT_MS
    this.cancelCheckThrottleMs = config.cancelCheckThrottleMs ?? DEFAULT_CANCEL_CHECK_THROTTLE_MS
  }
  
  // ==================== Lifecycle Control ====================
  
  /**
   * Start lease renewal and pipeline timeout timers.
   */
  start(): void {
    this.pipelineStartTime = Date.now()
    
    // Start lease renewal
    this.leaseInterval = setInterval(() => {
      renewJobLease(this.jobId, 300, this.projectId)
    }, this.leaseRenewalMs)
    
    // Set up pipeline timeout
    this.pipelineTimeout = setTimeout(() => {
      this.cancelJobInternal(`Pipeline timed out after ${this.pipelineTimeoutMs}ms`)
    }, this.pipelineTimeoutMs)
  }
  
  /**
   * Stop all timers and cleanup.
   */
  stop(): void {
    if (this.leaseInterval) {
      clearInterval(this.leaseInterval)
      this.leaseInterval = null
    }
    if (this.pipelineTimeout) {
      clearTimeout(this.pipelineTimeout)
      this.pipelineTimeout = null
    }
  }
  
  // ==================== Cancellation Detection ====================
  
  /**
   * Get current job state.
   */
  private getJobState(): string | null {
    const job = getJob(this.jobId, this.projectId)
    return job?.state ?? null
  }
  
  /**
   * Check if the job is canceled.
   * Checks:
   * - Job state is 'canceled'
   * - Worker is globally disabled for project
   * - Card moved away from 'ready' status
   */
  isCanceled(): boolean {
    const jobState = this.getJobState()
    if (jobState === 'canceled') return true
    
    // Check if worker is globally disabled for this project
    const project = getProject(this.projectId)
    if (project && project.worker_enabled !== 1) {
      this.cancelJobInternal('Worker disabled')
      return true
    }
    
    // Check if card was moved away from 'ready' status
    const currentCard = getCard(this.cardId, this.projectId)
    if (currentCard && currentCard.status !== 'ready' && currentCard.status !== 'in_progress' && currentCard.status !== 'testing') {
      // Cancel job if card is no longer in an active worker state
      this.cancelJobInternal(`Card status changed to ${currentCard.status}`)
      return true
    }
    
    return false
  }
  
  /**
   * Cancel the job internally.
   */
  private cancelJobInternal(reason?: string): void {
    if (this.isCanceled()) return
    cancelJob(this.jobId, reason ?? 'Canceled', this.projectId)
  }
  
  /**
   * Ensure job is not canceled, with throttling.
   * Throws WorkerCanceledError if canceled.
   * Throws PipelineTimeoutError if timed out.
   */
  ensureNotCanceled(): void {
    const now = Date.now()
    
    // Throttle cancel checks to reduce DB load
    if (now - this.lastCancelCheck < this.cancelCheckThrottleMs) {
      return
    }
    this.lastCancelCheck = now
    
    // Check for cancellation
    if (this.isCanceled()) {
      throw new WorkerCanceledError()
    }
    
    // Check for pipeline timeout
    if (this.pipelineStartTime > 0) {
      const elapsed = now - this.pipelineStartTime
      if (elapsed > this.pipelineTimeoutMs) {
        throw new PipelineTimeoutError(this.pipelineTimeoutMs)
      }
    }
  }
  
  // ==================== Getters ====================
  
  getLeaseRenewalMs(): number {
    return this.leaseRenewalMs
  }
  
  getPipelineTimeoutMs(): number {
    return this.pipelineTimeoutMs
  }
}
