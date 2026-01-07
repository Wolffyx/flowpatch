/**
 * Resource Tracker
 *
 * Tracks and manages resources (files, processes, timers, connections)
 * to ensure proper cleanup on shutdown or error.
 */

import { ChildProcess } from 'child_process'

// ============================================================================
// Types
// ============================================================================

export type ResourceType = 'process' | 'file' | 'timer' | 'connection' | 'lock' | 'custom'

export interface TrackedResource {
  id: string
  type: ResourceType
  description: string
  createdAt: number
  cleanup: () => void | Promise<void>
  metadata?: Record<string, unknown>
}

export interface ResourceTrackerStats {
  totalResources: number
  byType: Record<ResourceType, number>
  oldestResourceAge: number | null
}

// ============================================================================
// Resource Tracker
// ============================================================================

class ResourceTrackerClass {
  private resources = new Map<string, TrackedResource>()
  private idCounter = 0
  private shuttingDown = false

  /**
   * Track a new resource.
   */
  track(
    type: ResourceType,
    description: string,
    cleanup: () => void | Promise<void>,
    metadata?: Record<string, unknown>
  ): string {
    const id = `${type}_${++this.idCounter}_${Date.now()}`

    this.resources.set(id, {
      id,
      type,
      description,
      createdAt: Date.now(),
      cleanup,
      metadata
    })

    return id
  }

  /**
   * Untrack a resource (without cleanup).
   */
  untrack(id: string): boolean {
    return this.resources.delete(id)
  }

  /**
   * Release a resource (with cleanup).
   */
  async release(id: string): Promise<boolean> {
    const resource = this.resources.get(id)
    if (!resource) return false

    try {
      await resource.cleanup()
    } catch (error) {
      console.error(`[ResourceTracker] Error cleaning up ${id}:`, error)
    }

    return this.resources.delete(id)
  }

  /**
   * Get a tracked resource.
   */
  get(id: string): TrackedResource | undefined {
    return this.resources.get(id)
  }

  /**
   * Check if a resource is tracked.
   */
  has(id: string): boolean {
    return this.resources.has(id)
  }

  /**
   * Get all resources of a type.
   */
  getByType(type: ResourceType): TrackedResource[] {
    return Array.from(this.resources.values()).filter((r) => r.type === type)
  }

  /**
   * Release all resources of a type.
   */
  async releaseByType(type: ResourceType): Promise<number> {
    const resources = this.getByType(type)
    let count = 0

    for (const resource of resources) {
      if (await this.release(resource.id)) {
        count++
      }
    }

    return count
  }

  /**
   * Release all resources.
   */
  async releaseAll(): Promise<number> {
    if (this.shuttingDown) return 0

    this.shuttingDown = true
    let count = 0

    // Release in reverse order (LIFO)
    const ids = Array.from(this.resources.keys()).reverse()

    for (const id of ids) {
      if (await this.release(id)) {
        count++
      }
    }

    this.shuttingDown = false
    return count
  }

  /**
   * Get tracker statistics.
   */
  getStats(): ResourceTrackerStats {
    const resources = Array.from(this.resources.values())
    const now = Date.now()

    const byType: Record<ResourceType, number> = {
      process: 0,
      file: 0,
      timer: 0,
      connection: 0,
      lock: 0,
      custom: 0
    }

    let oldestAge: number | null = null

    for (const resource of resources) {
      byType[resource.type]++
      const age = now - resource.createdAt
      if (oldestAge === null || age > oldestAge) {
        oldestAge = age
      }
    }

    return {
      totalResources: resources.length,
      byType,
      oldestResourceAge: oldestAge
    }
  }

  /**
   * Get all tracked resources.
   */
  getAll(): TrackedResource[] {
    return Array.from(this.resources.values())
  }

  /**
   * Check if shutting down.
   */
  get isShuttingDown(): boolean {
    return this.shuttingDown
  }

  /**
   * Reset the tracker (for testing).
   */
  reset(): void {
    this.resources.clear()
    this.idCounter = 0
    this.shuttingDown = false
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const ResourceTracker = new ResourceTrackerClass()

// ============================================================================
// Specialized Tracking Functions
// ============================================================================

/**
 * Track a child process.
 */
export function trackProcess(
  process: ChildProcess,
  description: string,
  metadata?: Record<string, unknown>
): string {
  return ResourceTracker.track(
    'process',
    description,
    () => {
      if (process.pid && !process.killed) {
        try {
          process.kill('SIGTERM')
          // Give it a moment, then force kill
          setTimeout(() => {
            try {
              if (!process.killed) {
                process.kill('SIGKILL')
              }
            } catch {
              // Ignore
            }
          }, 2000)
        } catch {
          // Process may already be dead
        }
      }
    },
    { pid: process.pid, ...metadata }
  )
}

/**
 * Track a file handle or descriptor.
 */
export function trackFile(
  description: string,
  cleanup: () => void | Promise<void>,
  metadata?: Record<string, unknown>
): string {
  return ResourceTracker.track('file', description, cleanup, metadata)
}

/**
 * Track a timer (interval or timeout).
 */
export function trackTimer(
  handle: NodeJS.Timeout,
  description: string,
  isInterval = false,
  metadata?: Record<string, unknown>
): string {
  return ResourceTracker.track(
    'timer',
    description,
    () => {
      if (isInterval) {
        clearInterval(handle)
      } else {
        clearTimeout(handle)
      }
    },
    { isInterval, ...metadata }
  )
}

/**
 * Track a connection (database, network, etc.).
 */
export function trackConnection(
  description: string,
  cleanup: () => void | Promise<void>,
  metadata?: Record<string, unknown>
): string {
  return ResourceTracker.track('connection', description, cleanup, metadata)
}

/**
 * Track a lock.
 */
export function trackLock(
  description: string,
  cleanup: () => void | Promise<void>,
  metadata?: Record<string, unknown>
): string {
  return ResourceTracker.track('lock', description, cleanup, metadata)
}

/**
 * Track a custom resource.
 */
export function trackCustom(
  description: string,
  cleanup: () => void | Promise<void>,
  metadata?: Record<string, unknown>
): string {
  return ResourceTracker.track('custom', description, cleanup, metadata)
}

// ============================================================================
// Scoped Resource Management
// ============================================================================

/**
 * Resource scope for automatic cleanup.
 */
export class ResourceScope {
  private resources: string[] = []

  /**
   * Track a resource in this scope.
   */
  track(
    type: ResourceType,
    description: string,
    cleanup: () => void | Promise<void>,
    metadata?: Record<string, unknown>
  ): string {
    const id = ResourceTracker.track(type, description, cleanup, metadata)
    this.resources.push(id)
    return id
  }

  /**
   * Release all resources in this scope.
   */
  async release(): Promise<number> {
    let count = 0
    for (const id of this.resources.reverse()) {
      if (await ResourceTracker.release(id)) {
        count++
      }
    }
    this.resources = []
    return count
  }

  /**
   * Execute a function with automatic cleanup on completion or error.
   */
  async use<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } finally {
      await this.release()
    }
  }

  /**
   * Get number of resources in this scope.
   */
  get size(): number {
    return this.resources.length
  }
}

/**
 * Create a new resource scope.
 */
export function createResourceScope(): ResourceScope {
  return new ResourceScope()
}

// ============================================================================
// Shutdown Hook
// ============================================================================

let shutdownHookRegistered = false

/**
 * Register shutdown hooks for cleanup.
 */
export function registerShutdownHooks(): void {
  if (shutdownHookRegistered) return

  shutdownHookRegistered = true

  const shutdown = async (): Promise<void> => {
    console.log('[ResourceTracker] Shutdown initiated, cleaning up resources...')
    const count = await ResourceTracker.releaseAll()
    console.log(`[ResourceTracker] Released ${count} resources`)
  }

  // Handle various shutdown signals
  process.on('SIGINT', async () => {
    await shutdown()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await shutdown()
    process.exit(0)
  })

  process.on('beforeExit', async () => {
    await shutdown()
  })
}
