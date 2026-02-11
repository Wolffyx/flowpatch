/**
 * Worker Recovery
 *
 * Recovers cards stuck in worker states from previous crashes.
 * Also cleans up orphaned worktrees.
 * Called on app startup to ensure no cards are left in limbo.
 */

import {
  listProjects,
  listCards,
  updateCardStatus,
  getRunningJobs,
  listWorktrees,
  getExpiredWorktreeLocks,
  releaseWorktreeLock,
  updateWorktreeStatus
} from '../db'
import { broadcastToRenderers } from '../ipc/broadcast'
import { logAction } from '../utils/main-logger'

/**
 * Recovers cards stuck in worker states from previous crashes.
 * A card is considered stuck if it's in 'in_progress' or 'testing' status
 * but has no active worker job running for it.
 *
 * Also cleans up orphaned worktrees with expired locks.
 *
 * @returns The number of cards recovered
 */
export async function recoverStuckCards(): Promise<number> {
  let recovered = 0
  let worktreesCleaned = 0
  const projects = listProjects()

  for (const project of projects) {
    const cards = listCards(project.id)
    const runningJobs = getRunningJobs(project.id)

    // Build a set of card IDs that have active jobs
    const activeJobCardIds = new Set(
      runningJobs
        .filter((j) => j.type === 'worker_run')
        .map((j) => j.card_id)
        .filter(Boolean) as string[]
    )

    // Build a set of job IDs that are active
    const activeJobIds = new Set(
      runningJobs.filter((j) => j.type === 'worker_run').map((j) => j.id)
    )

    for (const card of cards) {
      // Cards in worker states without active jobs are stuck
      if (['in_progress', 'testing'].includes(card.status)) {
        if (!activeJobCardIds.has(card.id)) {
          try {
            updateCardStatus(card.id, 'ready', project.id)
            logAction('recovery:stuckCardRecovered', {
              cardId: card.id,
              projectId: project.id,
              previousStatus: card.status
            })
            recovered++
          } catch (error) {
            logAction('recovery:stuckCardRecoveryFailed', {
              cardId: card.id,
              projectId: project.id,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      }
    }

    // Cleanup orphaned worktrees
    // 1. Release expired locks
    try {
      const expiredLocks = getExpiredWorktreeLocks(project.id)
      for (const worktree of expiredLocks) {
        try {
          releaseWorktreeLock(worktree.id, null, project.id)
          logAction('recovery:expiredWorktreeLockReleased', {
            worktreeId: worktree.id,
            projectId: project.id,
            lockedBy: worktree.locked_by,
            expiredAt: worktree.lock_expires_at
          })
        } catch (error) {
          logAction('recovery:expiredWorktreeLockReleaseFailed', {
            worktreeId: worktree.id,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } catch (error) {
      logAction('recovery:expiredLocksCheckFailed', {
        projectId: project.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    // 2. Mark orphaned worktrees (running status but no active job) for cleanup
    try {
      const worktrees = listWorktrees(project.id)
      for (const worktree of worktrees) {
        if (worktree.status === 'running') {
          // Check if the associated job is still active
          const jobId = worktree.job_id
          if (!jobId || !activeJobIds.has(jobId)) {
            try {
              // Release any stale lock
              releaseWorktreeLock(worktree.id, null, project.id)
              // Mark for delayed cleanup (don't delete immediately in case of crash recovery)
              updateWorktreeStatus(worktree.id, 'cleanup_pending', 'Orphaned during recovery', project.id)
              worktreesCleaned++
              logAction('recovery:orphanedWorktreeMarkedForCleanup', {
                worktreeId: worktree.id,
                projectId: project.id,
                worktreePath: worktree.worktree_path,
                jobId
              })
            } catch (error) {
              logAction('recovery:orphanedWorktreeCleanupFailed', {
                worktreeId: worktree.id,
                projectId: project.id,
                error: error instanceof Error ? error.message : String(error)
              })
            }
          }
        }
      }
    } catch (error) {
      logAction('recovery:worktreeCleanupFailed', {
        projectId: project.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  if (recovered > 0 || worktreesCleaned > 0) {
    broadcastToRenderers('stateUpdated')
    if (recovered > 0) {
      console.log(`[Recovery] Recovered ${recovered} stuck card(s)`)
    }
    if (worktreesCleaned > 0) {
      console.log(`[Recovery] Marked ${worktreesCleaned} orphaned worktree(s) for cleanup`)
    }
  }

  return recovered
}
