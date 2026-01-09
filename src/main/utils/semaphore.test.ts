/**
 * Unit tests for Semaphore implementations.
 */
import { describe, it, expect } from 'vitest'
import {
  Semaphore,
  Mutex,
  ReadWriteLock,
  KeyedSemaphore,
  BatchExecutor
} from './semaphore'

describe('Semaphore', () => {
  describe('basic operations', () => {
    it('should start with max permits available', () => {
      const sem = new Semaphore(5)
      expect(sem.available).toBe(5)
    })

    it('should acquire permits immediately when available', async () => {
      const sem = new Semaphore(5)
      await sem.acquire()
      expect(sem.available).toBe(4)
    })

    it('should release permits', async () => {
      const sem = new Semaphore(5)
      await sem.acquire()
      sem.release()
      expect(sem.available).toBe(5)
    })

    it('should not exceed max permits on release', () => {
      const sem = new Semaphore(5)
      sem.release() // Extra release
      expect(sem.available).toBe(5)
    })

    it('should tryAcquire successfully when permits available', () => {
      const sem = new Semaphore(2)
      expect(sem.tryAcquire()).toBe(true)
      expect(sem.tryAcquire()).toBe(true)
      expect(sem.tryAcquire()).toBe(false)
    })

    it('should report waiting count', async () => {
      const sem = new Semaphore(1)
      await sem.acquire() // Take the only permit

      // Start waiting acquires (they won't resolve until we release)
      sem.acquire() // Will wait
      sem.acquire() // Will wait

      expect(sem.waiting).toBe(2)

      // Release to let one through
      sem.release()
      expect(sem.waiting).toBe(1)
    })
  })

  describe('priority queue', () => {
    it('should serve higher priority waiters first', async () => {
      const sem = new Semaphore(1)
      const order: number[] = []

      await sem.acquire() // Take the permit

      // Queue up waiters with different priorities
      const p1 = sem.acquire(1).then(() => order.push(1))
      const p2 = sem.acquire(10).then(() => order.push(10))
      const p3 = sem.acquire(5).then(() => order.push(5))

      // Release permits one at a time
      sem.release()
      await Promise.resolve() // Let high priority through
      sem.release()
      await Promise.resolve() // Let medium priority through
      sem.release()
      await Promise.all([p1, p2, p3])

      expect(order).toEqual([10, 5, 1])
    })
  })

  describe('withPermit', () => {
    it('should execute function with automatic permit management', async () => {
      const sem = new Semaphore(1)

      const result = await sem.withPermit(async () => {
        expect(sem.available).toBe(0)
        return 'done'
      })

      expect(result).toBe('done')
      expect(sem.available).toBe(1)
    })

    it('should release permit on error', async () => {
      const sem = new Semaphore(1)

      await expect(
        sem.withPermit(async () => {
          throw new Error('test error')
        })
      ).rejects.toThrow('test error')

      expect(sem.available).toBe(1)
    })
  })

  describe('reset', () => {
    it('should restore all permits and resolve waiters', async () => {
      const sem = new Semaphore(2)

      await sem.acquire()
      await sem.acquire()

      // Queue a waiter
      const waiter = sem.acquire()

      sem.reset()

      await waiter // Should resolve immediately
      expect(sem.available).toBe(2) // Minus the resolved waiter
    })
  })
})

describe('Mutex', () => {
  it('should only allow one lock at a time', async () => {
    const mutex = new Mutex()

    await mutex.lock()
    expect(mutex.isLocked).toBe(true)
    expect(mutex.tryLock()).toBe(false)

    mutex.unlock()
    expect(mutex.isLocked).toBe(false)
    expect(mutex.tryLock()).toBe(true)
  })

  it('should execute function with exclusive access', async () => {
    const mutex = new Mutex()
    const order: string[] = []

    const task1 = mutex.withLock(async () => {
      order.push('task1-start')
      await new Promise((r) => setTimeout(r, 10))
      order.push('task1-end')
    })

    const task2 = mutex.withLock(async () => {
      order.push('task2-start')
      order.push('task2-end')
    })

    await Promise.all([task1, task2])

    // Task2 should only start after task1 completes
    expect(order.indexOf('task1-end')).toBeLessThan(order.indexOf('task2-start'))
  })
})

describe('ReadWriteLock', () => {
  describe('read locks', () => {
    it('should allow multiple readers', async () => {
      const rwLock = new ReadWriteLock()

      await rwLock.acquireRead()
      await rwLock.acquireRead()

      const state = rwLock.getState()
      expect(state.readers).toBe(2)
      expect(state.hasWriter).toBe(false)

      rwLock.releaseRead()
      rwLock.releaseRead()
    })
  })

  describe('write locks', () => {
    it('should only allow single writer', async () => {
      const rwLock = new ReadWriteLock()

      await rwLock.acquireWrite()

      const state = rwLock.getState()
      expect(state.hasWriter).toBe(true)
      expect(state.readers).toBe(0)

      rwLock.releaseWrite()
    })

    it('should block readers while writing', async () => {
      const rwLock = new ReadWriteLock()
      const order: string[] = []

      await rwLock.acquireWrite()
      order.push('write-start')

      // Queue a reader
      const reader = rwLock.acquireRead().then(() => {
        order.push('read')
        rwLock.releaseRead()
      })

      // Writer has lock, reader should be waiting
      expect(rwLock.getState().waitingReaders).toBe(1)

      rwLock.releaseWrite()
      order.push('write-end')

      await reader

      // Reader should execute after write completes
      expect(order).toEqual(['write-start', 'write-end', 'read'])
    })

    it('should block writers while reading', async () => {
      const rwLock = new ReadWriteLock()

      await rwLock.acquireRead()

      // Queue a writer
      rwLock.acquireWrite()
      expect(rwLock.getState().waitingWriters).toBe(1)

      rwLock.releaseRead()
    })
  })

  describe('withReadLock / withWriteLock', () => {
    it('should execute function with read lock', async () => {
      const rwLock = new ReadWriteLock()

      const result = await rwLock.withReadLock(async () => {
        expect(rwLock.getState().readers).toBe(1)
        return 'read-result'
      })

      expect(result).toBe('read-result')
      expect(rwLock.getState().readers).toBe(0)
    })

    it('should execute function with write lock', async () => {
      const rwLock = new ReadWriteLock()

      const result = await rwLock.withWriteLock(async () => {
        expect(rwLock.getState().hasWriter).toBe(true)
        return 'write-result'
      })

      expect(result).toBe('write-result')
      expect(rwLock.getState().hasWriter).toBe(false)
    })
  })
})

describe('KeyedSemaphore', () => {
  it('should maintain separate permits per key', async () => {
    const keySem = new KeyedSemaphore(2)

    // Key A
    await keySem.acquire('A')
    await keySem.acquire('A')
    expect(keySem.available('A')).toBe(0)

    // Key B should have its own permits
    expect(keySem.available('B')).toBe(2)
    await keySem.acquire('B')
    expect(keySem.available('B')).toBe(1)
  })

  it('should release permits for specific key', async () => {
    const keySem = new KeyedSemaphore(2)

    await keySem.acquire('A')
    await keySem.acquire('B')

    keySem.release('A')
    expect(keySem.available('A')).toBe(2)
    expect(keySem.available('B')).toBe(1)
  })

  it('should execute function with keyed permit', async () => {
    const keySem = new KeyedSemaphore(1)

    const result = await keySem.withPermit('testKey', async () => {
      expect(keySem.available('testKey')).toBe(0)
      return 'result'
    })

    expect(result).toBe('result')
    expect(keySem.available('testKey')).toBe(1)
  })

  it('should clear all semaphores', async () => {
    const keySem = new KeyedSemaphore(2)

    await keySem.acquire('A')
    await keySem.acquire('B')

    keySem.clear()

    // After clear, keys return default availability
    expect(keySem.available('A')).toBe(2)
    expect(keySem.available('B')).toBe(2)
  })
})

describe('BatchExecutor', () => {
  describe('map', () => {
    it('should execute function for each item with concurrency control', async () => {
      const executor = new BatchExecutor<number, number>(2, 5)
      const concurrent: number[] = []
      let maxConcurrent = 0

      const results = await executor.map([1, 2, 3, 4], async (item) => {
        concurrent.push(item)
        maxConcurrent = Math.max(maxConcurrent, concurrent.length)
        await new Promise((r) => setTimeout(r, 10))
        concurrent.pop()
        return item * 2
      })

      expect(results).toEqual([2, 4, 6, 8])
      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })
  })

  describe('batch', () => {
    it('should execute in batches', async () => {
      const executor = new BatchExecutor<number, number>(1, 3)
      const batches: number[][] = []

      const results = await executor.batch([1, 2, 3, 4, 5, 6, 7], async (batch) => {
        batches.push([...batch])
        return batch.map((x) => x * 2)
      })

      expect(results).toEqual([2, 4, 6, 8, 10, 12, 14])
      expect(batches).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7]
      ])
    })
  })
})
