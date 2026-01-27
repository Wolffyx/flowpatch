/**
 * Provider Health Monitor
 *
 * Tracks provider health with circuit breaker integration.
 */

import { CircuitBreaker, type CircuitBreakerOptions, type CircuitState } from '../utils/retry'
import { events } from './events'
import type { ICLIProvider } from './types'

// ============================================================================
// Types
// ============================================================================

export interface HealthStatus {
  available: boolean
  lastCheck: number
  consecutiveFailures: number
  latencyP50: number
  latencyP95: number
  successRate: number
  circuitState: CircuitState
}

interface LatencySample {
  duration: number
  timestamp: number
}

// ============================================================================
// Provider Health Tracker
// ============================================================================

/**
 * Tracks health metrics for a single provider.
 */
class ProviderHealth {
  private samples: LatencySample[] = []
  private failures = 0
  private successes = 0
  private lastCheck = 0
  private circuitBreaker: CircuitBreaker

  constructor(
    _key: string,
    config?: Partial<CircuitBreakerOptions>
  ) {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeout: config?.resetTimeout ?? 30000,
      successThreshold: config?.successThreshold ?? 2
    })
  }

  recordSuccess(durationMs: number): void {
    this.successes++
    this.failures = 0
    this.samples.push({ duration: durationMs, timestamp: Date.now() })
    this.pruneOldSamples()
    // Note: CircuitBreaker doesn't have recordSuccess, it's tracked via execute
    this.lastCheck = Date.now()
  }

  recordFailure(): void {
    this.failures++
    this.lastCheck = Date.now()
  }

  isHealthy(): boolean {
    // Check circuit state
    const state = this.circuitBreaker.getState()
    if (state === 'open') return false

    // Also check consecutive failures
    return this.failures < 5
  }

  getStatus(): HealthStatus {
    const total = this.successes + this.failures
    return {
      available: this.isHealthy(),
      lastCheck: this.lastCheck,
      consecutiveFailures: this.failures,
      latencyP50: this.getPercentile(50),
      latencyP95: this.getPercentile(95),
      successRate: total > 0 ? this.successes / total : 1,
      circuitState: this.circuitBreaker.getState()
    }
  }

  reset(): void {
    this.samples = []
    this.failures = 0
    this.successes = 0
    this.lastCheck = 0
    this.circuitBreaker.reset()
  }

  private getPercentile(p: number): number {
    if (this.samples.length === 0) return 0
    const sorted = [...this.samples].sort((a, b) => a.duration - b.duration)
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, idx)]?.duration ?? 0
  }

  private pruneOldSamples(): void {
    const cutoff = Date.now() - 5 * 60 * 1000 // Keep last 5 minutes
    this.samples = this.samples.filter((s) => s.timestamp > cutoff)
  }
}

// ============================================================================
// Provider Health Monitor
// ============================================================================

/**
 * Monitors health of all registered providers.
 */
export class ProviderHealthMonitor {
  private providers = new Map<string, ProviderHealth>()
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private eventUnsubscribe: (() => void) | null = null

  constructor(private checkIntervalMs = 5 * 60 * 1000) {
    // Listen to provider events
    this.eventUnsubscribe = events.onAny((event) => {
      if (event.type === 'execution:complete') {
        const data = event.data as { durationMs?: number } | undefined
        this.recordSuccess(event.provider, data?.durationMs ?? 0)
      } else if (event.type === 'execution:error') {
        this.recordFailure(event.provider)
      }
    })
  }

  /**
   * Register a provider for monitoring.
   */
  register(key: string, config?: Partial<CircuitBreakerOptions>): void {
    if (!this.providers.has(key)) {
      this.providers.set(key, new ProviderHealth(key, config))
    }
  }

  /**
   * Unregister a provider.
   */
  unregister(key: string): boolean {
    return this.providers.delete(key)
  }

  /**
   * Record a successful execution.
   */
  recordSuccess(key: string, durationMs: number): void {
    this.providers.get(key)?.recordSuccess(durationMs)
  }

  /**
   * Record a failed execution.
   */
  recordFailure(key: string): void {
    this.providers.get(key)?.recordFailure()
  }

  /**
   * Check if provider is healthy.
   */
  isHealthy(key: string): boolean {
    return this.providers.get(key)?.isHealthy() ?? true
  }

  /**
   * Get health status for a provider.
   */
  getStatus(key: string): HealthStatus | null {
    return this.providers.get(key)?.getStatus() ?? null
  }

  /**
   * Get health status for all providers.
   */
  getAllStatus(): Record<string, HealthStatus> {
    const result: Record<string, HealthStatus> = {}
    for (const [key, health] of this.providers) {
      result[key] = health.getStatus()
    }
    return result
  }

  /**
   * Reset health status for a provider.
   */
  reset(key: string): void {
    this.providers.get(key)?.reset()
  }

  /**
   * Reset all health status.
   */
  resetAll(): void {
    for (const health of this.providers.values()) {
      health.reset()
    }
  }

  /**
   * Start periodic health checks.
   */
  startPeriodicChecks(providers: ICLIProvider[]): void {
    this.stopPeriodicChecks()
    this.checkInterval = setInterval(async () => {
      for (const provider of providers) {
        try {
          const available = await provider.isAvailable()
          if (!available) {
            this.recordFailure(provider.metadata.key)
          }
        } catch {
          this.recordFailure(provider.metadata.key)
        }
      }
    }, this.checkIntervalMs)
  }

  /**
   * Stop periodic health checks.
   */
  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  /**
   * Dispose of the monitor.
   */
  dispose(): void {
    this.stopPeriodicChecks()
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe()
      this.eventUnsubscribe = null
    }
    this.providers.clear()
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global provider health monitor instance.
 */
export const healthMonitor = new ProviderHealthMonitor()
