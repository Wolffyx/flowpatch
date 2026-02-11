/**
 * Request Deduplication
 *
 * Deduplicates identical provider requests within a time window.
 */

import { createHash } from 'crypto'

// ============================================================================
// Types
// ============================================================================

interface PendingRequest<T> {
  promise: Promise<T>
  timestamp: number
}

interface CachedResult<T> {
  result: T
  timestamp: number
}

// ============================================================================
// Request Deduplicator
// ============================================================================

/**
 * Deduplicates identical requests within a time window.
 */
export class RequestDeduplicator<T = unknown> {
  private pending = new Map<string, PendingRequest<T>>()
  private cache = new Map<string, CachedResult<T>>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly cacheTtlMs = 30000, // Cache results for 30s
    private readonly cleanupIntervalMs = 60000 // Cleanup every minute
  ) {
    this.startCleanup()
  }

  /**
   * Generate a hash key for a request.
   */
  hash(prompt: string, options?: Record<string, unknown>): string {
    const data = JSON.stringify({ prompt, options })
    return createHash('sha256').update(data).digest('hex').slice(0, 16)
  }

  /**
   * Execute a request, deduplicating identical concurrent requests.
   */
  async dedupe<R extends T>(key: string, executor: () => Promise<R>): Promise<R> {
    // Check cache first
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.result as R
    }

    // Check if request is in flight
    const pending = this.pending.get(key)
    if (pending) {
      return pending.promise as Promise<R>
    }

    // Execute new request
    const promise = executor().finally(() => {
      this.pending.delete(key)
    })

    this.pending.set(key, { promise, timestamp: Date.now() })

    try {
      const result = await promise
      this.cache.set(key, { result, timestamp: Date.now() })
      return result
    } catch (error) {
      // Don't cache errors
      throw error
    }
  }

  /**
   * Check if a request is currently pending.
   */
  isPending(key: string): boolean {
    return this.pending.has(key)
  }

  /**
   * Check if a result is cached.
   */
  isCached(key: string): boolean {
    const cached = this.cache.get(key)
    return cached ? Date.now() - cached.timestamp < this.cacheTtlMs : false
  }

  /**
   * Get cached result if available.
   */
  getCached(key: string): T | undefined {
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.result
    }
    return undefined
  }

  /**
   * Invalidate a cached result.
   */
  invalidate(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Clear all caches.
   */
  clear(): void {
    this.pending.clear()
    this.cache.clear()
  }

  /**
   * Get pending request count.
   */
  get pendingCount(): number {
    return this.pending.size
  }

  /**
   * Get cached result count.
   */
  get cacheSize(): number {
    return this.cache.size
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.cache) {
        if (now - entry.timestamp > this.cacheTtlMs) {
          this.cache.delete(key)
        }
      }
    }, this.cleanupIntervalMs)
  }

  /**
   * Destroy the deduplicator.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.clear()
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global query deduplicator instance.
 */
export const queryDeduplicator = new RequestDeduplicator()
