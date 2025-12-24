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
import type { PolicyConfig } from '../../shared/types'

export interface PoolConfig {
  maxWorkers: number
  pollIntervalMs: number
}

/**
 * WorkerPool manages parallel worker execution for a project.
 * It maintains a pool of worker slots and assigns ready cards to available slots.
 */
export class WorkerPool {
  private projectId: string
  private config: PoolConfig
  private activeWorkers: Map<string, Promise<void>> = new Map()
  private pollInterval: NodeJS.Timeout | null = null
  private isShuttingDown = false
  private isPolling = false

  constructor(projectId: string, config: PoolConfig) {
    this.projectId = projectId
    this.config = config
  }

  /**
   * Start the worker pool.
   * Initializes worker slots and begins polling for ready cards.
   */
  async start(): Promise<void> {
    if (this.pollInterval) {
      logAction('workerPool:alreadyRunning', { projectId: this.projectId })
      return
    }

    // Initialize worker slots in DB
    initializeWorkerSlots(this.projectId, this.config.maxWorkers)

    logAction('workerPool:started', {
      projectId: this.projectId,
      maxWorkers: this.config.maxWorkers,
      pollIntervalMs: this.config.pollIntervalMs
    })

    // Run immediately once, then set up interval
    this.poll()
    this.pollInterval = setInterval(() => this.poll(), this.config.pollIntervalMs)
  }

  /**
   * Stop the worker pool.
   * Waits for all active workers to complete.
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true

    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }

    // Wait for all active workers to complete
    if (this.activeWorkers.size > 0) {
      logAction('workerPool:waitingForWorkers', {
        projectId: this.projectId,
        count: this.activeWorkers.size
      })
      await Promise.all(this.activeWorkers.values())
    }

    logAction('workerPool:stopped', { projectId: this.projectId })
  }

  /**
   * Get current pool status.
   */
  getStatus(): {
    running: boolean
    activeWorkers: number
    maxWorkers: number
    idleSlots: number
  } {
    return {
      running: this.pollInterval !== null,
      activeWorkers: this.activeWorkers.size,
      maxWorkers: this.config.maxWorkers,
      idleSlots: getIdleSlotCount(this.projectId)
    }
  }

  /**
   * Poll for ready cards and start workers.
   */
  private async poll(): Promise<void> {
    if (this.isShuttingDown || this.isPolling) return

    this.isPolling = true

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

      logAction('workerPool:foundCards', {
        projectId: this.projectId,
        cardCount: readyCards.length,
        idleSlots: idleSlots.length
      })

      // Start workers for available cards
      for (let i = 0; i < Math.min(readyCards.length, idleSlots.length); i++) {
        const card = readyCards[i]

        // Acquire a slot (may fail if another process grabbed it)
        const slot = acquireWorkerSlot(this.projectId)
        if (!slot) {
          logAction('workerPool:slotAcquisitionFailed', { projectId: this.projectId })
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
    }
  }

  /**
   * Start a worker for a specific card.
   */
  private startWorker(slotId: string, cardId: string): void {
    const workerPromise = this.runWorkerWithSlot(slotId, cardId)
    this.activeWorkers.set(slotId, workerPromise)

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
