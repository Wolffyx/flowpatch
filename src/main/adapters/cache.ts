/**
 * Adapter Cache
 *
 * Provides caching for API responses from GitHub/GitLab adapters.
 * Reduces API rate limit consumption by caching frequently accessed data.
 */

// ============================================================================
// Types
// ============================================================================

interface CacheEntry<T> {
  data: T
  cachedAt: number
  etag?: string
  lastModified?: string
}

interface CacheStats {
  hits: number
  misses: number
  size: number
}

// ============================================================================
// Configuration
// ============================================================================

// Default TTLs for different types of data
const DEFAULT_TTL_MS = {
  issues: 2 * 60 * 1000, // 2 minutes
  pullRequests: 2 * 60 * 1000, // 2 minutes
  labels: 10 * 60 * 1000, // 10 minutes
  auth: 5 * 60 * 1000, // 5 minutes
  user: 30 * 60 * 1000, // 30 minutes
  projectStatus: 5 * 60 * 1000 // 5 minutes
}

const MAX_CACHE_SIZE = 500

// ============================================================================
// Adapter Response Cache
// ============================================================================

/**
 * Cache for adapter API responses.
 */
class AdapterResponseCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private stats: CacheStats = { hits: 0, misses: 0, size: 0 }

  /**
   * Get a cached value if it exists and is not expired.
   */
  get<T>(key: string, ttlMs: number): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    if (!entry) {
      this.stats.misses++
      return undefined
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > ttlMs) {
      this.cache.delete(key)
      this.stats.misses++
      return undefined
    }

    this.stats.hits++
    return entry.data
  }

  /**
   * Set a cached value.
   */
  set<T>(key: string, data: T, options: { etag?: string; lastModified?: string } = {}): void {
    // Evict if at capacity
    if (this.cache.size >= MAX_CACHE_SIZE && !this.cache.has(key)) {
      this.evictOldest()
    }

    this.cache.set(key, {
      data,
      cachedAt: Date.now(),
      etag: options.etag,
      lastModified: options.lastModified
    })
    this.stats.size = this.cache.size
  }

  /**
   * Get ETag for a cached entry (for conditional requests).
   */
  getETag(key: string): string | undefined {
    return this.cache.get(key)?.etag
  }

  /**
   * Get Last-Modified for a cached entry.
   */
  getLastModified(key: string): string | undefined {
    return this.cache.get(key)?.lastModified
  }

  /**
   * Invalidate cache entries matching a pattern.
   */
  invalidate(pattern: RegExp): number {
    let count = 0
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key)
        count++
      }
    }
    this.stats.size = this.cache.size
    return count
  }

  /**
   * Invalidate all cache entries for a repo.
   */
  invalidateRepo(repoKey: string): number {
    return this.invalidate(new RegExp(`^${escapeRegex(repoKey)}:`))
  }

  /**
   * Clear all cached data.
   */
  clear(): void {
    this.cache.clear()
    this.stats.size = 0
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    return { ...this.stats }
  }

  /**
   * Get hit rate (0-1).
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses
    return total === 0 ? 0 : this.stats.hits / total
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================================
// Global Cache Instance
// ============================================================================

export const adapterCache = new AdapterResponseCache()

// ============================================================================
// Cache Key Helpers
// ============================================================================

/**
 * Create cache key for issues list.
 */
export function issuesKey(repoKey: string, state = 'open'): string {
  return `${repoKey}:issues:${state}`
}

/**
 * Create cache key for a single issue.
 */
export function issueKey(repoKey: string, issueNumber: number): string {
  return `${repoKey}:issue:${issueNumber}`
}

/**
 * Create cache key for pull requests list.
 */
export function pullRequestsKey(repoKey: string, state = 'open'): string {
  return `${repoKey}:prs:${state}`
}

/**
 * Create cache key for labels.
 */
export function labelsKey(repoKey: string): string {
  return `${repoKey}:labels`
}

/**
 * Create cache key for auth status.
 */
export function authKey(provider: string): string {
  return `auth:${provider}`
}

/**
 * Create cache key for project status.
 */
export function projectStatusKey(repoKey: string, projectId: string): string {
  return `${repoKey}:project:${projectId}:status`
}

// ============================================================================
// Cached Data Access Helpers
// ============================================================================

/**
 * Get cached issues list.
 */
export function getCachedIssues<T>(repoKey: string, state = 'open'): T | undefined {
  return adapterCache.get<T>(issuesKey(repoKey, state), DEFAULT_TTL_MS.issues)
}

/**
 * Cache issues list.
 */
export function cacheIssues<T>(repoKey: string, data: T, state = 'open'): void {
  adapterCache.set(issuesKey(repoKey, state), data)
}

/**
 * Get cached pull requests.
 */
export function getCachedPullRequests<T>(repoKey: string, state = 'open'): T | undefined {
  return adapterCache.get<T>(pullRequestsKey(repoKey, state), DEFAULT_TTL_MS.pullRequests)
}

/**
 * Cache pull requests.
 */
export function cachePullRequests<T>(repoKey: string, data: T, state = 'open'): void {
  adapterCache.set(pullRequestsKey(repoKey, state), data)
}

/**
 * Get cached labels.
 */
export function getCachedLabels<T>(repoKey: string): T | undefined {
  return adapterCache.get<T>(labelsKey(repoKey), DEFAULT_TTL_MS.labels)
}

/**
 * Cache labels.
 */
export function cacheLabels<T>(repoKey: string, data: T): void {
  adapterCache.set(labelsKey(repoKey), data)
}

/**
 * Invalidate all cached data for a repo.
 */
export function invalidateRepoCache(repoKey: string): void {
  adapterCache.invalidateRepo(repoKey)
}

/**
 * Get adapter cache statistics.
 */
export function getAdapterCacheStats(): CacheStats {
  return adapterCache.getStats()
}

// ============================================================================
// Batching Helpers
// ============================================================================

interface BatchRequest<T> {
  id: string
  resolve: (value: T) => void
  reject: (error: Error) => void
}

/**
 * Batches multiple requests into a single API call.
 * Useful for fetching multiple issues/PRs in one request.
 */
export class RequestBatcher<K, T> {
  private pending = new Map<K, BatchRequest<T>[]>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly batchDelayMs: number
  private readonly maxBatchSize: number
  private readonly executor: (keys: K[]) => Promise<Map<K, T>>

  constructor(
    executor: (keys: K[]) => Promise<Map<K, T>>,
    options: { batchDelayMs?: number; maxBatchSize?: number } = {}
  ) {
    this.executor = executor
    this.batchDelayMs = options.batchDelayMs ?? 50
    this.maxBatchSize = options.maxBatchSize ?? 50
  }

  /**
   * Request data for a key. The request will be batched with others.
   */
  async request(key: K): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = Math.random().toString(36).slice(2)
      const requests = this.pending.get(key) ?? []
      requests.push({ id, resolve, reject })
      this.pending.set(key, requests)

      // Execute immediately if batch is full
      if (this.pending.size >= this.maxBatchSize) {
        this.executeBatch()
      } else if (!this.timer) {
        // Schedule batch execution
        this.timer = setTimeout(() => this.executeBatch(), this.batchDelayMs)
      }
    })
  }

  private async executeBatch(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const batch = new Map(this.pending)
    this.pending.clear()

    if (batch.size === 0) return

    try {
      const keys = Array.from(batch.keys())
      const results = await this.executor(keys)

      // Resolve pending requests
      for (const [key, requests] of batch) {
        const result = results.get(key)
        for (const req of requests) {
          if (result !== undefined) {
            req.resolve(result)
          } else {
            req.reject(new Error(`No result for key: ${key}`))
          }
        }
      }
    } catch (error) {
      // Reject all pending requests
      for (const requests of batch.values()) {
        for (const req of requests) {
          req.reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }
  }

  /**
   * Clear all pending requests.
   */
  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const requests of this.pending.values()) {
      for (const req of requests) {
        req.reject(new Error('Batcher cleared'))
      }
    }
    this.pending.clear()
  }
}
