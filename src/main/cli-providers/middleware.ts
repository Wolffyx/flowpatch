/**
 * Execution Middleware Pipeline
 *
 * Middleware for intercepting and modifying provider execution.
 */

import type { CLIExecutionOptions, CLIExecutionResult } from './types'
import type { ProviderMessage } from './messages'
import type { ProviderError } from './errors'
import { healthMonitor } from './health'
import { rateLimiter } from './rate-limiting'

// ============================================================================
// Types
// ============================================================================

/**
 * Middleware interface for intercepting provider execution.
 */
export interface ProviderMiddleware {
  name: string

  /** Called before execution starts */
  before?(options: CLIExecutionOptions): Promise<CLIExecutionOptions | void>

  /** Called for each streamed message */
  onMessage?(message: ProviderMessage): Promise<ProviderMessage | void>

  /** Called after successful execution */
  after?(result: CLIExecutionResult): Promise<CLIExecutionResult | void>

  /** Called on execution error */
  onError?(error: ProviderError, options: CLIExecutionOptions): Promise<void>
}

// ============================================================================
// Middleware Pipeline
// ============================================================================

/**
 * Manages and executes middleware pipeline.
 */
export class MiddlewarePipeline {
  private middleware: ProviderMiddleware[] = []

  /**
   * Add middleware to the pipeline.
   */
  use(mw: ProviderMiddleware): this {
    this.middleware.push(mw)
    return this
  }

  /**
   * Remove middleware by name.
   */
  remove(name: string): boolean {
    const idx = this.middleware.findIndex((m) => m.name === name)
    if (idx >= 0) {
      this.middleware.splice(idx, 1)
      return true
    }
    return false
  }

  /**
   * Run before hooks.
   */
  async runBefore(options: CLIExecutionOptions): Promise<CLIExecutionOptions> {
    let current = options
    for (const mw of this.middleware) {
      if (mw.before) {
        try {
          const result = await mw.before(current)
          if (result) current = result
        } catch (error) {
          console.error(`[Middleware:${mw.name}] before error:`, error)
        }
      }
    }
    return current
  }

  /**
   * Run message hooks.
   */
  async runOnMessage(message: ProviderMessage): Promise<ProviderMessage> {
    let current = message
    for (const mw of this.middleware) {
      if (mw.onMessage) {
        try {
          const result = await mw.onMessage(current)
          if (result) current = result
        } catch (error) {
          console.error(`[Middleware:${mw.name}] onMessage error:`, error)
        }
      }
    }
    return current
  }

  /**
   * Run after hooks.
   */
  async runAfter(result: CLIExecutionResult): Promise<CLIExecutionResult> {
    let current = result
    for (const mw of this.middleware) {
      if (mw.after) {
        try {
          const modified = await mw.after(current)
          if (modified) current = modified
        } catch (error) {
          console.error(`[Middleware:${mw.name}] after error:`, error)
        }
      }
    }
    return current
  }

  /**
   * Run error hooks.
   */
  async runOnError(error: ProviderError, options: CLIExecutionOptions): Promise<void> {
    for (const mw of this.middleware) {
      if (mw.onError) {
        try {
          await mw.onError(error, options)
        } catch (e) {
          console.error(`[Middleware:${mw.name}] onError error:`, e)
        }
      }
    }
  }

  /**
   * Get registered middleware names.
   */
  getNames(): string[] {
    return this.middleware.map((m) => m.name)
  }

  /**
   * Check if middleware is registered.
   */
  has(name: string): boolean {
    return this.middleware.some((m) => m.name === name)
  }

  /**
   * Get middleware count.
   */
  get count(): number {
    return this.middleware.length
  }

  /**
   * Clear all middleware.
   */
  clear(): void {
    this.middleware = []
  }
}

// ============================================================================
// Built-in Middleware
// ============================================================================

/**
 * Logging middleware - logs execution start/end.
 */
export const loggingMiddleware: ProviderMiddleware = {
  name: 'logging',

  async before(options) {
    const log = options.log ?? console.log
    log('[Provider] Starting execution...')
  },

  async after(result) {
    console.log(`[Provider] Completed in ${result.durationMs}ms, ${result.outputTokens} tokens`)
  },

  async onError(error) {
    console.error(`[Provider] Error: ${error.kind} - ${error.message}`)
  }
}

/**
 * Metrics middleware - collects execution metrics.
 */
export const metricsMiddleware: ProviderMiddleware = {
  name: 'metrics',

  async after(_result) {
    // Metrics are collected via events, but we can add additional tracking here
  }
}

/**
 * Create rate limiting middleware for a provider.
 */
export function createRateLimitMiddleware(providerKey: string): ProviderMiddleware {
  return {
    name: 'rate-limit',

    async before(_options) {
      await rateLimiter.acquire(providerKey)
    },

    async after(_result) {
      rateLimiter.release(providerKey)
    },

    async onError(_error) {
      rateLimiter.release(providerKey)
    }
  }
}

/**
 * Create health check middleware for a provider.
 */
export function createHealthMiddleware(providerKey: string): ProviderMiddleware {
  return {
    name: 'health',

    async after(result) {
      healthMonitor.recordSuccess(providerKey, result.durationMs)
    },

    async onError(_error) {
      healthMonitor.recordFailure(providerKey)
    }
  }
}

/**
 * Create a timing middleware that tracks execution duration.
 */
export function createTimingMiddleware(
  onComplete: (durationMs: number) => void
): ProviderMiddleware {
  let startTime = 0

  return {
    name: 'timing',

    async before(_options) {
      startTime = Date.now()
    },

    async after(_result) {
      const durationMs = Date.now() - startTime
      onComplete(durationMs)
    }
  }
}

// ============================================================================
// Global Middleware Pipeline
// ============================================================================

/**
 * Global middleware pipeline instance.
 */
export const globalMiddleware = new MiddlewarePipeline()
