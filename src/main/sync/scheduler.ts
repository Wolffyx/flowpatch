/**
 * SyncScheduler manages per-project interval-based sync polling.
 *
 * Features:
 * - Configurable polling interval per project
 * - Debounced action-triggered syncs
 * - Automatic start/stop with project lifecycle
 * - Integration with existing runSync() function
 */

import { runSync } from './engine'
import { getProject } from '../db'
import { broadcastToRenderers } from '../ipc/broadcast'
import { logAction } from '../../shared/utils'
import type { PolicyConfig } from '../../shared/types'

export interface SyncSchedulerConfig {
  pollIntervalMs: number
  autoSyncOnAction: boolean
  debounceDelayMs: number
}

export class SyncScheduler {
  private projectId: string
  private config: SyncSchedulerConfig
  private pollTimeout: ReturnType<typeof setTimeout> | null = null
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null
  private isRunningSync = false
  private isShuttingDown = false
  private nextSyncAt: number | null = null
  private lastSyncAt: number | null = null

  constructor(projectId: string, config: SyncSchedulerConfig) {
    this.projectId = projectId
    this.config = config
  }

  async start(): Promise<void> {
    if (this.pollTimeout) return

    logAction('syncScheduler:started', {
      projectId: this.projectId,
      pollIntervalMs: this.config.pollIntervalMs
    })

    // Run initial sync, then schedule next
    await this.runScheduledSync()
    this.scheduleNextPoll()
  }

  stop(): void {
    this.isShuttingDown = true

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout)
      this.pollTimeout = null
    }

    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout)
      this.debounceTimeout = null
    }

    logAction('syncScheduler:stopped', { projectId: this.projectId })
  }

  /**
   * Trigger immediate sync (debounced to avoid rapid calls)
   */
  triggerSync(): void {
    if (!this.config.autoSyncOnAction || this.isShuttingDown) return

    // Clear existing debounce
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout)
    }

    // Debounce rapid triggers
    this.debounceTimeout = setTimeout(async () => {
      this.debounceTimeout = null
      await this.runScheduledSync()
    }, this.config.debounceDelayMs)

    logAction('syncScheduler:triggerQueued', { projectId: this.projectId })
  }

  private scheduleNextPoll(): void {
    if (this.isShuttingDown) return

    this.nextSyncAt = Date.now() + this.config.pollIntervalMs
    this.pollTimeout = setTimeout(async () => {
      await this.runScheduledSync()
      this.scheduleNextPoll()
    }, this.config.pollIntervalMs)
  }

  private async runScheduledSync(): Promise<void> {
    if (this.isRunningSync || this.isShuttingDown) return

    this.isRunningSync = true
    this.nextSyncAt = null

    try {
      const project = getProject(this.projectId)
      if (!project?.remote_repo_key) return

      logAction('syncScheduler:syncing', { projectId: this.projectId })

      const result = await runSync(this.projectId)
      this.lastSyncAt = Date.now()

      logAction('syncScheduler:syncComplete', {
        projectId: this.projectId,
        success: result.success,
        error: result.error
      })

      broadcastToRenderers('stateUpdated')
    } catch (error) {
      logAction('syncScheduler:syncError', {
        projectId: this.projectId,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.isRunningSync = false
    }
  }

  updateConfig(config: Partial<SyncSchedulerConfig>): void {
    this.config = { ...this.config, ...config }

    // Restart polling with new interval if changed
    if (config.pollIntervalMs && this.pollTimeout) {
      clearTimeout(this.pollTimeout)
      this.scheduleNextPoll()
    }
  }

  getStatus(): {
    running: boolean
    pollIntervalMs: number
    autoSyncOnAction: boolean
    isSyncing: boolean
    nextSyncAt: number | null
    lastSyncAt: number | null
  } {
    return {
      running: this.pollTimeout !== null,
      pollIntervalMs: this.config.pollIntervalMs,
      autoSyncOnAction: this.config.autoSyncOnAction,
      isSyncing: this.isRunningSync,
      nextSyncAt: this.nextSyncAt,
      lastSyncAt: this.lastSyncAt
    }
  }
}

// Module-level scheduler management (following WorkerPool pattern)
const activeSchedulers = new Map<string, SyncScheduler>()

export function startSyncScheduler(projectId: string, config: SyncSchedulerConfig): void {
  if (activeSchedulers.has(projectId)) return

  const scheduler = new SyncScheduler(projectId, config)
  scheduler.start()
  activeSchedulers.set(projectId, scheduler)
}

export function stopSyncScheduler(projectId: string): void {
  const scheduler = activeSchedulers.get(projectId)
  if (scheduler) {
    scheduler.stop()
    activeSchedulers.delete(projectId)
  }
}

export function stopAllSyncSchedulers(): void {
  for (const scheduler of activeSchedulers.values()) {
    scheduler.stop()
  }
  activeSchedulers.clear()
  logAction('syncScheduler:allStopped')
}

export function triggerProjectSync(projectId: string): void {
  const scheduler = activeSchedulers.get(projectId)
  scheduler?.triggerSync()
}

export function getSyncSchedulerStatus(projectId: string): {
  running: boolean
  pollIntervalMs: number
  autoSyncOnAction: boolean
  isSyncing: boolean
  nextSyncAt: number | null
  lastSyncAt: number | null
} | null {
  const scheduler = activeSchedulers.get(projectId)
  return scheduler?.getStatus() ?? null
}

export function getSyncSchedulerConfigFromPolicy(policy: PolicyConfig | null): SyncSchedulerConfig {
  return {
    pollIntervalMs: policy?.sync?.pollInterval ?? 180000, // 3 minutes default
    autoSyncOnAction: policy?.sync?.autoSyncOnAction !== false, // Default true
    debounceDelayMs: policy?.sync?.debounceDelay ?? 5000 // 5 seconds default
  }
}

export function updateSyncSchedulerConfig(projectId: string, config: Partial<SyncSchedulerConfig>): void {
  const scheduler = activeSchedulers.get(projectId)
  scheduler?.updateConfig(config)
}
