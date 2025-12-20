import { GitWorktreeManager, WorktreeConfig } from './git-worktree-manager'
import {
  listWorktreesByStatus,
  updateWorktreeStatus,
  listProjects,
} from '../db'
import type { PolicyConfig } from '../../shared/types'

/**
 * Scheduled cleanup service for worktrees.
 * Runs periodically to clean up worktrees that are marked for delayed cleanup.
 */
export class WorktreeCleanupScheduler {
  private intervalId: NodeJS.Timeout | null = null
  private isRunning = false

  /**
   * Start the cleanup scheduler.
   * @param intervalMinutes How often to check for delayed cleanups (default: 5 minutes)
   */
  start(intervalMinutes: number = 5): void {
    if (this.intervalId) {
      return // Already running
    }

    // Run immediately on start
    this.processDelayedCleanups().catch(console.error)

    // Then run on interval
    this.intervalId = setInterval(
      () => {
        this.processDelayedCleanups().catch(console.error)
      },
      intervalMinutes * 60 * 1000
    )
  }

  /**
   * Stop the cleanup scheduler.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  /**
   * Check if the scheduler is running.
   */
  isSchedulerRunning(): boolean {
    return this.intervalId !== null
  }

  /**
   * Process all delayed cleanups across all projects.
   */
  async processDelayedCleanups(): Promise<void> {
    if (this.isRunning) {
      return // Already processing
    }

    this.isRunning = true

    try {
      const projects = listProjects()

      for (const project of projects) {
        if (!project.local_path) continue

        let policy: PolicyConfig | undefined
        try {
          policy = project.policy_json ? JSON.parse(project.policy_json) : undefined
        } catch {
          // Invalid policy, skip
          continue
        }

        // Skip if worktrees not enabled
        if (!policy?.worker?.worktree?.enabled) continue

        await this.processProjectCleanups(project.id, project.local_path, policy)
      }
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Process delayed cleanups for a single project.
   */
  private async processProjectCleanups(
    projectId: string,
    repoPath: string,
    policy: PolicyConfig
  ): Promise<void> {
    const pending = listWorktreesByStatus(projectId, 'cleanup_pending')
    if (pending.length === 0) return

    const delayMinutes = policy.worker?.worktree?.cleanup?.delayMinutes ?? 30
    const delayMs = delayMinutes * 60 * 1000
    const now = Date.now()

    const config: WorktreeConfig = {
      root: policy.worker?.worktree?.root ?? 'repo',
      customPath: policy.worker?.worktree?.customPath
    }

    const manager = new GitWorktreeManager(repoPath)

    for (const wt of pending) {
      // Use cleanup_requested_at if available, otherwise fall back to updated_at
      // This ensures lock renewals don't reset the cleanup timer
      const cleanupRequestedAt = wt.cleanup_requested_at
        ? new Date(wt.cleanup_requested_at).getTime()
        : new Date(wt.updated_at).getTime()
      const age = now - cleanupRequestedAt

      // Only clean up if enough time has passed since cleanup was requested
      if (age >= delayMs) {
        try {
          await manager.removeWorktree(wt.worktree_path, {
            force: true,
            config
          })
          updateWorktreeStatus(wt.id, 'cleaned')
          console.log(`[WorktreeCleanupScheduler] Cleaned up worktree: ${wt.worktree_path}`)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          updateWorktreeStatus(wt.id, 'error', errorMsg)
          console.error(`[WorktreeCleanupScheduler] Failed to clean up worktree ${wt.worktree_path}:`, errorMsg)
        }
      }
    }

    // Prune stale entries
    try {
      manager.prune()
    } catch {
      // Ignore prune errors
    }
  }
}

// Singleton instance
let scheduler: WorktreeCleanupScheduler | null = null

/**
 * Get the singleton cleanup scheduler instance.
 */
export function getCleanupScheduler(): WorktreeCleanupScheduler {
  if (!scheduler) {
    scheduler = new WorktreeCleanupScheduler()
  }
  return scheduler
}

/**
 * Start the global cleanup scheduler.
 */
export function startCleanupScheduler(intervalMinutes: number = 5): void {
  getCleanupScheduler().start(intervalMinutes)
}

/**
 * Stop the global cleanup scheduler.
 */
export function stopCleanupScheduler(): void {
  if (scheduler) {
    scheduler.stop()
  }
}
