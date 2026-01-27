/**
 * Provider Rate Limiting
 *
 * Per-provider rate limiting and concurrency control.
 */

import { KeyedRateLimiter } from '../utils/rate-limiter'

// ============================================================================
// Types
// ============================================================================

export interface RateLimitConfig {
  maxConcurrent: number
  requestsPerSecond: number
  burstSize?: number
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: RateLimitConfig = {
  maxConcurrent: 5,
  requestsPerSecond: 2,
  burstSize: 5
}

/**
 * Provider-specific rate limits.
 */
const PROVIDER_LIMITS: Record<string, RateLimitConfig> = {
  claude: { maxConcurrent: 3, requestsPerSecond: 1, burstSize: 3 },
  codex: { maxConcurrent: 5, requestsPerSecond: 2, burstSize: 5 },
  opencode: { maxConcurrent: 3, requestsPerSecond: 1, burstSize: 3 }
}

// ============================================================================
// Provider Rate Limiter
// ============================================================================

/**
 * Manages rate limiting for provider execution.
 */
export class ProviderRateLimiter {
  private limiters: KeyedRateLimiter
  private inFlight = new Map<string, number>()
  private queues = new Map<string, Array<() => void>>()

  constructor() {
    this.limiters = new KeyedRateLimiter({
      maxTokens: DEFAULT_CONFIG.burstSize ?? DEFAULT_CONFIG.requestsPerSecond,
      refillRate: DEFAULT_CONFIG.requestsPerSecond
    })
  }

  /**
   * Acquire permission to execute a request.
   */
  async acquire(key: string): Promise<void> {
    const config = this.getConfig(key)
    const current = this.inFlight.get(key) ?? 0

    // Check concurrency limit
    if (current >= config.maxConcurrent) {
      await this.waitForSlot(key)
    }

    // Acquire rate limit token
    await this.limiters.consume(key)

    // Track in-flight
    this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1)
  }

  /**
   * Release a slot after execution completes.
   */
  release(key: string): void {
    const current = this.inFlight.get(key) ?? 0
    if (current > 0) {
      this.inFlight.set(key, current - 1)
    }

    // Wake up waiting requests
    const queue = this.queues.get(key)
    if (queue && queue.length > 0) {
      const resolve = queue.shift()!
      resolve()
    }
  }

  /**
   * Execute a function with rate limiting.
   */
  async withLimit<T>(key: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(key)
    try {
      return await fn()
    } finally {
      this.release(key)
    }
  }

  /**
   * Get current in-flight count for a provider.
   */
  getInFlight(key: string): number {
    return this.inFlight.get(key) ?? 0
  }

  /**
   * Get queue length for a provider.
   */
  getQueueLength(key: string): number {
    return this.queues.get(key)?.length ?? 0
  }

  /**
   * Get configuration for a provider.
   */
  getConfig(key: string): RateLimitConfig {
    return PROVIDER_LIMITS[key] ?? DEFAULT_CONFIG
  }

  /**
   * Set custom configuration for a provider.
   */
  setConfig(key: string, config: RateLimitConfig): void {
    PROVIDER_LIMITS[key] = config
  }

  /**
   * Check if a provider can accept more requests.
   */
  canAccept(key: string): boolean {
    const config = this.getConfig(key)
    const current = this.inFlight.get(key) ?? 0
    return current < config.maxConcurrent
  }

  private waitForSlot(key: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.queues.has(key)) {
        this.queues.set(key, [])
      }
      this.queues.get(key)!.push(resolve)
    })
  }

  /**
   * Clear all state.
   */
  clear(): void {
    this.inFlight.clear()
    this.queues.clear()
    this.limiters.clear()
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global provider rate limiter instance.
 */
export const rateLimiter = new ProviderRateLimiter()
