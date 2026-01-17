/**
 * Structured Error Classes
 *
 * Provides structured error classes with context and error aggregation.
 */

import { MAX_ERROR_AGGREGATION_ENTRIES } from './constants'

// ============================================================================
// Base Error Classes
// ============================================================================

/**
 * Base error class with context.
 */
export class FlowPatchError extends Error {
  public readonly code: string
  public readonly context: Record<string, unknown>
  public readonly timestamp: number
  public readonly cause?: Error

  constructor(
    message: string,
    code: string,
    context: Record<string, unknown> = {},
    cause?: Error
  ) {
    super(message)
    this.name = 'FlowPatchError'
    this.code = code
    this.context = context
    this.timestamp = Date.now()
    this.cause = cause

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Convert to JSON for logging/serialization.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
      cause: this.cause ? {
        name: this.cause.name,
        message: this.cause.message,
        stack: this.cause.stack
      } : undefined
    }
  }
}

// ============================================================================
// Specialized Error Classes
// ============================================================================

/**
 * Worker-related errors.
 */
export class WorkerError extends FlowPatchError {
  constructor(message: string, code: string, context: Record<string, unknown> = {}, cause?: Error) {
    super(message, `WORKER_${code}`, context, cause)
    this.name = 'WorkerError'
  }
}

/**
 * Pipeline errors.
 */
export class PipelineError extends FlowPatchError {
  public readonly phase: string

  constructor(
    message: string,
    phase: string,
    context: Record<string, unknown> = {},
    cause?: Error
  ) {
    super(message, `PIPELINE_${phase.toUpperCase()}`, { phase, ...context }, cause)
    this.name = 'PipelineError'
    this.phase = phase
  }
}

/**
 * Git operation errors.
 */
export class GitError extends FlowPatchError {
  public readonly command: string
  public readonly exitCode?: number

  constructor(
    message: string,
    command: string,
    exitCode?: number,
    context: Record<string, unknown> = {},
    cause?: Error
  ) {
    super(message, 'GIT_ERROR', { command, exitCode, ...context }, cause)
    this.name = 'GitError'
    this.command = command
    this.exitCode = exitCode
  }
}

/**
 * API errors.
 */
export class ApiError extends FlowPatchError {
  public readonly provider: string
  public readonly status?: number
  public readonly endpoint?: string

  constructor(
    message: string,
    provider: string,
    status?: number,
    endpoint?: string,
    context: Record<string, unknown> = {},
    cause?: Error
  ) {
    super(message, `API_${provider.toUpperCase()}_${status || 'ERROR'}`, { provider, status, endpoint, ...context }, cause)
    this.name = 'ApiError'
    this.provider = provider
    this.status = status
    this.endpoint = endpoint
  }

  /**
   * Check if this is a rate limit error.
   */
  get isRateLimited(): boolean {
    return this.status === 429
  }

  /**
   * Check if this is a transient error that can be retried.
   */
  get isTransient(): boolean {
    if (!this.status) return false
    return this.status === 429 || (this.status >= 500 && this.status < 600)
  }
}

/**
 * Security errors.
 */
export class SecurityError extends FlowPatchError {
  public readonly action: string

  constructor(
    message: string,
    action: string,
    context: Record<string, unknown> = {},
    cause?: Error
  ) {
    super(message, `SECURITY_${action.toUpperCase()}`, { action, ...context }, cause)
    this.name = 'SecurityError'
    this.action = action
  }
}

/**
 * Validation errors.
 */
export class ValidationError extends FlowPatchError {
  public readonly field?: string
  public readonly value?: unknown

  constructor(
    message: string,
    field?: string,
    value?: unknown,
    context: Record<string, unknown> = {},
    cause?: Error
  ) {
    super(message, 'VALIDATION_ERROR', { field, value, ...context }, cause)
    this.name = 'ValidationError'
    this.field = field
    this.value = value
  }
}

/**
 * Configuration errors.
 */
export class ConfigError extends FlowPatchError {
  public readonly key: string

  constructor(
    message: string,
    key: string,
    context: Record<string, unknown> = {},
    cause?: Error
  ) {
    super(message, 'CONFIG_ERROR', { key, ...context }, cause)
    this.name = 'ConfigError'
    this.key = key
  }
}

/**
 * Timeout errors.
 */
export class TimeoutError extends FlowPatchError {
  public readonly timeoutMs: number
  public readonly operation: string

  constructor(
    operation: string,
    timeoutMs: number,
    context: Record<string, unknown> = {},
    cause?: Error
  ) {
    super(`${operation} timed out after ${timeoutMs}ms`, 'TIMEOUT', { operation, timeoutMs, ...context }, cause)
    this.name = 'TimeoutError'
    this.operation = operation
    this.timeoutMs = timeoutMs
  }
}

/**
 * Cancellation errors.
 */
export class CancellationError extends FlowPatchError {
  public readonly reason?: string

  constructor(reason?: string, context: Record<string, unknown> = {}) {
    super(reason || 'Operation was canceled', 'CANCELED', { reason, ...context })
    this.name = 'CancellationError'
    this.reason = reason
  }
}

/**
 * Resource errors.
 */
export class ResourceError extends FlowPatchError {
  public readonly resourceType: string
  public readonly resourceId?: string

  constructor(
    message: string,
    resourceType: string,
    resourceId?: string,
    context: Record<string, unknown> = {},
    cause?: Error
  ) {
    super(message, `RESOURCE_${resourceType.toUpperCase()}`, { resourceType, resourceId, ...context }, cause)
    this.name = 'ResourceError'
    this.resourceType = resourceType
    this.resourceId = resourceId
  }
}

// ============================================================================
// Error Aggregation
// ============================================================================

interface AggregatedError {
  code: string
  message: string
  count: number
  firstSeen: number
  lastSeen: number
  sampleContext?: Record<string, unknown>
}

/**
 * Error aggregator to reduce log noise.
 */
class ErrorAggregatorClass {
  private errors = new Map<string, AggregatedError>()
  private readonly maxEntries: number

  constructor(maxEntries = MAX_ERROR_AGGREGATION_ENTRIES) {
    this.maxEntries = maxEntries
  }

  /**
   * Record an error.
   * Returns true if this is a new error, false if aggregated.
   */
  record(error: FlowPatchError): boolean {
    const key = `${error.code}:${error.message}`

    const existing = this.errors.get(key)
    if (existing) {
      existing.count++
      existing.lastSeen = Date.now()
      return false
    }

    // Evict oldest if at capacity
    if (this.errors.size >= this.maxEntries) {
      let oldestKey: string | null = null
      let oldestTime = Infinity

      for (const [k, v] of this.errors) {
        if (v.lastSeen < oldestTime) {
          oldestTime = v.lastSeen
          oldestKey = k
        }
      }

      if (oldestKey) {
        this.errors.delete(oldestKey)
      }
    }

    this.errors.set(key, {
      code: error.code,
      message: error.message,
      count: 1,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      sampleContext: error.context
    })

    return true
  }

  /**
   * Get aggregated error summary.
   */
  getSummary(): AggregatedError[] {
    return Array.from(this.errors.values())
      .sort((a, b) => b.count - a.count)
  }

  /**
   * Get errors that have occurred more than threshold times.
   */
  getFrequent(threshold = 5): AggregatedError[] {
    return this.getSummary().filter((e) => e.count >= threshold)
  }

  /**
   * Clear aggregated errors.
   */
  clear(): void {
    this.errors.clear()
  }

  /**
   * Get total error count.
   */
  get totalCount(): number {
    let sum = 0
    for (const e of this.errors.values()) {
      sum += e.count
    }
    return sum
  }

  /**
   * Get unique error count.
   */
  get uniqueCount(): number {
    return this.errors.size
  }
}

export const ErrorAggregator = new ErrorAggregatorClass()

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Wrap an error with additional context.
 */
export function wrapError(
  error: unknown,
  message: string,
  context: Record<string, unknown> = {}
): FlowPatchError {
  const cause = error instanceof Error ? error : new Error(String(error))

  return new FlowPatchError(
    `${message}: ${cause.message}`,
    'WRAPPED_ERROR',
    context,
    cause
  )
}

/**
 * Extract error message safely.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

/**
 * Check if an error is a specific type.
 */
export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof FlowPatchError && error.code === code
}

/**
 * Log an error with aggregation.
 * Only logs if it's a new error or aggregation is disabled.
 */
export function logError(
  error: unknown,
  context?: Record<string, unknown>,
  aggregate = true
): void {
  const flowpatchError = error instanceof FlowPatchError
    ? error
    : new FlowPatchError(
        getErrorMessage(error),
        'UNKNOWN_ERROR',
        context,
        error instanceof Error ? error : undefined
      )

  if (aggregate) {
    const isNew = ErrorAggregator.record(flowpatchError)
    if (!isNew) {
      // Don't log repeated errors, but still return
      return
    }
  }

  console.error(`[${flowpatchError.code}] ${flowpatchError.message}`, flowpatchError.toJSON())
}

/**
 * Create an error handler that wraps errors with context.
 */
export function createErrorHandler<T>(
  operation: string,
  context: Record<string, unknown> = {}
): (fn: () => Promise<T>) => Promise<T> {
  return async (fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (error) {
      throw wrapError(error, `Failed during ${operation}`, context)
    }
  }
}
