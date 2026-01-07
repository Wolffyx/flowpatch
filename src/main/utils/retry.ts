/**
 * Retry Utilities
 *
 * Provides retry functionality with exponential backoff,
 * configurable policies, and error classification.
 */

import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_INITIAL_RETRY_DELAY_MS,
  DEFAULT_MAX_RETRY_DELAY_MS,
  DEFAULT_BACKOFF_MULTIPLIER
} from './constants'

// ============================================================================
// Types
// ============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number
  /** Initial delay before first retry (ms) */
  initialDelayMs?: number
  /** Maximum delay between retries (ms) */
  maxDelayMs?: number
  /** Backoff multiplier for exponential backoff */
  backoffMultiplier?: number
  /** Whether to add jitter to delay */
  jitter?: boolean
  /** Callback called before each retry */
  onRetry?: (error: Error, attempt: number, delay: number) => void
  /** Function to determine if an error is retryable */
  isRetryable?: (error: Error) => boolean
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

export interface RetryResult<T> {
  success: boolean
  result?: T
  error?: Error
  attempts: number
  totalDelayMs: number
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Common transient error patterns that should be retried.
 */
const TRANSIENT_ERROR_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /network error/i,
  /timeout/i,
  /rate limit/i,
  /too many requests/i,
  /503/,
  /502/,
  /504/,
  /429/,
  /temporarily unavailable/i,
  /service unavailable/i,
  /connection reset/i,
  /EAGAIN/i,
  /EBUSY/i
]

/**
 * Git-specific transient errors.
 */
const GIT_TRANSIENT_PATTERNS = [
  /could not lock/i,
  /unable to access/i,
  /Connection refused/i,
  /RPC failed/i,
  /SSL read/i,
  /failed to connect/i,
  /couldn't connect to server/i,
  /The remote end hung up unexpectedly/i
]

/**
 * Check if an error is transient and should be retried.
 */
export function isTransientError(error: Error): boolean {
  const message = error.message || String(error)

  // Check common patterns
  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (pattern.test(message)) return true
  }

  return false
}

/**
 * Check if a git error is transient.
 */
export function isTransientGitError(error: Error): boolean {
  if (isTransientError(error)) return true

  const message = error.message || String(error)

  for (const pattern of GIT_TRANSIENT_PATTERNS) {
    if (pattern.test(message)) return true
  }

  return false
}

/**
 * Check if an API error is transient.
 */
export function isTransientApiError(error: Error): boolean {
  if (isTransientError(error)) return true

  // Check for specific HTTP status codes
  const statusMatch = error.message.match(/status[:\s]+(\d{3})/i)
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10)
    // Retry on 429 (rate limit), 500, 502, 503, 504
    if (status === 429 || status >= 500) return true
  }

  return false
}

// ============================================================================
// Delay Calculation
// ============================================================================

/**
 * Calculate delay with exponential backoff.
 */
export function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitter = true
): number {
  // Exponential backoff: initial * multiplier^attempt
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1)

  // Cap at max delay
  let delay = Math.min(exponentialDelay, maxDelayMs)

  // Add jitter (0-25% of delay)
  if (jitter) {
    const jitterAmount = delay * 0.25 * Math.random()
    delay += jitterAmount
  }

  return Math.floor(delay)
}

/**
 * Sleep for a specified duration.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }

    const timeout = setTimeout(resolve, ms)

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new Error('Aborted'))
      },
      { once: true }
    )
  })
}

// ============================================================================
// Core Retry Functions
// ============================================================================

/**
 * Retry an async operation with exponential backoff.
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelayMs = DEFAULT_INITIAL_RETRY_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    jitter = true,
    onRetry,
    isRetryable = isTransientError,
    signal
  } = options

  let lastError: Error | undefined
  let totalDelayMs = 0

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    // Check for cancellation
    if (signal?.aborted) {
      return {
        success: false,
        error: new Error('Retry aborted'),
        attempts: attempt,
        totalDelayMs
      }
    }

    try {
      const result = await operation()
      return {
        success: true,
        result,
        attempts: attempt,
        totalDelayMs
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry if this is the last attempt
      if (attempt > maxRetries) {
        break
      }

      // Don't retry if error is not retryable
      if (!isRetryable(lastError)) {
        break
      }

      // Calculate delay
      const delay = calculateBackoffDelay(attempt, initialDelayMs, maxDelayMs, backoffMultiplier, jitter)
      totalDelayMs += delay

      // Call onRetry callback
      onRetry?.(lastError, attempt, delay)

      // Wait before retry
      try {
        await sleep(delay, signal)
      } catch {
        // Aborted during sleep
        return {
          success: false,
          error: new Error('Retry aborted during delay'),
          attempts: attempt,
          totalDelayMs
        }
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: maxRetries + 1,
    totalDelayMs
  }
}

/**
 * Retry an operation with git-specific error handling.
 */
export async function retryGitOperation<T>(
  operation: () => Promise<T>,
  options: Omit<RetryOptions, 'isRetryable'> = {}
): Promise<RetryResult<T>> {
  return retry(operation, {
    ...options,
    isRetryable: isTransientGitError
  })
}

/**
 * Retry an API operation.
 */
export async function retryApiOperation<T>(
  operation: () => Promise<T>,
  options: Omit<RetryOptions, 'isRetryable'> = {}
): Promise<RetryResult<T>> {
  return retry(operation, {
    ...options,
    isRetryable: isTransientApiError
  })
}

// ============================================================================
// Retry Decorator
// ============================================================================

/**
 * Create a retryable version of a function.
 */
export function withRetry<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options: RetryOptions = {}
): T {
  return (async (...args: Parameters<T>) => {
    const result = await retry(() => fn(...args), options)
    if (!result.success) {
      throw result.error || new Error('Operation failed after retries')
    }
    return result.result
  }) as T
}

// ============================================================================
// Circuit Breaker
// ============================================================================

export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit */
  failureThreshold: number
  /** Time in ms to wait before trying again after circuit opens */
  resetTimeout: number
  /** Number of successes needed to close circuit from half-open */
  successThreshold?: number
}

export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker for preventing repeated calls to failing services.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failures = 0
  private successes = 0
  private lastFailureTime = 0
  private readonly options: Required<CircuitBreakerOptions>

  constructor(options: CircuitBreakerOptions) {
    this.options = {
      failureThreshold: options.failureThreshold,
      resetTimeout: options.resetTimeout,
      successThreshold: options.successThreshold ?? 1
    }
  }

  /**
   * Get current circuit state.
   */
  getState(): CircuitState {
    this.updateState()
    return this.state
  }

  /**
   * Execute an operation through the circuit breaker.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.updateState()

    if (this.state === 'open') {
      throw new Error('Circuit breaker is open')
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  /**
   * Reset the circuit breaker to closed state.
   */
  reset(): void {
    this.state = 'closed'
    this.failures = 0
    this.successes = 0
    this.lastFailureTime = 0
  }

  private updateState(): void {
    if (this.state === 'open') {
      const now = Date.now()
      if (now - this.lastFailureTime >= this.options.resetTimeout) {
        this.state = 'half-open'
        this.successes = 0
      }
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successes++
      if (this.successes >= this.options.successThreshold) {
        this.state = 'closed'
        this.failures = 0
      }
    } else {
      this.failures = 0
    }
  }

  private onFailure(): void {
    this.failures++
    this.lastFailureTime = Date.now()

    if (this.state === 'half-open' || this.failures >= this.options.failureThreshold) {
      this.state = 'open'
    }
  }
}
