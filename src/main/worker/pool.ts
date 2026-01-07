/**
 * Worker Pool
 *
 * Manages parallel worker execution for a project.
 *
 * Improvements:
 * - Atomic slot acquisition with retry to prevent race conditions
 * - Worker crash detection and orphaned slot cleanup
 * - Bounded activeWorkers map to prevent memory leaks
 * - Better error handling and logging
 */

import {
  getProject,
  getNextReadyCards,
  initializeWorkerSlots,
  listWorkerSlots,
  acquireWorkerSlot,
  releaseWorkerSlot,
  updateWorkerSlot,
  createJob,
  createEvent,
  getIdleSlotCount
} from '../db'
import { runWorker } from './pipeline'
import { logAction } from '../../shared/utils'
import { broadcastToRenderers } from '../ipc/broadcast'
import { warmupAIToolsCache, type AIToolAvailability } from './cache'
import type { PolicyConfig, WorkerSlot } from '../../shared/types'

// Constants
const MAX_SLOT_ACQUISITION_ATTEMPTS = 3
const SLOT_ACQUISITION_RETRY_DELAY_MS = 100
const ORPHAN_CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const ORPHAN_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes - slot considered orphaned if running this long
const MAX_ACTIVE_WORKERS_MAP_SIZE = 100 // Prevent unbounded growth

export interface PoolConfig {
  maxWorkers: number
  pollIntervalMs: number
  /** Minimum poll interval when using adaptive polling (default: 1000ms) */
  minPollIntervalMs?: number
  /** Maximum poll interval when using adaptive polling (default: 60000ms) */
  maxPollIntervalMs?: number
  /** Enable adaptive polling that backs off when idle (default: true) */
  adaptivePolling?: boolean
  /** Enable orphan slot cleanup (default: true) */
  enableOrphanCleanup?: boolean
}

/**
 * WorkerPool manages parallel worker execution for a project.
 * It maintains a pool of worker slots and assigns ready cards to available slots.
 * 
 * Features adaptive polling that backs off when idle and speeds up when active.
 */
export class WorkerPool {
  private projectId: string
  private config: PoolConfig
  private activeWorkers: Map<string, Promise<void>> = new Map()
  private pollTimeout: NodeJS.Timeout | null = null
  private orphanCheckInterval: NodeJS.Timeout | null = null
  private isShuttingDown = false
  private isPolling = false

  // Adaptive polling state
  private currentPollInterval: number
  private readonly minPollInterval: number
  private readonly maxPollInterval: number
  private readonly adaptivePolling: boolean
  private consecutiveEmptyPolls = 0

  // Cached AI tool availability (detected at startup)
  private aiTools: AIToolAvailability | null = null

  // Track slot acquisition attempts for metrics
  private slotAcquisitionAttempts = 0
  private slotAcquisitionFailures = 0

  constructor(projectId: string, config: PoolConfig) {
    this.projectId = projectId
    this.config = config

    // Initialize adaptive polling settings
    this.adaptivePolling = config.adaptivePolling !== false // Default true
    this.minPollInterval = config.minPollIntervalMs ?? 1000 // 1 second
    this.maxPollInterval = config.maxPollIntervalMs ?? 60_000 // 60 seconds
    this.currentPollInterval = this.adaptivePolling
      ? this.minPollInterval
      : config.pollIntervalMs
  }

  // ==================== Slot Acquisition with Retry ====================

  /**
   * Acquire a slot with retry logic to handle race conditions.
   * Uses exponential backoff between attempts.
   */
  private async acquireSlotWithRetry(): Promise<WorkerSlot | null> {
    for (let attempt = 1; attempt <= MAX_SLOT_ACQUISITION_ATTEMPTS; attempt++) {
      this.slotAcquisitionAttempts++

      const slot = acquireWorkerSlot(this.projectId)
      if (slot) {
        return slot
      }

      // Last attempt failed, don't retry
      if (attempt === MAX_SLOT_ACQUISITION_ATTEMPTS) {
        this.slotAcquisitionFailures++
        logAction('workerPool:slotAcquisitionExhausted', {
          projectId: this.projectId,
          attempts: attempt
        })
        return null
      }

      // Wait with exponential backoff before retry
      const delay = SLOT_ACQUISITION_RETRY_DELAY_MS * Math.pow(2, attempt - 1)
      await new Promise(resolve => setTimeout(resolve, delay))

      logAction('workerPool:slotAcquisitionRetry', {
        projectId: this.projectId,
        attempt,
        delayMs: delay
      })
    }

    return null
  }

  // ==================== Orphan Detection and Cleanup ====================

  /**
   * Check for and clean up orphaned slots.
   * A slot is considered orphaned if:
   * - Status is 'running' but started_at is older than threshold
   * - We don't have an active worker promise for it
   */
  private async checkForOrphanedSlots(): Promise<void> {
    if (this.isShuttingDown) return

    try {
      const slots = listWorkerSlots(this.projectId)
      const now = Date.now()
      let orphansFound = 0

      for (const slot of slots) {
        if (slot.status !== 'running') continue
        if (!slot.started_at) continue

        const startTime = new Date(slot.started_at).getTime()
        const age = now - startTime

        // Check if slot is potentially orphaned
        if (age > ORPHAN_THRESHOLD_MS) {
          // Double-check: do we have an active worker for this slot?
          if (!this.activeWorkers.has(slot.id)) {
            orphansFound++
            logAction('workerPool:orphanedSlotDetected', {
              projectId: this.projectId,
              slotId: slot.id,
              cardId: slot.card_id,
              jobId: slot.job_id,
              ageMs: age,
              startedAt: slot.started_at
            })

            // Clean up the orphaned slot
            try {
              releaseWorkerSlot(slot.id)
              logAction('workerPool:orphanedSlotCleaned', {
                projectId: this.projectId,
                slotId: slot.id
              })
            } catch (error) {
              logAction('workerPool:orphanedSlotCleanupFailed', {
                projectId: this.projectId,
                slotId: slot.id,
                error: error instanceof Error ? error.message : String(error)
              })
            }
          }
        }
      }

      if (orphansFound > 0) {
        logAction('workerPool:orphanCheckComplete', {
          projectId: this.projectId,
          orphansFound,
          orphansCleaned: orphansFound
        })
        broadcastToRenderers('stateUpdated')
      }
    } catch (error) {
      logAction('workerPool:orphanCheckError', {
        projectId: this.projectId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Start periodic orphan checking.
   */
  private startOrphanCheck(): void {
    if (this.config.enableOrphanCleanup === false) return

    this.orphanCheckInterval = setInterval(
      () => this.checkForOrphanedSlots(),
      ORPHAN_CHECK_INTERVAL_MS
    )

    // Run once at startup
    this.checkForOrphanedSlots()
  }

  /**
   * Stop orphan checking.
   */
  private stopOrphanCheck(): void {
    if (this.orphanCheckInterval) {
      clearInterval(this.orphanCheckInterval)
      this.orphanCheckInterval = null
    }
  }

  // ==================== Active Workers Map Management ====================

  /**
   * Add a worker to the active workers map with size limit enforcement.
   */
  private addActiveWorker(slotId: string, promise: Promise<void>): void {
    // Enforce size limit by removing oldest entries if needed
    while (this.activeWorkers.size >= MAX_ACTIVE_WORKERS_MAP_SIZE) {
      const firstKey = this.activeWorkers.keys().next().value
      if (firstKey) {
        logAction('workerPool:activeWorkerEvicted', {
          projectId: this.projectId,
          slotId: firstKey
        })
        this.activeWorkers.delete(firstKey)
      } else {
        break
      }
    }

    this.activeWorkers.set(slotId, promise)
  }

  /**
   * Start the worker pool.
   * Initializes worker slots and begins polling for ready cards.
   * Uses adaptive polling that backs off when idle.
   */
  async start(): Promise<void> {
    if (this.pollTimeout) {
      logAction('workerPool:alreadyRunning', { projectId: this.projectId })
      return
    }

    // Initialize worker slots in DB
    initializeWorkerSlots(this.projectId, this.config.maxWorkers)

    // Start orphan detection and cleanup
    this.startOrphanCheck()

    // Warm up AI tools cache at startup for faster worker initialization
    try {
      this.aiTools = await warmupAIToolsCache()
      logAction('workerPool:aiToolsDetected', {
        projectId: this.projectId,
        claude: this.aiTools.claude,
        codex: this.aiTools.codex
      })
    } catch (error) {
      logAction('workerPool:aiToolsDetectionFailed', {
        projectId: this.projectId,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    logAction('workerPool:started', {
      projectId: this.projectId,
      maxWorkers: this.config.maxWorkers,
      pollIntervalMs: this.config.pollIntervalMs,
      adaptivePolling: this.adaptivePolling,
      minPollInterval: this.minPollInterval,
      maxPollInterval: this.maxPollInterval,
      orphanCleanupEnabled: this.config.enableOrphanCleanup !== false
    })

    // Run immediately once, then schedule next poll
    this.poll()
  }

  /**
   * Schedule the next poll with adaptive interval.
   */
  private scheduleNextPoll(): void {
    if (this.isShuttingDown) return
    
    this.pollTimeout = setTimeout(() => this.poll(), this.currentPollInterval)
  }

  /**
   * Adjust polling interval based on activity.
   * Speeds up when cards are found, slows down when idle.
   */
  private adjustPollInterval(foundCards: boolean): void {
    if (!this.adaptivePolling) return

    if (foundCards) {
      // Reset to fast polling when we find work
      this.consecutiveEmptyPolls = 0
      this.currentPollInterval = this.minPollInterval
    } else {
      // Exponential backoff when idle
      this.consecutiveEmptyPolls++
      // Backoff multiplier: 1.5x per empty poll, capped at max
      const backoffMultiplier = Math.pow(1.5, this.consecutiveEmptyPolls)
      this.currentPollInterval = Math.min(
        Math.floor(this.minPollInterval * backoffMultiplier),
        this.maxPollInterval
      )
    }
  }

  /**
   * Wake up the pool immediately for fast polling.
   * Call this when external events indicate new cards may be available.
   */
  wakeUp(): void {
    if (this.isShuttingDown || !this.pollTimeout) return
    
    // Reset to fast polling
    this.consecutiveEmptyPolls = 0
    this.currentPollInterval = this.minPollInterval
    
    // Clear existing timeout and poll immediately
    clearTimeout(this.pollTimeout)
    this.pollTimeout = null
    
    logAction('workerPool:wakeUp', { projectId: this.projectId })
    this.poll()
  }

  /**
   * Stop the worker pool.
   * Waits for all active workers to complete.
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout)
      this.pollTimeout = null
    }

    // Stop orphan checking
    this.stopOrphanCheck()

    // Wait for all active workers to complete
    if (this.activeWorkers.size > 0) {
      logAction('workerPool:waitingForWorkers', {
        projectId: this.projectId,
        count: this.activeWorkers.size
      })
      await Promise.all(this.activeWorkers.values())
    }

    logAction('workerPool:stopped', {
      projectId: this.projectId,
      slotAcquisitionAttempts: this.slotAcquisitionAttempts,
      slotAcquisitionFailures: this.slotAcquisitionFailures
    })
  }

  /**
   * Get current pool status.
   */
  getStatus(): {
    running: boolean
    activeWorkers: number
    maxWorkers: number
    idleSlots: number
    currentPollInterval: number
    consecutiveEmptyPolls: number
    aiTools: AIToolAvailability | null
    slotAcquisitionAttempts: number
    slotAcquisitionFailures: number
    orphanCleanupEnabled: boolean
  } {
    return {
      running: this.pollTimeout !== null || this.isPolling,
      activeWorkers: this.activeWorkers.size,
      maxWorkers: this.config.maxWorkers,
      idleSlots: getIdleSlotCount(this.projectId),
      currentPollInterval: this.currentPollInterval,
      consecutiveEmptyPolls: this.consecutiveEmptyPolls,
      aiTools: this.aiTools,
      slotAcquisitionAttempts: this.slotAcquisitionAttempts,
      slotAcquisitionFailures: this.slotAcquisitionFailures,
      orphanCleanupEnabled: this.config.enableOrphanCleanup !== false
    }
  }

  /**
   * Get cached AI tool availability.
   */
  getAITools(): AIToolAvailability | null {
    return this.aiTools
  }

  /**
   * Poll for ready cards and start workers.
   * Uses adaptive polling to reduce overhead when idle.
   */
  private async poll(): Promise<void> {
    if (this.isShuttingDown || this.isPolling) {
      // If already polling, schedule next poll to avoid missing cycles
      if (!this.isShuttingDown && !this.pollTimeout) {
        this.scheduleNextPoll()
      }
      return
    }

    this.isPolling = true
    let foundCards = false

    try {
      const project = getProject(this.projectId)
      if (!project || !project.worker_enabled) {
        return
      }

      // Get available slots
      const slots = listWorkerSlots(this.projectId)
      const idleSlots = slots.filter((s) => s.status === 'idle')

      if (idleSlots.length === 0) {
        return // All workers busy
      }

      // Get ready cards (up to number of idle slots)
      const retryCooldownMinutes = 30
      const readyCards = getNextReadyCards(this.projectId, idleSlots.length, retryCooldownMinutes)

      if (readyCards.length === 0) {
        return // No cards to process
      }

      foundCards = true

      logAction('workerPool:foundCards', {
        projectId: this.projectId,
        cardCount: readyCards.length,
        idleSlots: idleSlots.length,
        pollInterval: this.currentPollInterval
      })

      // Start workers for available cards
      for (let i = 0; i < Math.min(readyCards.length, idleSlots.length); i++) {
        const card = readyCards[i]

        // Acquire a slot with retry to handle race conditions
        const slot = await this.acquireSlotWithRetry()
        if (!slot) {
          // All slots taken or race condition couldn't be resolved
          break
        }

        this.startWorker(slot.id, card.id)
      }
    } catch (error) {
      logAction('workerPool:pollError', {
        projectId: this.projectId,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.isPolling = false
      
      // Adjust polling interval based on whether we found cards
      this.adjustPollInterval(foundCards)
      
      // Schedule next poll with (potentially adjusted) interval
      this.scheduleNextPoll()
    }
  }

  /**
   * Start a worker for a specific card.
   */
  private startWorker(slotId: string, cardId: string): void {
    const workerPromise = this.runWorkerWithSlot(slotId, cardId)

    // Use bounded map management to prevent memory leaks
    this.addActiveWorker(slotId, workerPromise)

    workerPromise.finally(() => {
      this.activeWorkers.delete(slotId)
    })
  }

  /**
   * Run worker pipeline with slot management.
   */
  private async runWorkerWithSlot(slotId: string, cardId: string): Promise<void> {
    try {
      // Create job
      const job = createJob(this.projectId, 'worker_run', cardId)

      // Update slot with job info
      updateWorkerSlot(slotId, {
        cardId,
        jobId: job.id,
        status: 'running',
        startedAt: new Date().toISOString()
      })

      createEvent(this.projectId, 'worker_run', cardId, {
        jobId: job.id,
        slotId,
        trigger: 'pool'
      })

      broadcastToRenderers('stateUpdated')

      logAction('workerPool:startingJob', {
        projectId: this.projectId,
        slotId,
        jobId: job.id,
        cardId
      })

      // Run the worker pipeline
      // Note: We pass forceWorktree option via the policy - pool mode requires worktrees
      const result = await runWorker(job.id)

      logAction('workerPool:jobComplete', {
        projectId: this.projectId,
        slotId,
        jobId: job.id,
        cardId,
        success: result.success,
        phase: result.phase
      })
    } catch (error) {
      logAction('workerPool:workerError', {
        projectId: this.projectId,
        slotId,
        cardId,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      // Release slot
      releaseWorkerSlot(slotId)
      broadcastToRenderers('stateUpdated')
    }
  }
}

// ==================== Module-level Pool Management ====================

const activePools = new Map<string, WorkerPool>()

/**
 * Start a worker pool for a project.
 */
export function startWorkerPool(projectId: string, config: PoolConfig): void {
  if (activePools.has(projectId)) {
    logAction('workerPool:alreadyExists', { projectId })
    return
  }

  const pool = new WorkerPool(projectId, config)
  pool.start()
  activePools.set(projectId, pool)
}

/**
 * Stop a worker pool for a project.
 */
export async function stopWorkerPool(projectId: string): Promise<void> {
  const pool = activePools.get(projectId)
  if (pool) {
    await pool.stop()
    activePools.delete(projectId)
  }
}

/**
 * Stop all worker pools.
 * Call this on app shutdown.
 */
export async function stopAllWorkerPools(): Promise<void> {
  const stopPromises: Promise<void>[] = []

  for (const [, pool] of activePools) {
    stopPromises.push(pool.stop())
  }

  await Promise.all(stopPromises)
  activePools.clear()

  logAction('workerPool:allStopped')
}

/**
 * Check if a worker pool is running for a project.
 */
export function isWorkerPoolRunning(projectId: string): boolean {
  return activePools.has(projectId)
}

/**
 * Wake up a worker pool for immediate polling.
 * Call this when new cards become available.
 */
export function wakeUpWorkerPool(projectId: string): void {
  const pool = activePools.get(projectId)
  if (pool) {
    pool.wakeUp()
  }
}

/**
 * Wake up all worker pools for immediate polling.
 * Call this when cards may have become available across projects.
 */
export function wakeUpAllWorkerPools(): void {
  for (const pool of activePools.values()) {
    pool.wakeUp()
  }
}

/**
 * Get the status of a worker pool.
 */
export function getWorkerPoolStatus(projectId: string): ReturnType<WorkerPool['getStatus']> | null {
  const pool = activePools.get(projectId)
  return pool ? pool.getStatus() : null
}

/**
 * Get status of all worker pools.
 */
export function getAllWorkerPoolStatus(): Map<string, ReturnType<WorkerPool['getStatus']>> {
  const status = new Map<string, ReturnType<WorkerPool['getStatus']>>()
  for (const [projectId, pool] of activePools) {
    status.set(projectId, pool.getStatus())
  }
  return status
}

/**
 * Parse policy and create pool config.
 */
export function getPoolConfigFromPolicy(policy: PolicyConfig | null): PoolConfig {
  const maxWorkers = policy?.worker?.pool?.maxWorkers ?? 1
  return {
    maxWorkers: Math.max(1, Math.min(8, maxWorkers)), // Clamp to 1-8
    pollIntervalMs: 30_000 // 30 seconds
  }
}
