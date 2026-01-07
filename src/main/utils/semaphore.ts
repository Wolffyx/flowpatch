/**
 * Semaphore Implementation
 *
 * Provides concurrency control for limiting parallel operations.
 * Supports both counting semaphores and mutex locks.
 */

import { DEFAULT_SEMAPHORE_PERMITS } from './constants'

// ============================================================================
// Types
// ============================================================================

interface WaitingAcquire {
  resolve: () => void
  priority: number
}

// ============================================================================
// Semaphore
// ============================================================================

/**
 * Counting semaphore for limiting concurrent operations.
 */
export class Semaphore {
  private permits: number
  private readonly maxPermits: number
  private waitQueue: WaitingAcquire[] = []

  constructor(maxPermits = DEFAULT_SEMAPHORE_PERMITS) {
    this.maxPermits = maxPermits
    this.permits = maxPermits
  }

  /**
   * Get number of available permits.
   */
  get available(): number {
    return this.permits
  }

  /**
   * Get number of waiters in queue.
   */
  get waiting(): number {
    return this.waitQueue.length
  }

  /**
   * Acquire a permit, waiting if necessary.
   */
  async acquire(priority = 0): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }

    // Wait for a permit
    return new Promise<void>((resolve) => {
      const waiter: WaitingAcquire = { resolve, priority }

      // Insert in priority order (higher priority first)
      const insertIndex = this.waitQueue.findIndex((w) => w.priority < priority)
      if (insertIndex === -1) {
        this.waitQueue.push(waiter)
      } else {
        this.waitQueue.splice(insertIndex, 0, waiter)
      }
    })
  }

  /**
   * Try to acquire a permit without waiting.
   * Returns true if acquired, false otherwise.
   */
  tryAcquire(): boolean {
    if (this.permits > 0) {
      this.permits--
      return true
    }
    return false
  }

  /**
   * Release a permit.
   */
  release(): void {
    if (this.waitQueue.length > 0) {
      // Give permit to next waiter
      const waiter = this.waitQueue.shift()!
      waiter.resolve()
    } else if (this.permits < this.maxPermits) {
      this.permits++
    }
  }

  /**
   * Execute a function with automatic permit management.
   */
  async withPermit<T>(fn: () => Promise<T>, priority = 0): Promise<T> {
    await this.acquire(priority)
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  /**
   * Drain all permits (useful for shutdown).
   */
  async drain(): Promise<void> {
    while (this.permits < this.maxPermits) {
      await this.acquire()
    }
  }

  /**
   * Reset the semaphore to initial state.
   */
  reset(): void {
    this.permits = this.maxPermits
    // Resolve all waiting acquires
    while (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!
      waiter.resolve()
    }
  }
}

// ============================================================================
// Mutex
// ============================================================================

/**
 * Mutex (mutual exclusion lock) - a semaphore with 1 permit.
 */
export class Mutex extends Semaphore {
  constructor() {
    super(1)
  }

  /**
   * Lock the mutex.
   */
  async lock(): Promise<void> {
    return this.acquire()
  }

  /**
   * Try to lock without waiting.
   */
  tryLock(): boolean {
    return this.tryAcquire()
  }

  /**
   * Unlock the mutex.
   */
  unlock(): void {
    this.release()
  }

  /**
   * Execute a function with automatic lock management.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.withPermit(fn)
  }

  /**
   * Check if the mutex is locked.
   */
  get isLocked(): boolean {
    return this.available === 0
  }
}

// ============================================================================
// Read-Write Lock
// ============================================================================

/**
 * Read-write lock allowing multiple readers or a single writer.
 */
export class ReadWriteLock {
  private readers = 0
  private writer = false
  private writerQueue: (() => void)[] = []
  private readerQueue: (() => void)[] = []

  /**
   * Acquire a read lock.
   */
  async acquireRead(): Promise<void> {
    if (!this.writer && this.writerQueue.length === 0) {
      this.readers++
      return
    }

    return new Promise<void>((resolve) => {
      this.readerQueue.push(resolve)
    })
  }

  /**
   * Release a read lock.
   */
  releaseRead(): void {
    this.readers--
    if (this.readers === 0 && this.writerQueue.length > 0) {
      this.writer = true
      const nextWriter = this.writerQueue.shift()!
      nextWriter()
    }
  }

  /**
   * Acquire a write lock.
   */
  async acquireWrite(): Promise<void> {
    if (!this.writer && this.readers === 0) {
      this.writer = true
      return
    }

    return new Promise<void>((resolve) => {
      this.writerQueue.push(resolve)
    })
  }

  /**
   * Release a write lock.
   */
  releaseWrite(): void {
    this.writer = false

    // Prefer waiting readers over writers
    if (this.readerQueue.length > 0) {
      // Release all waiting readers
      while (this.readerQueue.length > 0) {
        this.readers++
        const nextReader = this.readerQueue.shift()!
        nextReader()
      }
    } else if (this.writerQueue.length > 0) {
      this.writer = true
      const nextWriter = this.writerQueue.shift()!
      nextWriter()
    }
  }

  /**
   * Execute a function with a read lock.
   */
  async withReadLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireRead()
    try {
      return await fn()
    } finally {
      this.releaseRead()
    }
  }

  /**
   * Execute a function with a write lock.
   */
  async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireWrite()
    try {
      return await fn()
    } finally {
      this.releaseWrite()
    }
  }

  /**
   * Get current state.
   */
  getState(): {
    readers: number
    hasWriter: boolean
    waitingWriters: number
    waitingReaders: number
  } {
    return {
      readers: this.readers,
      hasWriter: this.writer,
      waitingWriters: this.writerQueue.length,
      waitingReaders: this.readerQueue.length
    }
  }
}

// ============================================================================
// Keyed Semaphore
// ============================================================================

/**
 * Semaphore that manages permits per key.
 * Useful for rate limiting per resource (e.g., per project or per API).
 */
export class KeyedSemaphore {
  private semaphores = new Map<string, Semaphore>()
  private readonly permitsPerKey: number

  constructor(permitsPerKey = DEFAULT_SEMAPHORE_PERMITS) {
    this.permitsPerKey = permitsPerKey
  }

  /**
   * Get or create semaphore for a key.
   */
  private getSemaphore(key: string): Semaphore {
    let semaphore = this.semaphores.get(key)
    if (!semaphore) {
      semaphore = new Semaphore(this.permitsPerKey)
      this.semaphores.set(key, semaphore)
    }
    return semaphore
  }

  /**
   * Acquire a permit for a key.
   */
  async acquire(key: string, priority = 0): Promise<void> {
    const semaphore = this.getSemaphore(key)
    return semaphore.acquire(priority)
  }

  /**
   * Release a permit for a key.
   */
  release(key: string): void {
    const semaphore = this.semaphores.get(key)
    if (semaphore) {
      semaphore.release()
    }
  }

  /**
   * Execute a function with automatic permit management.
   */
  async withPermit<T>(key: string, fn: () => Promise<T>, priority = 0): Promise<T> {
    const semaphore = this.getSemaphore(key)
    return semaphore.withPermit(fn, priority)
  }

  /**
   * Get available permits for a key.
   */
  available(key: string): number {
    const semaphore = this.semaphores.get(key)
    return semaphore?.available ?? this.permitsPerKey
  }

  /**
   * Clear all semaphores.
   */
  clear(): void {
    for (const semaphore of this.semaphores.values()) {
      semaphore.reset()
    }
    this.semaphores.clear()
  }
}

// ============================================================================
// Batch Executor
// ============================================================================

/**
 * Execute operations in batches with concurrency control.
 */
export class BatchExecutor<T, R> {
  private readonly semaphore: Semaphore
  private readonly batchSize: number

  constructor(concurrency: number, batchSize = 10) {
    this.semaphore = new Semaphore(concurrency)
    this.batchSize = batchSize
  }

  /**
   * Execute a function for each item with concurrency control.
   */
  async map(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)

    await Promise.all(
      items.map(async (item, index) => {
        const result = await this.semaphore.withPermit(() => fn(item))
        results[index] = result
      })
    )

    return results
  }

  /**
   * Execute in batches.
   */
  async batch(items: T[], fn: (batch: T[]) => Promise<R[]>): Promise<R[]> {
    const results: R[] = []
    const batches: T[][] = []

    // Create batches
    for (let i = 0; i < items.length; i += this.batchSize) {
      batches.push(items.slice(i, i + this.batchSize))
    }

    // Process batches with concurrency control
    for (const batch of batches) {
      const batchResults = await this.semaphore.withPermit(() => fn(batch))
      results.push(...batchResults)
    }

    return results
  }
}
