/**
 * Log Manager
 *
 * Handles logging, batching, and persistence for worker pipeline.
 */

import { updateJobResult } from '../../db'
import { broadcastToRenderers } from '../../ipc/broadcast'
import type { WorkerLogMessage } from '../../../shared/types'

export interface LogManagerConfig {
  /** Number of logs to accumulate before flushing to DB */
  batchSize: number
  /** Interval in ms to flush logs */
  flushIntervalMs: number
  /** Throttle interval for non-forced persists */
  persistThrottleMs: number
  /** Force persist throttle interval */
  forcePersistThrottleMs: number
}

const DEFAULT_CONFIG: LogManagerConfig = {
  batchSize: 50,
  flushIntervalMs: 2000,
  persistThrottleMs: 2000,
  forcePersistThrottleMs: 500
}

/**
 * Manages logging with batched persistence to reduce DB writes.
 */
export class LogManager {
  private logs: string[] = []
  private pendingLogCount = 0
  private logFlushTimer: NodeJS.Timeout | null = null
  private lastPersistMs = 0
  private config: LogManagerConfig

  // Context for logging
  private projectId: string
  private cardId: string
  private jobId: string | null = null

  // State for partial results
  private phase: string = 'init'
  private lastPlan: string | undefined

  constructor(
    projectId: string,
    cardId: string,
    config: Partial<LogManagerConfig> = {}
  ) {
    this.projectId = projectId
    this.cardId = cardId
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Set the job ID for logging context.
   */
  setJobId(jobId: string): void {
    this.jobId = jobId
  }

  /**
   * Update the current phase.
   */
  setPhase(phase: string): void {
    this.phase = phase
    this.persistPartialResult(true)
  }

  /**
   * Update the last plan for partial results.
   */
  setLastPlan(plan: string | undefined): void {
    this.lastPlan = plan
  }

  /**
   * Get current phase.
   */
  getPhase(): string {
    return this.phase
  }

  /**
   * Get all accumulated logs.
   */
  getLogs(): string[] {
    return this.logs
  }

  /**
   * Get the last N logs.
   */
  getRecentLogs(count: number): string[] {
    return this.logs.slice(-count)
  }

  /**
   * Log a message with optional source metadata.
   */
  log(message: string, meta?: { source?: string; stream?: 'stdout' | 'stderr' }): void {
    const ts = new Date().toISOString()
    const sourcePrefix = meta?.source
      ? `[${meta.source}${meta.stream ? `:${meta.stream}` : ''}] `
      : ''
    const fullMessage = `${sourcePrefix}${message}`
    const line = `[${ts}] ${fullMessage}`
    this.logs.push(line)
    console.log(`[Worker] ${fullMessage}`)

    if (!this.jobId) return

    const payload: WorkerLogMessage = {
      projectId: this.projectId,
      jobId: this.jobId,
      cardId: this.cardId,
      ts,
      line,
      source: meta?.source,
      stream: meta?.stream
    }

    // Broadcast individual logs for real-time UI updates
    broadcastToRenderers('workerLog', payload)

    // Use batched persistence to reduce DB writes
    this.pendingLogCount++
    this.scheduleLogFlush()

    // Force flush if we've accumulated too many logs
    if (this.pendingLogCount >= this.config.batchSize) {
      this.flushLogs()
    }
  }

  /**
   * Schedule a log flush if not already scheduled.
   */
  private scheduleLogFlush(): void {
    if (this.logFlushTimer) return

    this.logFlushTimer = setTimeout(() => {
      this.flushLogs()
    }, this.config.flushIntervalMs)
  }

  /**
   * Flush pending logs to DB.
   */
  flushLogs(): void {
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer)
      this.logFlushTimer = null
    }

    if (this.pendingLogCount === 0) return

    this.pendingLogCount = 0
    this.persistPartialResult(true)
  }

  /**
   * Cancel any pending log flush timer.
   * Call this during cleanup.
   */
  cancelLogFlush(): void {
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer)
      this.logFlushTimer = null
    }
  }

  /**
   * Persist partial result to the database.
   */
  persistPartialResult(force: boolean): void {
    if (!this.jobId) return
    const now = Date.now()

    const throttleMs = force
      ? this.config.forcePersistThrottleMs
      : this.config.persistThrottleMs
    if (!force && now - this.lastPersistMs < throttleMs) return
    this.lastPersistMs = now

    updateJobResult(this.jobId, {
      success: false,
      phase: this.phase,
      plan: this.lastPlan,
      logs: this.logs.slice(-500)
    })

    broadcastToRenderers('stateUpdated')
  }

  /**
   * Cleanup resources. Call this when the pipeline completes.
   */
  cleanup(): void {
    this.flushLogs()
    this.cancelLogFlush()
  }
}
