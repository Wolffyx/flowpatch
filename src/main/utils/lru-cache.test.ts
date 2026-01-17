/**
 * Unit tests for LRU Cache implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LRUCache, TTLCache, createBoundedMap, createBoundedSet } from './lru-cache'

describe('LRUCache', () => {
  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    it('should return undefined for missing keys', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      expect(cache.get('missing')).toBeUndefined()
    })

    it('should check if key exists with has()', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      cache.set('key1', 'value1')
      expect(cache.has('key1')).toBe(true)
      expect(cache.has('missing')).toBe(false)
    })

    it('should delete keys', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      cache.set('key1', 'value1')
      expect(cache.delete('key1')).toBe(true)
      expect(cache.get('key1')).toBeUndefined()
      expect(cache.delete('missing')).toBe(false)
    })

    it('should clear all entries', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.clear()
      expect(cache.size).toBe(0)
      expect(cache.get('key1')).toBeUndefined()
    })

    it('should report correct size', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      expect(cache.size).toBe(0)
      cache.set('key1', 'value1')
      expect(cache.size).toBe(1)
      cache.set('key2', 'value2')
      expect(cache.size).toBe(2)
    })

    it('should return all keys', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      const keys = cache.keys()
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
    })
  })

  describe('LRU eviction', () => {
    it('should evict least recently used entry when at capacity', () => {
      const cache = new LRUCache<string>({ maxSize: 3 })
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')
      cache.set('key4', 'value4') // Should evict key1

      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBe('value2')
      expect(cache.get('key3')).toBe('value3')
      expect(cache.get('key4')).toBe('value4')
    })

    it('should update LRU order on get', () => {
      const cache = new LRUCache<string>({ maxSize: 3 })
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      // Access key1 to make it most recently used
      cache.get('key1')

      // Add key4, should evict key2 (now least recently used)
      cache.set('key4', 'value4')

      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBeUndefined()
      expect(cache.get('key3')).toBe('value3')
      expect(cache.get('key4')).toBe('value4')
    })

    it('should call onEvict callback when evicting', () => {
      const onEvict = vi.fn()
      const cache = new LRUCache<string>({ maxSize: 2, onEvict })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3') // Should evict key1

      expect(onEvict).toHaveBeenCalledWith('key1', 'value1')
    })

    it('should call onEvict on delete', () => {
      const onEvict = vi.fn()
      const cache = new LRUCache<string>({ maxSize: 10, onEvict })

      cache.set('key1', 'value1')
      cache.delete('key1')

      expect(onEvict).toHaveBeenCalledWith('key1', 'value1')
    })

    it('should call onEvict on clear', () => {
      const onEvict = vi.fn()
      const cache = new LRUCache<string>({ maxSize: 10, onEvict })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.clear()

      expect(onEvict).toHaveBeenCalledTimes(2)
    })
  })

  describe('TTL functionality', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return undefined for expired entries', () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 1000 })
      cache.set('key1', 'value1')

      expect(cache.get('key1')).toBe('value1')

      // Advance time past TTL
      vi.advanceTimersByTime(1500)

      expect(cache.get('key1')).toBeUndefined()
    })

    it('should report has() as false for expired entries', () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 1000 })
      cache.set('key1', 'value1')

      expect(cache.has('key1')).toBe(true)

      vi.advanceTimersByTime(1500)

      expect(cache.has('key1')).toBe(false)
    })

    it('should cleanup expired entries', () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 1000 })
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      vi.advanceTimersByTime(500)
      cache.set('key3', 'value3')

      vi.advanceTimersByTime(600) // key1 and key2 expired, key3 still valid

      const removed = cache.cleanup()
      expect(removed).toBe(2)
      expect(cache.size).toBe(1)
    })

    it('should return 0 from cleanup when no TTL configured', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      cache.set('key1', 'value1')

      const removed = cache.cleanup()
      expect(removed).toBe(0)
    })
  })

  describe('stats', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return correct stats', () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 5000 })
      cache.set('key1', 'value1')

      vi.advanceTimersByTime(1000)

      const stats = cache.stats()
      expect(stats.size).toBe(1)
      expect(stats.maxSize).toBe(10)
      expect(stats.ttlMs).toBe(5000)
      expect(stats.oldestEntryAge).toBeGreaterThanOrEqual(1000)
    })

    it('should return null oldest age when empty', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      const stats = cache.stats()
      expect(stats.oldestEntryAge).toBeNull()
    })
  })

  describe('filter', () => {
    it('should filter entries by predicate', () => {
      const cache = new LRUCache<number>({ maxSize: 10 })
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.set('d', 4)

      const evens = cache.filter((_, value) => value % 2 === 0)
      expect(evens).toHaveLength(2)
      expect(evens.map((e) => e.value)).toContain(2)
      expect(evens.map((e) => e.value)).toContain(4)
    })
  })

  describe('getOrCompute', () => {
    it('should return cached value if exists', async () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      cache.set('key1', 'cached')

      const factory = vi.fn().mockResolvedValue('computed')
      const result = await cache.getOrCompute('key1', factory)

      expect(result).toBe('cached')
      expect(factory).not.toHaveBeenCalled()
    })

    it('should compute and cache value if not exists', async () => {
      const cache = new LRUCache<string>({ maxSize: 10 })

      const factory = vi.fn().mockResolvedValue('computed')
      const result = await cache.getOrCompute('key1', factory)

      expect(result).toBe('computed')
      expect(factory).toHaveBeenCalled()
      expect(cache.get('key1')).toBe('computed')
    })
  })

  describe('getOrComputeSync', () => {
    it('should return cached value if exists', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })
      cache.set('key1', 'cached')

      const factory = vi.fn().mockReturnValue('computed')
      const result = cache.getOrComputeSync('key1', factory)

      expect(result).toBe('cached')
      expect(factory).not.toHaveBeenCalled()
    })

    it('should compute and cache value if not exists', () => {
      const cache = new LRUCache<string>({ maxSize: 10 })

      const factory = vi.fn().mockReturnValue('computed')
      const result = cache.getOrComputeSync('key1', factory)

      expect(result).toBe('computed')
      expect(factory).toHaveBeenCalled()
      expect(cache.get('key1')).toBe('computed')
    })
  })
})

describe('TTLCache', () => {
  it('should be a thin wrapper around LRUCache', () => {
    const cache = new TTLCache<string>(1000, 100)
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBe('value1')
  })
})

describe('createBoundedMap', () => {
  it('should create a Map with setWithEviction method', () => {
    const map = createBoundedMap<string>(3)
    expect(map.setWithEviction).toBeDefined()
  })

  it('should evict oldest entries when at capacity', () => {
    const map = createBoundedMap<string>(3)
    map.setWithEviction('key1', 'value1')
    map.setWithEviction('key2', 'value2')
    map.setWithEviction('key3', 'value3')
    map.setWithEviction('key4', 'value4')

    expect(map.size).toBeLessThanOrEqual(3)
  })
})

describe('createBoundedSet', () => {
  it('should create a Set with addWithEviction method', () => {
    const set = createBoundedSet<string>(3)
    expect(set.addWithEviction).toBeDefined()
  })

  it('should evict oldest entries when at capacity', () => {
    const set = createBoundedSet<string>(3)
    set.addWithEviction('a')
    set.addWithEviction('b')
    set.addWithEviction('c')
    set.addWithEviction('d')

    expect(set.size).toBe(3)
    expect(set.has('a')).toBe(false)
    expect(set.has('d')).toBe(true)
  })

  it('should move to end on duplicate add', () => {
    const set = createBoundedSet<string>(3)
    set.addWithEviction('a')
    set.addWithEviction('b')
    set.addWithEviction('c')

    // Re-add 'a' to make it most recently used
    set.addWithEviction('a')

    // Add 'd', should evict 'b' (now least recently used)
    set.addWithEviction('d')

    expect(set.has('a')).toBe(true)
    expect(set.has('b')).toBe(false)
    expect(set.has('c')).toBe(true)
    expect(set.has('d')).toBe(true)
  })
})
