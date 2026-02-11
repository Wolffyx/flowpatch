/**
 * Provider Metrics Collector
 *
 * Collects and aggregates execution metrics for providers.
 */

import { events } from './events'

// ============================================================================
// Types
// ============================================================================

export interface ProviderMetrics {
  executions: number
  successes: number
  failures: number
  totalTokens: number
  totalCostUsd: number
  totalDurationMs: number
  avgDurationMs: number
  avgTokensPerExec: number
  retryCount: number
  fallbackCount: number
}

interface ExecutionRecord {
  timestamp: number
  durationMs: number
  tokens: number
  costUsd: number
  success: boolean
}

// ============================================================================
// Provider Metrics Collector
// ============================================================================

/**
 * Collects and aggregates provider execution metrics.
 */
export class ProviderMetricsCollector {
  private records = new Map<string, ExecutionRecord[]>()
  private retries = new Map<string, number>()
  private fallbacks = new Map<string, number>()
  private maxRecordsPerProvider = 1000
  private eventUnsubscribe: (() => void) | null = null

  constructor() {
    // Listen to provider events
    this.eventUnsubscribe = events.onAny((event) => {
      switch (event.type) {
        case 'execution:complete': {
          const data = event.data as
            | { usage?: { input?: number; output?: number }; durationMs?: number }
            | undefined
          this.recordExecution(event.provider, {
            timestamp: event.timestamp,
            durationMs: data?.durationMs ?? 0,
            tokens: (data?.usage?.input ?? 0) + (data?.usage?.output ?? 0),
            costUsd: 0, // Calculated separately
            success: true
          })
          break
        }
        case 'execution:error':
          this.recordExecution(event.provider, {
            timestamp: event.timestamp,
            durationMs: 0,
            tokens: 0,
            costUsd: 0,
            success: false
          })
          break
        case 'execution:fallback': {
          const from = (event.data as { from?: string })?.from
          if (from) this.incrementFallback(from)
          break
        }
      }
    })
  }

  /**
   * Record an execution.
   */
  recordExecution(key: string, record: ExecutionRecord): void {
    if (!this.records.has(key)) {
      this.records.set(key, [])
    }
    const records = this.records.get(key)!
    records.push(record)

    // Prune old records
    if (records.length > this.maxRecordsPerProvider) {
      records.splice(0, records.length - this.maxRecordsPerProvider)
    }
  }

  /**
   * Record a retry attempt.
   */
  incrementRetry(key: string): void {
    this.retries.set(key, (this.retries.get(key) ?? 0) + 1)
  }

  /**
   * Record a fallback.
   */
  incrementFallback(key: string): void {
    this.fallbacks.set(key, (this.fallbacks.get(key) ?? 0) + 1)
  }

  /**
   * Get metrics for a provider.
   */
  getMetrics(key: string): ProviderMetrics {
    const records = this.records.get(key) ?? []
    const successes = records.filter((r) => r.success).length
    const failures = records.length - successes
    const totalDuration = records.reduce((sum, r) => sum + r.durationMs, 0)
    const totalTokens = records.reduce((sum, r) => sum + r.tokens, 0)
    const totalCost = records.reduce((sum, r) => sum + r.costUsd, 0)

    return {
      executions: records.length,
      successes,
      failures,
      totalTokens,
      totalCostUsd: totalCost,
      totalDurationMs: totalDuration,
      avgDurationMs: records.length > 0 ? totalDuration / records.length : 0,
      avgTokensPerExec: records.length > 0 ? totalTokens / records.length : 0,
      retryCount: this.retries.get(key) ?? 0,
      fallbackCount: this.fallbacks.get(key) ?? 0
    }
  }

  /**
   * Get metrics for all providers.
   */
  getAllMetrics(): Record<string, ProviderMetrics> {
    const result: Record<string, ProviderMetrics> = {}
    for (const key of this.records.keys()) {
      result[key] = this.getMetrics(key)
    }
    return result
  }

  /**
   * Get aggregated metrics across all providers.
   */
  getAggregatedMetrics(): ProviderMetrics {
    const all = this.getAllMetrics()
    const keys = Object.keys(all)

    if (keys.length === 0) {
      return {
        executions: 0,
        successes: 0,
        failures: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        avgTokensPerExec: 0,
        retryCount: 0,
        fallbackCount: 0
      }
    }

    const totals = keys.reduce(
      (acc, key) => {
        const m = all[key]
        acc.executions += m.executions
        acc.successes += m.successes
        acc.failures += m.failures
        acc.totalTokens += m.totalTokens
        acc.totalCostUsd += m.totalCostUsd
        acc.totalDurationMs += m.totalDurationMs
        acc.retryCount += m.retryCount
        acc.fallbackCount += m.fallbackCount
        return acc
      },
      {
        executions: 0,
        successes: 0,
        failures: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        totalDurationMs: 0,
        retryCount: 0,
        fallbackCount: 0
      }
    )

    return {
      ...totals,
      avgDurationMs: totals.executions > 0 ? totals.totalDurationMs / totals.executions : 0,
      avgTokensPerExec: totals.executions > 0 ? totals.totalTokens / totals.executions : 0
    }
  }

  /**
   * Get success rate for a provider.
   */
  getSuccessRate(key: string): number {
    const metrics = this.getMetrics(key)
    if (metrics.executions === 0) return 1
    return metrics.successes / metrics.executions
  }

  /**
   * Clear all metrics.
   */
  clear(): void {
    this.records.clear()
    this.retries.clear()
    this.fallbacks.clear()
  }

  /**
   * Dispose of the collector.
   */
  dispose(): void {
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe()
      this.eventUnsubscribe = null
    }
    this.clear()
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global provider metrics collector instance.
 */
export const metrics = new ProviderMetricsCollector()
