/**
 * Metadata Caching
 *
 * TTL-based caching for provider metadata.
 */

// ============================================================================
// Types
// ============================================================================

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

// ============================================================================
// Metadata Cache
// ============================================================================

/**
 * Generic TTL cache for provider metadata.
 */
export class MetadataCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>()

  constructor(private readonly defaultTtlMs = 5 * 60 * 1000) {}

  /**
   * Get cached value.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    return entry.value
  }

  /**
   * Set cached value.
   */
  set(key: string, value: T, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs)
    })
  }

  /**
   * Get or compute value.
   */
  async getOrCompute(key: string, compute: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) return cached

    const value = await compute()
    this.set(key, value, ttlMs)
    return value
  }

  /**
   * Check if key exists and is valid.
   */
  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  /**
   * Delete a key.
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache size (after pruning expired).
   */
  size(): number {
    this.prune()
    return this.cache.size
  }

  /**
   * Get all keys.
   */
  keys(): string[] {
    this.prune()
    return Array.from(this.cache.keys())
  }

  /**
   * Remove expired entries.
   */
  prune(): number {
    const now = Date.now()
    let pruned = 0
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
        pruned++
      }
    }
    return pruned
  }

  /**
   * Get remaining TTL for a key.
   */
  ttl(key: string): number {
    const entry = this.cache.get(key)
    if (!entry) return 0
    return Math.max(0, entry.expiresAt - Date.now())
  }
}

// ============================================================================
// Provider-specific Caches
// ============================================================================

/**
 * Cache for provider availability checks.
 */
export const availabilityCache = new MetadataCache<boolean>(5 * 60 * 1000)

/**
 * Cache for environment validation results.
 */
export const environmentCache = new MetadataCache<{ configured: boolean; missing: string[] }>(
  10 * 60 * 1000
)

/**
 * Cache for provider version info.
 */
export const versionCache = new MetadataCache<string>(60 * 60 * 1000)

/**
 * Cache for provider capabilities.
 */
export const capabilityCache = new MetadataCache<Record<string, unknown>>(30 * 60 * 1000)

// ============================================================================
// Cache Utilities
// ============================================================================

/**
 * Invalidate all caches for a provider.
 */
export function invalidateProvider(key: string): void {
  availabilityCache.delete(key)
  environmentCache.delete(key)
  versionCache.delete(key)
  capabilityCache.delete(key)
}

/**
 * Clear all metadata caches.
 */
export function clearAllCaches(): void {
  availabilityCache.clear()
  environmentCache.clear()
  versionCache.clear()
  capabilityCache.clear()
}

/**
 * Get cache stats.
 */
export function getCacheStats(): Record<string, number> {
  return {
    availability: availabilityCache.size(),
    environment: environmentCache.size(),
    version: versionCache.size(),
    capability: capabilityCache.size()
  }
}
