/**
 * Sync Lock Manager
 *
 * Provides coordination between sync operations and worker operations.
 * Uses a read-write lock pattern where:
 * - Workers acquire "read" locks (multiple can run concurrently)
 * - Sync acquires a "write" lock (exclusive, waits for all workers to complete)
 *
 * This prevents sync from running during worker operations which could
 * cause conflicts with worktrees, git operations, or card status changes.
 */

import { logAction } from '../../shared/utils'

// ============================================================================
// Types
// ============================================================================

interface WaitingLock {
  resolve: () => void
  type: 'worker' | 'sync'
  priority: number
  requestedAt: number
}

interface LockStats {
  activeWorkers: number
  syncActive: boolean
  waitingWorkers: number
  waitingSyncs: number
  lastWorkerStarted: number | null
  lastSyncStarted: number | null
}

// ============================================================================
// Project Sync Lock
// ============================================================================

/**
 * Per-project sync lock that coordinates worker and sync operations.
 */
class ProjectSyncLock {
  private projectId: string
  private activeWorkers = 0
  private syncActive = false
  private workerQueue: WaitingLock[] = []
  private syncQueue: WaitingLock[] = []
  private lastWorkerStarted: number | null = null
  private lastSyncStarted: number | null = null

  constructor(projectId: string) {
    this.projectId = projectId
  }

  /**
   * Acquire a worker lock. Workers can run concurrently with each other
   * but not during a sync operation.
   */
  async acquireWorkerLock(priority = 0): Promise<void> {
    // If no sync is active and no syncs are waiting, grant immediately
    if (!this.syncActive && this.syncQueue.length === 0) {
      this.activeWorkers++
      this.lastWorkerStarted = Date.now()
      logAction('syncLock:workerAcquired', {
        projectId: this.projectId,
        activeWorkers: this.activeWorkers
      })
      return
    }

    // Wait for sync to complete
    return new Promise<void>((resolve) => {
      this.workerQueue.push({
        resolve,
        type: 'worker',
        priority,
        requestedAt: Date.now()
      })

      // Sort by priority (higher first), then by request time (earlier first)
      this.workerQueue.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority
        return a.requestedAt - b.requestedAt
      })

      logAction('syncLock:workerWaiting', {
        projectId: this.projectId,
        queueLength: this.workerQueue.length
      })
    })
  }

  /**
   * Release a worker lock.
   */
  releaseWorkerLock(): void {
    if (this.activeWorkers > 0) {
      this.activeWorkers--
    }

    logAction('syncLock:workerReleased', {
      projectId: this.projectId,
      activeWorkers: this.activeWorkers
    })

    // If no more workers and sync is waiting, grant sync
    if (this.activeWorkers === 0 && this.syncQueue.length > 0) {
      this.grantSyncLock()
    }
  }

  /**
   * Try to acquire a worker lock without waiting.
   * Returns true if acquired, false if sync is active.
   */
  tryAcquireWorkerLock(): boolean {
    if (this.syncActive || this.syncQueue.length > 0) {
      return false
    }

    this.activeWorkers++
    this.lastWorkerStarted = Date.now()
    return true
  }

  /**
   * Acquire a sync lock. Sync must wait for all workers to complete.
   */
  async acquireSyncLock(priority = 0): Promise<void> {
    // If no workers are active, grant immediately
    if (this.activeWorkers === 0 && !this.syncActive) {
      this.syncActive = true
      this.lastSyncStarted = Date.now()
      logAction('syncLock:syncAcquired', {
        projectId: this.projectId
      })
      return
    }

    // Wait for all workers to complete
    return new Promise<void>((resolve) => {
      this.syncQueue.push({
        resolve,
        type: 'sync',
        priority,
        requestedAt: Date.now()
      })

      // Sort by priority (higher first), then by request time (earlier first)
      this.syncQueue.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority
        return a.requestedAt - b.requestedAt
      })

      logAction('syncLock:syncWaiting', {
        projectId: this.projectId,
        activeWorkers: this.activeWorkers,
        queueLength: this.syncQueue.length
      })
    })
  }

  /**
   * Release a sync lock.
   */
  releaseSyncLock(): void {
    this.syncActive = false

    logAction('syncLock:syncReleased', {
      projectId: this.projectId
    })

    // Grant waiting workers
    this.grantWaitingWorkers()
  }

  /**
   * Try to acquire a sync lock without waiting.
   * Returns true if acquired, false if workers are active.
   */
  tryAcquireSyncLock(): boolean {
    if (this.activeWorkers > 0 || this.syncActive) {
      return false
    }

    this.syncActive = true
    this.lastSyncStarted = Date.now()
    return true
  }

  /**
   * Execute a function with a worker lock.
   */
  async withWorkerLock<T>(fn: () => Promise<T>, priority = 0): Promise<T> {
    await this.acquireWorkerLock(priority)
    try {
      return await fn()
    } finally {
      this.releaseWorkerLock()
    }
  }

  /**
   * Execute a function with a sync lock.
   */
  async withSyncLock<T>(fn: () => Promise<T>, priority = 0): Promise<T> {
    await this.acquireSyncLock(priority)
    try {
      return await fn()
    } finally {
      this.releaseSyncLock()
    }
  }

  /**
   * Get lock statistics.
   */
  getStats(): LockStats {
    return {
      activeWorkers: this.activeWorkers,
      syncActive: this.syncActive,
      waitingWorkers: this.workerQueue.length,
      waitingSyncs: this.syncQueue.length,
      lastWorkerStarted: this.lastWorkerStarted,
      lastSyncStarted: this.lastSyncStarted
    }
  }

  /**
   * Check if sync can run immediately.
   */
  canSyncNow(): boolean {
    return this.activeWorkers === 0 && !this.syncActive
  }

  /**
   * Check if workers can run immediately.
   */
  canWorkerNow(): boolean {
    return !this.syncActive && this.syncQueue.length === 0
  }

  /**
   * Reset all locks (use with caution, mainly for cleanup on shutdown).
   */
  reset(): void {
    this.activeWorkers = 0
    this.syncActive = false

    // Resolve all waiting locks
    for (const waiter of this.workerQueue) {
      waiter.resolve()
    }
    for (const waiter of this.syncQueue) {
      waiter.resolve()
    }

    this.workerQueue = []
    this.syncQueue = []

    logAction('syncLock:reset', { projectId: this.projectId })
  }

  private grantSyncLock(): void {
    if (this.syncQueue.length === 0) return

    this.syncActive = true
    this.lastSyncStarted = Date.now()

    const waiter = this.syncQueue.shift()!
    waiter.resolve()

    logAction('syncLock:syncGranted', {
      projectId: this.projectId,
      waitTimeMs: Date.now() - waiter.requestedAt
    })
  }

  private grantWaitingWorkers(): void {
    // Grant all waiting workers (they can run concurrently)
    while (this.workerQueue.length > 0 && !this.syncActive) {
      // Check if sync is waiting - if so, give it priority after current batch
      if (this.syncQueue.length > 0) {
        break
      }

      const waiter = this.workerQueue.shift()!
      this.activeWorkers++
      this.lastWorkerStarted = Date.now()
      waiter.resolve()

      logAction('syncLock:workerGranted', {
        projectId: this.projectId,
        activeWorkers: this.activeWorkers,
        waitTimeMs: Date.now() - waiter.requestedAt
      })
    }

    // If no workers were granted and sync is waiting, grant sync
    if (this.activeWorkers === 0 && this.syncQueue.length > 0) {
      this.grantSyncLock()
    }
  }
}

// ============================================================================
// Global Sync Lock Manager
// ============================================================================

const projectLocks = new Map<string, ProjectSyncLock>()

/**
 * Get or create a sync lock for a project.
 */
function getProjectLock(projectId: string): ProjectSyncLock {
  let lock = projectLocks.get(projectId)
  if (!lock) {
    lock = new ProjectSyncLock(projectId)
    projectLocks.set(projectId, lock)
  }
  return lock
}

/**
 * Acquire a worker lock for a project.
 */
export async function acquireWorkerLock(projectId: string, priority = 0): Promise<void> {
  const lock = getProjectLock(projectId)
  return lock.acquireWorkerLock(priority)
}

/**
 * Release a worker lock for a project.
 */
export function releaseWorkerLock(projectId: string): void {
  const lock = projectLocks.get(projectId)
  lock?.releaseWorkerLock()
}

/**
 * Try to acquire a worker lock without waiting.
 */
export function tryAcquireWorkerLock(projectId: string): boolean {
  const lock = getProjectLock(projectId)
  return lock.tryAcquireWorkerLock()
}

/**
 * Acquire a sync lock for a project.
 */
export async function acquireSyncLock(projectId: string, priority = 0): Promise<void> {
  const lock = getProjectLock(projectId)
  return lock.acquireSyncLock(priority)
}

/**
 * Release a sync lock for a project.
 */
export function releaseSyncLock(projectId: string): void {
  const lock = projectLocks.get(projectId)
  lock?.releaseSyncLock()
}

/**
 * Try to acquire a sync lock without waiting.
 */
export function tryAcquireSyncLock(projectId: string): boolean {
  const lock = getProjectLock(projectId)
  return lock.tryAcquireSyncLock()
}

/**
 * Execute a function with a worker lock.
 */
export async function withWorkerLock<T>(
  projectId: string,
  fn: () => Promise<T>,
  priority = 0
): Promise<T> {
  const lock = getProjectLock(projectId)
  return lock.withWorkerLock(fn, priority)
}

/**
 * Execute a function with a sync lock.
 */
export async function withSyncLock<T>(
  projectId: string,
  fn: () => Promise<T>,
  priority = 0
): Promise<T> {
  const lock = getProjectLock(projectId)
  return lock.withSyncLock(fn, priority)
}

/**
 * Get lock statistics for a project.
 */
export function getSyncLockStats(projectId: string): LockStats | null {
  const lock = projectLocks.get(projectId)
  return lock?.getStats() ?? null
}

/**
 * Check if sync can run immediately for a project.
 */
export function canSyncNow(projectId: string): boolean {
  const lock = projectLocks.get(projectId)
  return lock?.canSyncNow() ?? true
}

/**
 * Check if workers can run immediately for a project.
 */
export function canWorkerNow(projectId: string): boolean {
  const lock = projectLocks.get(projectId)
  return lock?.canWorkerNow() ?? true
}

/**
 * Reset all locks for a project (use for cleanup on shutdown).
 */
export function resetProjectLocks(projectId: string): void {
  const lock = projectLocks.get(projectId)
  lock?.reset()
  projectLocks.delete(projectId)
}

/**
 * Reset all locks (use for app shutdown).
 */
export function resetAllLocks(): void {
  for (const lock of projectLocks.values()) {
    lock.reset()
  }
  projectLocks.clear()
  logAction('syncLock:allReset')
}

/**
 * Get statistics for all project locks.
 */
export function getAllLockStats(): Map<string, LockStats> {
  const stats = new Map<string, LockStats>()
  for (const [projectId, lock] of projectLocks) {
    stats.set(projectId, lock.getStats())
  }
  return stats
}
