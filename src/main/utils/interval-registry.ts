/**
 * Interval Timer Registry
 *
 * Central registry for managing interval timers with automatic cleanup.
 * Prevents timer leaks by tracking all intervals and providing cleanup methods.
 */

// ============================================================================
// Types
// ============================================================================

export interface RegisteredInterval {
  id: string
  handle: NodeJS.Timeout
  callback: () => void | Promise<void>
  intervalMs: number
  createdAt: number
  lastExecutedAt: number | null
  executionCount: number
  description?: string
}

export interface IntervalRegistryStats {
  totalIntervals: number
  activeIntervals: number
  totalExecutions: number
  oldestIntervalAge: number | null
}

// ============================================================================
// Interval Registry
// ============================================================================

/**
 * Central registry for interval timers.
 * Provides tracking, cleanup, and stats for all registered intervals.
 */
class IntervalRegistryClass {
  private intervals = new Map<string, RegisteredInterval>()
  private idCounter = 0

  /**
   * Register a new interval timer.
   * @returns Interval ID for later reference
   */
  register(
    callback: () => void | Promise<void>,
    intervalMs: number,
    description?: string
  ): string {
    const id = `interval_${++this.idCounter}_${Date.now()}`

    // Wrap callback to track execution
    const wrappedCallback = async (): Promise<void> => {
      const entry = this.intervals.get(id)
      if (entry) {
        entry.lastExecutedAt = Date.now()
        entry.executionCount++
      }

      try {
        await callback()
      } catch (error) {
        console.error(`[IntervalRegistry] Error in interval ${id}:`, error)
      }
    }

    const handle = setInterval(wrappedCallback, intervalMs)

    const entry: RegisteredInterval = {
      id,
      handle,
      callback,
      intervalMs,
      createdAt: Date.now(),
      lastExecutedAt: null,
      executionCount: 0,
      description
    }

    this.intervals.set(id, entry)

    return id
  }

  /**
   * Unregister and clear an interval by ID.
   */
  unregister(id: string): boolean {
    const entry = this.intervals.get(id)
    if (!entry) return false

    clearInterval(entry.handle)
    this.intervals.delete(id)
    return true
  }

  /**
   * Get an interval entry by ID.
   */
  get(id: string): RegisteredInterval | undefined {
    return this.intervals.get(id)
  }

  /**
   * Check if an interval is registered.
   */
  has(id: string): boolean {
    return this.intervals.has(id)
  }

  /**
   * Get all registered interval IDs.
   */
  getIds(): string[] {
    return Array.from(this.intervals.keys())
  }

  /**
   * Get all intervals matching a description pattern.
   */
  findByDescription(pattern: string | RegExp): RegisteredInterval[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern

    return Array.from(this.intervals.values()).filter((entry) =>
      entry.description ? regex.test(entry.description) : false
    )
  }

  /**
   * Clear all registered intervals.
   */
  clearAll(): number {
    let count = 0
    for (const [id, entry] of this.intervals) {
      clearInterval(entry.handle)
      this.intervals.delete(id)
      count++
    }
    return count
  }

  /**
   * Clear intervals matching a description pattern.
   */
  clearByDescription(pattern: string | RegExp): number {
    const matching = this.findByDescription(pattern)
    let count = 0

    for (const entry of matching) {
      if (this.unregister(entry.id)) {
        count++
      }
    }

    return count
  }

  /**
   * Get registry statistics.
   */
  getStats(): IntervalRegistryStats {
    const entries = Array.from(this.intervals.values())
    const now = Date.now()

    let oldestAge: number | null = null
    let totalExecutions = 0

    for (const entry of entries) {
      const age = now - entry.createdAt
      if (oldestAge === null || age > oldestAge) {
        oldestAge = age
      }
      totalExecutions += entry.executionCount
    }

    return {
      totalIntervals: entries.length,
      activeIntervals: entries.length, // All registered intervals are active
      totalExecutions,
      oldestIntervalAge: oldestAge
    }
  }

  /**
   * Get detailed info for all intervals.
   */
  getDetails(): RegisteredInterval[] {
    return Array.from(this.intervals.values())
  }

  /**
   * Reset the registry (for testing).
   */
  reset(): void {
    this.clearAll()
    this.idCounter = 0
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const IntervalRegistry = new IntervalRegistryClass()

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a managed interval that's automatically tracked.
 */
export function createManagedInterval(
  callback: () => void | Promise<void>,
  intervalMs: number,
  description?: string
): string {
  return IntervalRegistry.register(callback, intervalMs, description)
}

/**
 * Clear a managed interval.
 */
export function clearManagedInterval(id: string): boolean {
  return IntervalRegistry.unregister(id)
}

/**
 * Clear all managed intervals.
 */
export function clearAllManagedIntervals(): number {
  return IntervalRegistry.clearAll()
}

// ============================================================================
// Timeout Registry (similar pattern for timeouts)
// ============================================================================

interface RegisteredTimeout {
  id: string
  handle: NodeJS.Timeout
  callback: () => void | Promise<void>
  delayMs: number
  createdAt: number
  description?: string
}

class TimeoutRegistryClass {
  private timeouts = new Map<string, RegisteredTimeout>()
  private idCounter = 0

  register(
    callback: () => void | Promise<void>,
    delayMs: number,
    description?: string
  ): string {
    const id = `timeout_${++this.idCounter}_${Date.now()}`

    const wrappedCallback = async (): Promise<void> => {
      this.timeouts.delete(id)

      try {
        await callback()
      } catch (error) {
        console.error(`[TimeoutRegistry] Error in timeout ${id}:`, error)
      }
    }

    const handle = setTimeout(wrappedCallback, delayMs)

    this.timeouts.set(id, {
      id,
      handle,
      callback,
      delayMs,
      createdAt: Date.now(),
      description
    })

    return id
  }

  unregister(id: string): boolean {
    const entry = this.timeouts.get(id)
    if (!entry) return false

    clearTimeout(entry.handle)
    this.timeouts.delete(id)
    return true
  }

  has(id: string): boolean {
    return this.timeouts.has(id)
  }

  clearAll(): number {
    let count = 0
    for (const [id, entry] of this.timeouts) {
      clearTimeout(entry.handle)
      this.timeouts.delete(id)
      count++
    }
    return count
  }

  get size(): number {
    return this.timeouts.size
  }

  reset(): void {
    this.clearAll()
    this.idCounter = 0
  }
}

export const TimeoutRegistry = new TimeoutRegistryClass()

/**
 * Create a managed timeout that's automatically tracked.
 */
export function createManagedTimeout(
  callback: () => void | Promise<void>,
  delayMs: number,
  description?: string
): string {
  return TimeoutRegistry.register(callback, delayMs, description)
}

/**
 * Clear a managed timeout.
 */
export function clearManagedTimeout(id: string): boolean {
  return TimeoutRegistry.unregister(id)
}

// ============================================================================
// Cleanup on Shutdown
// ============================================================================

/**
 * Clean up all managed timers.
 * Call this during application shutdown.
 */
export function cleanupAllTimers(): { intervals: number; timeouts: number } {
  return {
    intervals: IntervalRegistry.clearAll(),
    timeouts: TimeoutRegistry.clearAll()
  }
}
