/**
 * LRU Cache Implementation
 *
 * A bounded cache with Least Recently Used eviction policy.
 * Supports TTL (time-to-live) for automatic expiration.
 */

interface CacheEntry<T> {
  value: T
  cachedAt: number
  lastAccessed: number
}

export interface LRUCacheOptions {
  /** Maximum number of entries in the cache */
  maxSize: number
  /** Time-to-live in milliseconds (optional) */
  ttlMs?: number
  /** Callback when an entry is evicted */
  onEvict?: (key: string, value: unknown) => void
}

/**
 * LRU Cache with bounded size and optional TTL.
 */
export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private readonly maxSize: number
  private readonly ttlMs: number | null
  private readonly onEvict?: (key: string, value: unknown) => void

  constructor(options: LRUCacheOptions) {
    this.maxSize = options.maxSize
    this.ttlMs = options.ttlMs ?? null
    this.onEvict = options.onEvict
  }

  /**
   * Get a value from the cache.
   * Returns undefined if not found or expired.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    // Check TTL
    if (this.isExpired(entry)) {
      this.delete(key)
      return undefined
    }

    // Update last accessed time (LRU tracking)
    entry.lastAccessed = Date.now()

    // Move to end of Map (most recently used)
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.value
  }

  /**
   * Set a value in the cache.
   */
  set(key: string, value: T): void {
    // If key exists, update it
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // Evict if at capacity
    while (this.cache.size >= this.maxSize) {
      this.evictLRU()
    }

    const now = Date.now()
    this.cache.set(key, {
      value,
      cachedAt: now,
      lastAccessed: now
    })
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (this.isExpired(entry)) {
      this.delete(key)
      return false
    }

    return true
  }

  /**
   * Delete a key from the cache.
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (entry && this.onEvict) {
      this.onEvict(key, entry.value)
    }
    return this.cache.delete(key)
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    if (this.onEvict) {
      for (const [key, entry] of this.cache) {
        this.onEvict(key, entry.value)
      }
    }
    this.cache.clear()
  }

  /**
   * Get the number of entries in the cache.
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Get cache statistics.
   */
  stats(): {
    size: number
    maxSize: number
    ttlMs: number | null
    oldestEntryAge: number | null
  } {
    let oldestAge: number | null = null
    const now = Date.now()

    // Clean expired entries
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.delete(key)
      } else {
        const age = now - entry.cachedAt
        if (oldestAge === null || age > oldestAge) {
          oldestAge = age
        }
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      oldestEntryAge: oldestAge
    }
  }

  /**
   * Get all keys in the cache.
   */
  keys(): string[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Get all entries that match a predicate.
   */
  filter(predicate: (key: string, value: T) => boolean): Array<{ key: string; value: T }> {
    const results: Array<{ key: string; value: T }> = []

    for (const [key, entry] of this.cache) {
      if (!this.isExpired(entry) && predicate(key, entry.value)) {
        results.push({ key, value: entry.value })
      }
    }

    return results
  }

  /**
   * Clean up expired entries.
   */
  cleanup(): number {
    if (!this.ttlMs) return 0

    let removed = 0
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.delete(key)
        removed++
      }
    }
    return removed
  }

  /**
   * Get or compute a value.
   * If the key exists and is not expired, return it.
   * Otherwise, compute the value using the factory function and cache it.
   */
  async getOrCompute(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.get(key)
    if (existing !== undefined) {
      return existing
    }

    const value = await factory()
    this.set(key, value)
    return value
  }

  /**
   * Synchronous version of getOrCompute.
   */
  getOrComputeSync(key: string, factory: () => T): T {
    const existing = this.get(key)
    if (existing !== undefined) {
      return existing
    }

    const value = factory()
    this.set(key, value)
    return value
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    if (!this.ttlMs) return false
    return Date.now() - entry.cachedAt > this.ttlMs
  }

  private evictLRU(): void {
    // Map maintains insertion order, so first entry is oldest
    // But we need to find the least recently accessed
    let lruKey: string | null = null
    let lruTime = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed
        lruKey = key
      }
    }

    if (lruKey !== null) {
      this.delete(lruKey)
    }
  }
}

/**
 * Simple TTL cache without LRU (for compatibility with existing TTLCache).
 * This is a thin wrapper around LRUCache for backward compatibility.
 */
export class TTLCache<T> extends LRUCache<T> {
  constructor(ttlMs: number, maxSize = 1000) {
    super({ maxSize, ttlMs })
  }
}

/**
 * Create a bounded Map with LRU eviction.
 * Useful for replacing unbounded Maps in existing code.
 */
export function createBoundedMap<V>(maxSize: number): Map<string, V> & {
  setWithEviction: (key: string, value: V) => void
} {
  const cache = new LRUCache<V>({ maxSize })

  const boundedMap = new Map<string, V>()

  // Override set to use LRU eviction
  const originalSet = boundedMap.set.bind(boundedMap)

  const setWithEviction = (key: string, value: V): void => {
    cache.set(key, value)
    originalSet(key, value)

    // Sync removals
    while (boundedMap.size > maxSize) {
      const firstKey = boundedMap.keys().next().value
      if (firstKey) boundedMap.delete(firstKey)
    }
  }

  return Object.assign(boundedMap, { setWithEviction })
}

/**
 * Create a bounded Set with LRU eviction.
 * Useful for replacing unbounded Sets in existing code.
 */
export function createBoundedSet<V>(maxSize: number): Set<V> & {
  addWithEviction: (value: V) => void
} {
  const items: V[] = []
  const boundedSet = new Set<V>()

  const addWithEviction = (value: V): void => {
    if (boundedSet.has(value)) {
      // Move to end (most recently used)
      const idx = items.indexOf(value)
      if (idx !== -1) {
        items.splice(idx, 1)
        items.push(value)
      }
      return
    }

    // Evict oldest if at capacity
    while (boundedSet.size >= maxSize && items.length > 0) {
      const oldest = items.shift()
      if (oldest !== undefined) {
        boundedSet.delete(oldest)
      }
    }

    boundedSet.add(value)
    items.push(value)
  }

  return Object.assign(boundedSet, { addWithEviction })
}
