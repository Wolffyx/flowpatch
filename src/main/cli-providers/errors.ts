/**
 * Provider Error Classification
 *
 * Provides error classification for smart retry and fallback decisions.
 */

// ============================================================================
// Error Types
// ============================================================================

export type ErrorKind =
  | 'auth' // Invalid credentials
  | 'rate_limit' // Too many requests (retryable)
  | 'quota' // Usage limit reached
  | 'context' // Token/context limit exceeded
  | 'unavailable' // Service temporarily down (retryable)
  | 'network' // Connection issues (retryable)
  | 'timeout' // Execution timeout
  | 'canceled' // User canceled
  | 'unknown'

// ============================================================================
// Provider Error Class
// ============================================================================

/**
 * Structured error with classification for retry/fallback decisions.
 */
export class ProviderError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message: string,
    public readonly retryable: boolean = false,
    public readonly retryDelayMs?: number
  ) {
    super(message)
    this.name = 'ProviderError'
  }

  // Static factory methods for common error types
  static auth(message: string): ProviderError {
    return new ProviderError('auth', message, false)
  }

  static rateLimit(message: string, retryAfterMs?: number): ProviderError {
    return new ProviderError('rate_limit', message, true, retryAfterMs ?? 5000)
  }

  static quota(message: string): ProviderError {
    // Quota errors are retryable to allow provider fallback switching
    return new ProviderError('quota', message, true)
  }

  static context(message: string): ProviderError {
    return new ProviderError('context', message, false)
  }

  static unavailable(message: string): ProviderError {
    return new ProviderError('unavailable', message, true, 10000)
  }

  static network(message: string): ProviderError {
    return new ProviderError('network', message, true, 3000)
  }

  static timeout(message: string): ProviderError {
    return new ProviderError('timeout', message, false)
  }

  static canceled(): ProviderError {
    return new ProviderError('canceled', 'Execution canceled', false)
  }

  static unknown(message: string): ProviderError {
    return new ProviderError('unknown', message, false)
  }
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Patterns for detecting different error types.
 */
const ERROR_PATTERNS = {
  auth: [/unauthorized/i, /invalid.?api.?key/i, /authentication/i, /\b401\b/, /forbidden/i, /\b403\b/],

  rateLimit: [/rate.?limit/i, /too many requests/i, /\b429\b/, /throttl/i],

  quota: [
    /quota/i,
    /you've hit your limit/i,
    /you\u2019ve hit your limit/i,
    /billing/i,
    /credit/i,
    /insufficient/i,
    /usage.?limit/i
  ],

  context: [/context.?length/i, /max.?tokens/i, /token.?limit/i, /context.?window/i, /too.?long/i],

  unavailable: [/overloaded/i, /temporarily unavailable/i, /\b503\b/, /capacity/i, /service.?unavailable/i],

  network: [
    /network/i,
    /econnrefused/i,
    /socket/i,
    /etimedout/i,
    /econnreset/i,
    /enotfound/i,
    /connection.?reset/i
  ],

  timeout: [/timeout/i, /timed.?out/i, /deadline.?exceeded/i],

  canceled: [/cancel/i, /abort/i, /interrupt/i]
} as const

/**
 * Classify an error from provider output or exception.
 */
export function classifyError(error: unknown): ProviderError {
  // Handle ProviderError passthrough
  if (error instanceof ProviderError) {
    return error
  }

  const text = (error instanceof Error ? error.message : String(error)).toLowerCase()

  // Check auth patterns
  for (const pattern of ERROR_PATTERNS.auth) {
    if (pattern.test(text)) {
      return ProviderError.auth(String(error))
    }
  }

  // Check rate limit patterns
  for (const pattern of ERROR_PATTERNS.rateLimit) {
    if (pattern.test(text)) {
      const delay = extractRetryDelay(text)
      return ProviderError.rateLimit(String(error), delay)
    }
  }

  // Check quota patterns
  for (const pattern of ERROR_PATTERNS.quota) {
    if (pattern.test(text)) {
      return ProviderError.quota(String(error))
    }
  }

  // Check context patterns
  for (const pattern of ERROR_PATTERNS.context) {
    if (pattern.test(text)) {
      return ProviderError.context(String(error))
    }
  }

  // Check unavailable patterns
  for (const pattern of ERROR_PATTERNS.unavailable) {
    if (pattern.test(text)) {
      return ProviderError.unavailable(String(error))
    }
  }

  // Check network patterns
  for (const pattern of ERROR_PATTERNS.network) {
    if (pattern.test(text)) {
      return ProviderError.network(String(error))
    }
  }

  // Check timeout patterns
  for (const pattern of ERROR_PATTERNS.timeout) {
    if (pattern.test(text)) {
      return ProviderError.timeout(String(error))
    }
  }

  // Check canceled patterns
  for (const pattern of ERROR_PATTERNS.canceled) {
    if (pattern.test(text)) {
      return ProviderError.canceled()
    }
  }

  return ProviderError.unknown(String(error))
}

/**
 * Extract retry delay from error message.
 */
function extractRetryDelay(text: string): number | undefined {
  // Look for patterns like "retry after 30s" or "retry in 30 seconds"
  const match = text.match(/retry.{0,20}?(\d+)\s*(s|sec|second|ms|millisecond)?/i)
  if (!match) return undefined

  const value = parseInt(match[1], 10)
  const unit = match[2]?.toLowerCase()

  if (unit === 'ms' || unit === 'millisecond') {
    return value
  }

  // Default to seconds
  return value * 1000
}

// ============================================================================
// Type Guards
// ============================================================================

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.retryable
  }
  return classifyError(error).retryable
}

export function isAuthError(error: unknown): boolean {
  return classifyError(error).kind === 'auth'
}

export function isRateLimitError(error: unknown): boolean {
  return classifyError(error).kind === 'rate_limit'
}

export function isQuotaError(error: unknown): boolean {
  return classifyError(error).kind === 'quota'
}

export function isContextError(error: unknown): boolean {
  return classifyError(error).kind === 'context'
}
