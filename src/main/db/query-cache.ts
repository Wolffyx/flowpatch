/**
 * Query Cache
 *
 * Provides caching for frequently accessed database queries.
 * Uses LRU eviction and TTL expiration.
 */

// ============================================================================
// Types
// ============================================================================

interface CacheEntry<T> {
  data: T
  cachedAt: number
  hits: number
}

interface CacheStats {
  size: number
  maxSize: number
  hits: number
  misses: number
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TTL_MS = 30 * 1000 // 30 seconds
const DEFAULT_MAX_SIZE = 100

// ============================================================================
// Query Cache Implementation
// ============================================================================

/**
 * A simple LRU cache for query results with TTL expiration.
 */
export class QueryCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private readonly maxSize: number
  private readonly ttlMs: number
  private hits = 0
  private misses = 0

  constructor(options: { maxSize?: number; ttlMs?: number } = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  }

  /**
   * Get a cached value if it exists and is not expired.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      this.misses++
      return undefined
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key)
      this.misses++
      return undefined
    }

    entry.hits++
    this.hits++
    return entry.data
  }

  /**
   * Set a cached value.
   */
  set(key: string, data: T): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest()
    }

    this.cache.set(key, {
      data,
      cachedAt: Date.now(),
      hits: 0
    })
  }

  /**
   * Get or set a cached value using a factory function.
   */
  getOrSet(key: string, factory: () => T): T {
    const cached = this.get(key)
    if (cached !== undefined) {
      return cached
    }

    const data = factory()
    this.set(key, data)
    return data
  }

  /**
   * Async version of getOrSet.
   */
  async getOrSetAsync(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) {
      return cached
    }

    const data = await factory()
    this.set(key, data)
    return data
  }

  /**
   * Invalidate a specific key.
   */
  invalidate(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Invalidate all keys matching a pattern.
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key)
        count++
      }
    }
    return count
  }

  /**
   * Invalidate all keys starting with a prefix.
   */
  invalidatePrefix(prefix: string): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
        count++
      }
    }
    return count
  }

  /**
   * Clear all cached data.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses
    }
  }

  /**
   * Get hit rate (0-1).
   */
  getHitRate(): number {
    const total = this.hits + this.misses
    return total === 0 ? 0 : this.hits / total
  }

  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.cachedAt < oldestTime) {
        oldestTime = entry.cachedAt
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }
}

// ============================================================================
// Global Cache Instances
// ============================================================================

// Cache for project data (projects don't change often)
export const projectCache = new QueryCache<unknown>({
  maxSize: 50,
  ttlMs: 60 * 1000 // 1 minute
})

// Cache for card data (cards change more frequently)
export const cardCache = new QueryCache<unknown>({
  maxSize: 200,
  ttlMs: 15 * 1000 // 15 seconds
})

// Cache for settings (rarely change)
export const settingsCache = new QueryCache<unknown>({
  maxSize: 20,
  ttlMs: 5 * 60 * 1000 // 5 minutes
})

// Cache for job status checks (very short TTL)
export const jobStatusCache = new QueryCache<unknown>({
  maxSize: 100,
  ttlMs: 5 * 1000 // 5 seconds
})

// ============================================================================
// Cache Invalidation Helpers
// ============================================================================

/**
 * Invalidate all caches for a project.
 */
export function invalidateProjectCaches(projectId: string): void {
  const pattern = new RegExp(`^${projectId}:`)
  projectCache.invalidatePattern(pattern)
  cardCache.invalidatePattern(pattern)
  jobStatusCache.invalidatePattern(pattern)
}

/**
 * Invalidate all caches for a card.
 */
export function invalidateCardCaches(cardId: string): void {
  cardCache.invalidatePattern(new RegExp(`card:${cardId}`))
  jobStatusCache.invalidatePattern(new RegExp(`job:.*:${cardId}`))
}

/**
 * Clear all query caches.
 */
export function clearAllQueryCaches(): void {
  projectCache.clear()
  cardCache.clear()
  settingsCache.clear()
  jobStatusCache.clear()
}

/**
 * Get combined cache statistics.
 */
export function getAllCacheStats(): Record<string, CacheStats> {
  return {
    project: projectCache.getStats(),
    card: cardCache.getStats(),
    settings: settingsCache.getStats(),
    jobStatus: jobStatusCache.getStats()
  }
}

// ============================================================================
// Cache Key Helpers
// ============================================================================

/**
 * Create a cache key for a project query.
 */
export function projectKey(projectId: string, suffix: string): string {
  return `${projectId}:project:${suffix}`
}

/**
 * Create a cache key for a card query.
 */
export function cardKey(projectId: string, cardId: string, suffix: string): string {
  return `${projectId}:card:${cardId}:${suffix}`
}

/**
 * Create a cache key for a job query.
 */
export function jobKey(projectId: string, jobId: string, suffix: string): string {
  return `${projectId}:job:${jobId}:${suffix}`
}
