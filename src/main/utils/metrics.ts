/**
 * Metrics Collection
 *
 * Provides metrics collection and health monitoring for the worker system.
 */

import { MAX_METRICS_HISTORY, METRICS_FLUSH_INTERVAL_MS } from './constants'

// ============================================================================
// Types
// ============================================================================

export interface MetricValue {
  name: string
  value: number
  timestamp: number
  tags?: Record<string, string>
}

export interface HistogramBuckets {
  count: number
  sum: number
  min: number
  max: number
  buckets: Map<number, number> // threshold -> count
}

export interface MetricsSnapshot {
  counters: Map<string, number>
  gauges: Map<string, number>
  histograms: Map<string, HistogramBuckets>
  timestamp: number
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: Record<
    string,
    {
      status: 'pass' | 'warn' | 'fail'
      message?: string
      value?: number | string
    }
  >
  timestamp: number
}

export type HealthCheckFn = () => Promise<{ status: 'pass' | 'warn' | 'fail'; message?: string; value?: number | string }>

// ============================================================================
// Metrics Collector
// ============================================================================

class MetricsCollectorClass {
  private counters = new Map<string, number>()
  private gauges = new Map<string, number>()
  private histograms = new Map<string, HistogramBuckets>()
  private history: MetricValue[] = []
  private healthChecks = new Map<string, HealthCheckFn>()
  private flushInterval: NodeJS.Timeout | null = null
  private flushCallback: ((snapshot: MetricsSnapshot) => void) | null = null

  // Default histogram buckets (response times in ms)
  private readonly defaultBuckets = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]

  // ============================================================================
  // Counters
  // ============================================================================

  /**
   * Increment a counter.
   */
  increment(name: string, value = 1, tags?: Record<string, string>): void {
    const key = this.buildKey(name, tags)
    const current = this.counters.get(key) ?? 0
    this.counters.set(key, current + value)

    this.recordHistory({ name: key, value: current + value, timestamp: Date.now(), tags })
  }

  /**
   * Get a counter value.
   */
  getCounter(name: string, tags?: Record<string, string>): number {
    const key = this.buildKey(name, tags)
    return this.counters.get(key) ?? 0
  }

  // ============================================================================
  // Gauges
  // ============================================================================

  /**
   * Set a gauge value.
   */
  setGauge(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.buildKey(name, tags)
    this.gauges.set(key, value)

    this.recordHistory({ name: key, value, timestamp: Date.now(), tags })
  }

  /**
   * Get a gauge value.
   */
  getGauge(name: string, tags?: Record<string, string>): number | undefined {
    const key = this.buildKey(name, tags)
    return this.gauges.get(key)
  }

  /**
   * Increment a gauge.
   */
  incrementGauge(name: string, value = 1, tags?: Record<string, string>): void {
    const key = this.buildKey(name, tags)
    const current = this.gauges.get(key) ?? 0
    this.setGauge(name, current + value, tags)
  }

  /**
   * Decrement a gauge.
   */
  decrementGauge(name: string, value = 1, tags?: Record<string, string>): void {
    const key = this.buildKey(name, tags)
    const current = this.gauges.get(key) ?? 0
    this.setGauge(name, Math.max(0, current - value), tags)
  }

  // ============================================================================
  // Histograms
  // ============================================================================

  /**
   * Record a histogram value.
   */
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.buildKey(name, tags)

    let histogram = this.histograms.get(key)
    if (!histogram) {
      histogram = {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        buckets: new Map(this.defaultBuckets.map((b) => [b, 0]))
      }
      this.histograms.set(key, histogram)
    }

    histogram.count++
    histogram.sum += value
    histogram.min = Math.min(histogram.min, value)
    histogram.max = Math.max(histogram.max, value)

    // Update buckets
    for (const threshold of this.defaultBuckets) {
      if (value <= threshold) {
        histogram.buckets.set(threshold, (histogram.buckets.get(threshold) ?? 0) + 1)
      }
    }

    this.recordHistory({ name: key, value, timestamp: Date.now(), tags })
  }

  /**
   * Get histogram statistics.
   */
  getHistogram(
    name: string,
    tags?: Record<string, string>
  ): { count: number; sum: number; avg: number; min: number; max: number; p50: number; p95: number; p99: number } | undefined {
    const key = this.buildKey(name, tags)
    const histogram = this.histograms.get(key)
    if (!histogram || histogram.count === 0) return undefined

    // Calculate percentiles from buckets
    const p50 = this.calculatePercentile(histogram, 0.5)
    const p95 = this.calculatePercentile(histogram, 0.95)
    const p99 = this.calculatePercentile(histogram, 0.99)

    return {
      count: histogram.count,
      sum: histogram.sum,
      avg: histogram.sum / histogram.count,
      min: histogram.min === Infinity ? 0 : histogram.min,
      max: histogram.max === -Infinity ? 0 : histogram.max,
      p50,
      p95,
      p99
    }
  }

  private calculatePercentile(histogram: HistogramBuckets, percentile: number): number {
    const targetCount = Math.ceil(histogram.count * percentile)
    let cumulative = 0
    let previousBucket = 0

    for (const [threshold, count] of Array.from(histogram.buckets.entries()).sort((a, b) => a[0] - b[0])) {
      cumulative += count
      if (cumulative >= targetCount) {
        // Interpolate within bucket
        const bucketStart = previousBucket
        const bucketEnd = threshold
        return (bucketStart + bucketEnd) / 2
      }
      previousBucket = threshold
    }

    return histogram.max
  }

  // ============================================================================
  // Timing
  // ============================================================================

  /**
   * Time an operation and record to histogram.
   */
  async time<T>(name: string, fn: () => Promise<T>, tags?: Record<string, string>): Promise<T> {
    const start = Date.now()
    try {
      return await fn()
    } finally {
      const duration = Date.now() - start
      this.recordHistogram(name, duration, tags)
    }
  }

  /**
   * Create a timer that can be manually stopped.
   */
  startTimer(name: string, tags?: Record<string, string>): () => number {
    const start = Date.now()
    return () => {
      const duration = Date.now() - start
      this.recordHistogram(name, duration, tags)
      return duration
    }
  }

  // ============================================================================
  // Health Checks
  // ============================================================================

  /**
   * Register a health check.
   */
  registerHealthCheck(name: string, check: HealthCheckFn): void {
    this.healthChecks.set(name, check)
  }

  /**
   * Unregister a health check.
   */
  unregisterHealthCheck(name: string): boolean {
    return this.healthChecks.delete(name)
  }

  /**
   * Run all health checks.
   */
  async runHealthChecks(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = {}
    let hasWarning = false
    let hasFailed = false

    for (const [name, check] of this.healthChecks) {
      try {
        const result = await check()
        checks[name] = result
        if (result.status === 'warn') hasWarning = true
        if (result.status === 'fail') hasFailed = true
      } catch (error) {
        checks[name] = {
          status: 'fail',
          message: error instanceof Error ? error.message : String(error)
        }
        hasFailed = true
      }
    }

    let status: HealthStatus['status'] = 'healthy'
    if (hasFailed) status = 'unhealthy'
    else if (hasWarning) status = 'degraded'

    return {
      status,
      checks,
      timestamp: Date.now()
    }
  }

  // ============================================================================
  // Snapshots & Export
  // ============================================================================

  /**
   * Get a snapshot of all metrics.
   */
  getSnapshot(): MetricsSnapshot {
    return {
      counters: new Map(this.counters),
      gauges: new Map(this.gauges),
      histograms: new Map(this.histograms),
      timestamp: Date.now()
    }
  }

  /**
   * Get metrics history.
   */
  getHistory(name?: string, since?: number): MetricValue[] {
    let filtered = this.history

    if (name) {
      filtered = filtered.filter((m) => m.name === name || m.name.startsWith(name + '_'))
    }

    if (since) {
      filtered = filtered.filter((m) => m.timestamp >= since)
    }

    return filtered
  }

  /**
   * Export metrics as JSON.
   */
  toJSON(): Record<string, unknown> {
    const snapshot = this.getSnapshot()

    return {
      counters: Object.fromEntries(snapshot.counters),
      gauges: Object.fromEntries(snapshot.gauges),
      histograms: Object.fromEntries(
        Array.from(snapshot.histograms.entries()).map(([name, h]) => [
          name,
          {
            count: h.count,
            sum: h.sum,
            avg: h.count > 0 ? h.sum / h.count : 0,
            min: h.min === Infinity ? 0 : h.min,
            max: h.max === -Infinity ? 0 : h.max
          }
        ])
      ),
      timestamp: snapshot.timestamp
    }
  }

  // ============================================================================
  // Flush & Lifecycle
  // ============================================================================

  /**
   * Start periodic flushing.
   */
  startPeriodicFlush(callback: (snapshot: MetricsSnapshot) => void, intervalMs = METRICS_FLUSH_INTERVAL_MS): void {
    this.flushCallback = callback
    this.flushInterval = setInterval(() => {
      callback(this.getSnapshot())
    }, intervalMs)
  }

  /**
   * Stop periodic flushing.
   */
  stopPeriodicFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }
    this.flushCallback = null
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.counters.clear()
    this.gauges.clear()
    this.histograms.clear()
    this.history = []
  }

  /**
   * Clear history only.
   */
  clearHistory(): void {
    this.history = []
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private buildKey(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) {
      return name
    }

    const tagParts = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',')

    return `${name}{${tagParts}}`
  }

  private recordHistory(value: MetricValue): void {
    this.history.push(value)

    // Trim history if too long
    if (this.history.length > MAX_METRICS_HISTORY) {
      this.history = this.history.slice(-MAX_METRICS_HISTORY)
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const Metrics = new MetricsCollectorClass()

// ============================================================================
// Predefined Metrics
// ============================================================================

/**
 * Common metric names for consistency.
 */
export const MetricNames = {
  // Worker metrics
  WORKER_JOBS_STARTED: 'worker.jobs.started',
  WORKER_JOBS_COMPLETED: 'worker.jobs.completed',
  WORKER_JOBS_FAILED: 'worker.jobs.failed',
  WORKER_JOBS_CANCELED: 'worker.jobs.canceled',
  WORKER_JOB_DURATION: 'worker.job.duration',
  WORKER_ACTIVE_JOBS: 'worker.jobs.active',

  // Pipeline metrics
  PIPELINE_PHASE_DURATION: 'pipeline.phase.duration',
  PIPELINE_RETRIES: 'pipeline.retries',

  // Git metrics
  GIT_OPERATIONS: 'git.operations',
  GIT_OPERATION_DURATION: 'git.operation.duration',
  GIT_FAILURES: 'git.failures',

  // API metrics
  API_REQUESTS: 'api.requests',
  API_REQUEST_DURATION: 'api.request.duration',
  API_ERRORS: 'api.errors',
  API_RATE_LIMITED: 'api.rate_limited',

  // Cache metrics
  CACHE_HITS: 'cache.hits',
  CACHE_MISSES: 'cache.misses',
  CACHE_SIZE: 'cache.size',
  CACHE_EVICTIONS: 'cache.evictions',

  // Database metrics
  DB_QUERIES: 'db.queries',
  DB_QUERY_DURATION: 'db.query.duration',
  DB_ERRORS: 'db.errors',

  // Sync metrics
  SYNC_RUNS: 'sync.runs',
  SYNC_DURATION: 'sync.duration',
  SYNC_CARDS_UPDATED: 'sync.cards_updated',
  SYNC_ERRORS: 'sync.errors',

  // Security metrics
  SECURITY_BLOCKS: 'security.blocks',
  SECURITY_VALIDATIONS: 'security.validations',

  // Resource metrics
  RESOURCES_ACTIVE: 'resources.active',
  RESOURCES_LEAKED: 'resources.leaked'
} as const

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Record a worker job completion.
 */
export function recordJobCompletion(
  success: boolean,
  duration: number,
  phase: string
): void {
  if (success) {
    Metrics.increment(MetricNames.WORKER_JOBS_COMPLETED)
  } else {
    Metrics.increment(MetricNames.WORKER_JOBS_FAILED, 1, { phase })
  }
  Metrics.recordHistogram(MetricNames.WORKER_JOB_DURATION, duration)
}

/**
 * Record an API request.
 */
export function recordApiRequest(
  provider: string,
  method: string,
  status: number,
  duration: number
): void {
  Metrics.increment(MetricNames.API_REQUESTS, 1, { provider, method })
  Metrics.recordHistogram(MetricNames.API_REQUEST_DURATION, duration, { provider })

  if (status >= 400) {
    Metrics.increment(MetricNames.API_ERRORS, 1, { provider, status: String(status) })
  }

  if (status === 429) {
    Metrics.increment(MetricNames.API_RATE_LIMITED, 1, { provider })
  }
}

/**
 * Record a cache access.
 */
export function recordCacheAccess(name: string, hit: boolean): void {
  if (hit) {
    Metrics.increment(MetricNames.CACHE_HITS, 1, { cache: name })
  } else {
    Metrics.increment(MetricNames.CACHE_MISSES, 1, { cache: name })
  }
}
