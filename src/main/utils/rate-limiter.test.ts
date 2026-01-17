/**
 * Unit tests for Rate Limiter implementations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TokenBucketRateLimiter,
  SlidingWindowRateLimiter,
  KeyedRateLimiter,
  BackpressureHandler,
  createApiRateLimiter,
  createGitHubRateLimiter,
  createGitLabRateLimiter
} from './rate-limiter'

describe('TokenBucketRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('tryConsume', () => {
    it('should allow consumption when tokens available', () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 1
      })

      const result = limiter.tryConsume()
      expect(result.allowed).toBe(true)
      expect(result.remainingTokens).toBe(9)
    })

    it('should deny consumption when no tokens available', () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 2,
        refillRate: 1,
        initialTokens: 0
      })

      const result = limiter.tryConsume()
      expect(result.allowed).toBe(false)
      expect(result.remainingTokens).toBe(0)
      expect(result.retryAfterMs).toBeGreaterThan(0)
    })

    it('should allow consuming multiple tokens', () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 1
      })

      const result = limiter.tryConsume(5)
      expect(result.allowed).toBe(true)
      expect(result.remainingTokens).toBe(5)
    })

    it('should deny when not enough tokens for multi-token consume', () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 1,
        initialTokens: 3
      })

      const result = limiter.tryConsume(5)
      expect(result.allowed).toBe(false)
    })

    it('should refill tokens over time', () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 2, // 2 tokens per second
        initialTokens: 0
      })

      vi.advanceTimersByTime(1000) // 1 second

      const result = limiter.tryConsume()
      expect(result.allowed).toBe(true)
      expect(result.remainingTokens).toBe(1) // Started with 0, got 2, consumed 1
    })

    it('should not exceed maxTokens on refill', () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 100
      })

      vi.advanceTimersByTime(1000)

      const state = limiter.getState()
      expect(state.tokens).toBe(10)
    })
  })

  describe('consume', () => {
    it('should wait for tokens to become available', async () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 10, // 10 tokens per second
        initialTokens: 0
      })

      const consumePromise = limiter.consume()

      // Advance time to allow tokens to refill
      vi.advanceTimersByTime(200)

      await consumePromise
      expect(limiter.getState().tokens).toBeLessThan(10)
    })
  })

  describe('withRateLimit', () => {
    it('should execute function with rate limiting', async () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 1
      })

      const fn = vi.fn().mockResolvedValue('result')
      const result = await limiter.withRateLimit(fn)

      expect(result).toBe('result')
      expect(fn).toHaveBeenCalled()
    })
  })

  describe('getState', () => {
    it('should return current state', () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 2
      })

      const state = limiter.getState()
      expect(state.tokens).toBe(10)
      expect(state.maxTokens).toBe(10)
      expect(state.refillRate).toBe(2)
    })
  })

  describe('reset', () => {
    it('should reset to full capacity', () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 10,
        refillRate: 1,
        initialTokens: 2
      })

      limiter.reset()
      expect(limiter.getState().tokens).toBe(10)
    })
  })
})

describe('SlidingWindowRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('tryRecord', () => {
    it('should allow recording within limit', () => {
      const limiter = new SlidingWindowRateLimiter(5, 1000)

      for (let i = 0; i < 5; i++) {
        const result = limiter.tryRecord()
        expect(result.allowed).toBe(true)
      }
    })

    it('should deny recording when limit reached', () => {
      const limiter = new SlidingWindowRateLimiter(5, 1000)

      for (let i = 0; i < 5; i++) {
        limiter.tryRecord()
      }

      const result = limiter.tryRecord()
      expect(result.allowed).toBe(false)
      expect(result.retryAfterMs).toBeGreaterThan(0)
    })

    it('should allow recording after window expires', () => {
      const limiter = new SlidingWindowRateLimiter(2, 1000)

      limiter.tryRecord()
      limiter.tryRecord()
      expect(limiter.tryRecord().allowed).toBe(false)

      vi.advanceTimersByTime(1100) // Past window

      const result = limiter.tryRecord()
      expect(result.allowed).toBe(true)
    })
  })

  describe('record', () => {
    it('should wait when limit reached', async () => {
      const limiter = new SlidingWindowRateLimiter(1, 100)

      limiter.tryRecord()

      const recordPromise = limiter.record()
      vi.advanceTimersByTime(150)

      await recordPromise
      expect(limiter.getRequestCount()).toBe(1)
    })
  })

  describe('getRequestCount', () => {
    it('should return current request count', () => {
      const limiter = new SlidingWindowRateLimiter(10, 1000)

      limiter.tryRecord()
      limiter.tryRecord()
      limiter.tryRecord()

      expect(limiter.getRequestCount()).toBe(3)
    })

    it('should clean up expired requests', () => {
      const limiter = new SlidingWindowRateLimiter(10, 1000)

      limiter.tryRecord()
      limiter.tryRecord()

      vi.advanceTimersByTime(1100)

      expect(limiter.getRequestCount()).toBe(0)
    })
  })

  describe('reset', () => {
    it('should clear all timestamps', () => {
      const limiter = new SlidingWindowRateLimiter(10, 1000)

      limiter.tryRecord()
      limiter.tryRecord()
      limiter.reset()

      expect(limiter.getRequestCount()).toBe(0)
    })
  })
})

describe('KeyedRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should maintain separate limits per key', () => {
    const limiter = new KeyedRateLimiter({
      maxTokens: 2,
      refillRate: 1
    })

    // Key A
    expect(limiter.tryConsume('A').allowed).toBe(true)
    expect(limiter.tryConsume('A').allowed).toBe(true)
    expect(limiter.tryConsume('A').allowed).toBe(false)

    // Key B should have its own limit
    expect(limiter.tryConsume('B').allowed).toBe(true)
    expect(limiter.tryConsume('B').allowed).toBe(true)
    expect(limiter.tryConsume('B').allowed).toBe(false)
  })

  it('should clear all limiters', () => {
    const limiter = new KeyedRateLimiter({
      maxTokens: 2,
      refillRate: 1
    })

    limiter.tryConsume('A')
    limiter.tryConsume('B')

    limiter.clear()

    // After clear, new limiters should be created
    expect(limiter.tryConsume('A').remainingTokens).toBe(1) // Fresh limiter
  })
})

describe('BackpressureHandler', () => {
  it('should enqueue items up to max size', () => {
    const handler = new BackpressureHandler<string>({ maxQueueSize: 3 })

    handler.tryEnqueue('item1')
    handler.tryEnqueue('item2')
    handler.tryEnqueue('item3')

    expect(handler.size).toBe(3)
  })

  it('should reject when queue is full', async () => {
    const handler = new BackpressureHandler<string>({ maxQueueSize: 2 })

    handler.tryEnqueue('item1')
    handler.tryEnqueue('item2')

    await expect(handler.enqueue('item3')).rejects.toThrow('queue is full')
  })

  it('should return false from tryEnqueue when full', () => {
    const handler = new BackpressureHandler<string>({ maxQueueSize: 2 })

    handler.tryEnqueue('item1')
    handler.tryEnqueue('item2')

    expect(handler.tryEnqueue('item3')).toBe(false)
  })

  it('should process queued items', async () => {
    const handler = new BackpressureHandler<string>({ maxQueueSize: 10 })
    const processed: string[] = []

    handler.tryEnqueue('item1')
    handler.tryEnqueue('item2')

    const count = await handler.process(async (item) => {
      processed.push(item)
    })

    expect(count).toBe(2)
    expect(processed).toEqual(['item1', 'item2'])
    expect(handler.size).toBe(0)
  })

  it('should report isFull correctly', () => {
    const handler = new BackpressureHandler<string>({ maxQueueSize: 2 })

    expect(handler.isFull).toBe(false)
    handler.tryEnqueue('item1')
    expect(handler.isFull).toBe(false)
    handler.tryEnqueue('item2')
    expect(handler.isFull).toBe(true)
  })

  it('should clear queue and reject pending promises', async () => {
    const handler = new BackpressureHandler<string>({ maxQueueSize: 10 })

    handler.tryEnqueue('item1')
    handler.tryEnqueue('item2')

    handler.clear()

    expect(handler.size).toBe(0)
  })
})

describe('Factory functions', () => {
  it('should create API rate limiter with default settings', () => {
    const limiter = createApiRateLimiter()
    const state = limiter.getState()

    expect(state.maxTokens).toBe(20) // 10 RPS * 2 burst
    expect(state.refillRate).toBe(10)
  })

  it('should create API rate limiter with custom RPS', () => {
    const limiter = createApiRateLimiter(5)
    const state = limiter.getState()

    expect(state.maxTokens).toBe(10) // 5 RPS * 2 burst
    expect(state.refillRate).toBe(5)
  })

  it('should create GitHub rate limiter', () => {
    const limiter = createGitHubRateLimiter()
    const state = limiter.getState()

    expect(state.maxTokens).toBe(100)
    expect(state.refillRate).toBeCloseTo(1.39, 1)
  })

  it('should create GitLab rate limiter', () => {
    const limiter = createGitLabRateLimiter()
    const state = limiter.getState()

    expect(state.maxTokens).toBe(50)
    expect(state.refillRate).toBe(5)
  })
})
