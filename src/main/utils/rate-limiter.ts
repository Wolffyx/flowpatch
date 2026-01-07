/**
 * Rate Limiter Implementation
 *
 * Provides rate limiting for API calls and operations.
 * Implements token bucket algorithm with optional backpressure.
 */

import { DEFAULT_RATE_LIMIT_RPS } from './constants'

// ============================================================================
// Types
// ============================================================================

export interface RateLimiterOptions {
  /** Maximum tokens (burst capacity) */
  maxTokens: number
  /** Token refill rate (tokens per second) */
  refillRate: number
  /** Initial tokens (defaults to maxTokens) */
  initialTokens?: number
}

export interface RateLimitResult {
  allowed: boolean
  remainingTokens: number
  retryAfterMs?: number
}

// ============================================================================
// Token Bucket Rate Limiter
// ============================================================================

/**
 * Token bucket rate limiter.
 * Allows burst traffic up to maxTokens, then limits to refillRate tokens/second.
 */
export class TokenBucketRateLimiter {
  private tokens: number
  private readonly maxTokens: number
  private readonly refillRate: number // tokens per second
  private lastRefillTime: number

  constructor(options: RateLimiterOptions) {
    this.maxTokens = options.maxTokens
    this.refillRate = options.refillRate
    this.tokens = options.initialTokens ?? options.maxTokens
    this.lastRefillTime = Date.now()
  }

  /**
   * Refill tokens based on elapsed time.
   */
  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefillTime) / 1000 // seconds
    const tokensToAdd = elapsed * this.refillRate

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd)
    this.lastRefillTime = now
  }

  /**
   * Try to consume a token.
   */
  tryConsume(tokens = 1): RateLimitResult {
    this.refill()

    if (this.tokens >= tokens) {
      this.tokens -= tokens
      return {
        allowed: true,
        remainingTokens: Math.floor(this.tokens)
      }
    }

    // Calculate retry after
    const tokensNeeded = tokens - this.tokens
    const retryAfterMs = Math.ceil((tokensNeeded / this.refillRate) * 1000)

    return {
      allowed: false,
      remainingTokens: Math.floor(this.tokens),
      retryAfterMs
    }
  }

  /**
   * Wait and consume tokens.
   */
  async consume(tokens = 1): Promise<void> {
    const result = this.tryConsume(tokens)

    if (result.allowed) {
      return
    }

    // Wait for tokens to become available
    await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs))

    // Retry
    return this.consume(tokens)
  }

  /**
   * Execute a function with rate limiting.
   */
  async withRateLimit<T>(fn: () => Promise<T>, tokens = 1): Promise<T> {
    await this.consume(tokens)
    return fn()
  }

  /**
   * Get current state.
   */
  getState(): {
    tokens: number
    maxTokens: number
    refillRate: number
  } {
    this.refill()
    return {
      tokens: Math.floor(this.tokens),
      maxTokens: this.maxTokens,
      refillRate: this.refillRate
    }
  }

  /**
   * Reset to full capacity.
   */
  reset(): void {
    this.tokens = this.maxTokens
    this.lastRefillTime = Date.now()
  }
}

// ============================================================================
// Sliding Window Rate Limiter
// ============================================================================

/**
 * Sliding window rate limiter.
 * Limits requests to a maximum count within a time window.
 */
export class SlidingWindowRateLimiter {
  private timestamps: number[] = []
  private readonly maxRequests: number
  private readonly windowMs: number

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }

  /**
   * Clean up old timestamps outside the window.
   */
  private cleanup(): void {
    const now = Date.now()
    const cutoff = now - this.windowMs
    this.timestamps = this.timestamps.filter((ts) => ts > cutoff)
  }

  /**
   * Try to record a request.
   */
  tryRecord(): RateLimitResult {
    this.cleanup()

    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(Date.now())
      return {
        allowed: true,
        remainingTokens: this.maxRequests - this.timestamps.length
      }
    }

    // Calculate when the oldest request will expire
    const oldestTimestamp = this.timestamps[0]
    const retryAfterMs = oldestTimestamp + this.windowMs - Date.now()

    return {
      allowed: false,
      remainingTokens: 0,
      retryAfterMs: Math.max(0, retryAfterMs)
    }
  }

  /**
   * Wait and record a request.
   */
  async record(): Promise<void> {
    const result = this.tryRecord()

    if (result.allowed) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs))
    return this.record()
  }

  /**
   * Execute with rate limiting.
   */
  async withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    await this.record()
    return fn()
  }

  /**
   * Get current request count.
   */
  getRequestCount(): number {
    this.cleanup()
    return this.timestamps.length
  }

  /**
   * Reset the rate limiter.
   */
  reset(): void {
    this.timestamps = []
  }
}

// ============================================================================
// Keyed Rate Limiter
// ============================================================================

/**
 * Rate limiter that maintains separate limits per key.
 */
export class KeyedRateLimiter {
  private limiters = new Map<string, TokenBucketRateLimiter>()
  private readonly options: RateLimiterOptions

  constructor(options: RateLimiterOptions) {
    this.options = options
  }

  /**
   * Get or create rate limiter for a key.
   */
  private getLimiter(key: string): TokenBucketRateLimiter {
    let limiter = this.limiters.get(key)
    if (!limiter) {
      limiter = new TokenBucketRateLimiter(this.options)
      this.limiters.set(key, limiter)
    }
    return limiter
  }

  /**
   * Try to consume tokens for a key.
   */
  tryConsume(key: string, tokens = 1): RateLimitResult {
    return this.getLimiter(key).tryConsume(tokens)
  }

  /**
   * Wait and consume tokens for a key.
   */
  async consume(key: string, tokens = 1): Promise<void> {
    return this.getLimiter(key).consume(tokens)
  }

  /**
   * Execute with rate limiting for a key.
   */
  async withRateLimit<T>(key: string, fn: () => Promise<T>, tokens = 1): Promise<T> {
    return this.getLimiter(key).withRateLimit(fn, tokens)
  }

  /**
   * Clear all limiters.
   */
  clear(): void {
    this.limiters.clear()
  }
}

// ============================================================================
// Backpressure Handler
// ============================================================================

export interface BackpressureOptions {
  /** Maximum queue size before rejecting */
  maxQueueSize: number
  /** Timeout for queue wait (ms) */
  timeoutMs?: number
}

/**
 * Backpressure handler for managing overload scenarios.
 */
export class BackpressureHandler<T> {
  private queue: Array<{
    item: T
    resolve: (value: void) => void
    reject: (error: Error) => void
    timestamp: number
  }> = []
  private processing = false
  private readonly maxQueueSize: number
  private readonly timeoutMs: number | null

  constructor(options: BackpressureOptions) {
    this.maxQueueSize = options.maxQueueSize
    this.timeoutMs = options.timeoutMs ?? null
  }

  /**
   * Add an item to the queue.
   * Throws if queue is full.
   */
  async enqueue(item: T): Promise<void> {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error('Backpressure: queue is full')
    }

    return new Promise<void>((resolve, reject) => {
      this.queue.push({
        item,
        resolve,
        reject,
        timestamp: Date.now()
      })

      // Set timeout if configured
      if (this.timeoutMs !== null) {
        setTimeout(() => {
          const index = this.queue.findIndex((q) => q.item === item)
          if (index !== -1) {
            const entry = this.queue.splice(index, 1)[0]
            entry.reject(new Error('Backpressure: timeout waiting in queue'))
          }
        }, this.timeoutMs)
      }
    })
  }

  /**
   * Try to enqueue without throwing.
   */
  tryEnqueue(item: T): boolean {
    if (this.queue.length >= this.maxQueueSize) {
      return false
    }

    this.queue.push({
      item,
      resolve: () => {},
      reject: () => {},
      timestamp: Date.now()
    })
    return true
  }

  /**
   * Dequeue and process items.
   */
  async process(processor: (item: T) => Promise<void>): Promise<number> {
    if (this.processing) {
      return 0
    }

    this.processing = true
    let processed = 0

    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift()!

        try {
          await processor(entry.item)
          entry.resolve()
          processed++
        } catch (error) {
          entry.reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    } finally {
      this.processing = false
    }

    return processed
  }

  /**
   * Get queue size.
   */
  get size(): number {
    return this.queue.length
  }

  /**
   * Check if queue is full.
   */
  get isFull(): boolean {
    return this.queue.length >= this.maxQueueSize
  }

  /**
   * Clear the queue.
   */
  clear(): void {
    for (const entry of this.queue) {
      entry.reject(new Error('Backpressure: queue cleared'))
    }
    this.queue = []
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a rate limiter for API calls.
 */
export function createApiRateLimiter(requestsPerSecond = DEFAULT_RATE_LIMIT_RPS): TokenBucketRateLimiter {
  return new TokenBucketRateLimiter({
    maxTokens: requestsPerSecond * 2, // Allow burst of 2x normal rate
    refillRate: requestsPerSecond
  })
}

/**
 * Create a rate limiter for GitHub API.
 * GitHub allows 5000 requests per hour for authenticated users.
 */
export function createGitHubRateLimiter(): TokenBucketRateLimiter {
  // 5000 requests / 3600 seconds = ~1.39 requests/second
  return new TokenBucketRateLimiter({
    maxTokens: 100, // Allow burst of 100 requests
    refillRate: 1.39
  })
}

/**
 * Create a rate limiter for GitLab API.
 * GitLab allows 300 requests per minute.
 */
export function createGitLabRateLimiter(): TokenBucketRateLimiter {
  // 300 requests / 60 seconds = 5 requests/second
  return new TokenBucketRateLimiter({
    maxTokens: 50, // Allow burst of 50 requests
    refillRate: 5
  })
}
