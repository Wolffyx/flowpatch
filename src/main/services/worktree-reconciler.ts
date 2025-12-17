import { GitWorktreeManager, WorktreeConfig } from './git-worktree-manager'
import {
  listWorktrees,
  listWorktreesByStatus,
  updateWorktreeStatus,
  getExpiredWorktreeLocks,
  releaseWorktreeLock,
  getProject,
  Worktree
} from '../db'
import type { PolicyConfig } from '../../shared/types'

export interface ReconciliationResult {
  orphaned: Worktree[] // In DB but not on disk
  untracked: string[] // On disk but not in DB
  expiredLocks: Worktree[] // Locks that expired
  cleanedUp: Worktree[] // Successfully cleaned up
  errors: Array<{ worktree: Worktree; error: string }>
}

/**
 * Reconciles database worktree records with actual git worktrees on disk.
 * Handles crash recovery by cleaning up stale entries and expired locks.
 */
export class WorktreeReconciler {
  private manager: GitWorktreeManager
  private config: WorktreeConfig

  constructor(
    private projectId: string,
    private repoPath: string,
    policy?: PolicyConfig
  ) {
    this.manager = new GitWorktreeManager(repoPath)
    this.config = {
      root: policy?.worker?.worktree?.root ?? 'repo',
      customPath: policy?.worker?.worktree?.customPath
    }
  }

  /**
   * Perform full reconciliation between DB and disk state.
   */
  async reconcile(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      orphaned: [],
      untracked: [],
      expiredLocks: [],
      cleanedUp: [],
      errors: []
    }

    // 1. Get all worktrees from DB and disk
    const dbWorktrees = listWorktrees(this.projectId)
    const gitWorktrees = this.manager.list()

    // Create lookup sets for efficient comparison
    const dbPaths = new Set(dbWorktrees.map((wt) => wt.worktree_path))
    const gitPaths = new Set(gitWorktrees.map((wt) => wt.worktreePath))

    // 2. Find orphaned DB records (in DB but not on disk)
    for (const dbWt of dbWorktrees) {
      if (!gitPaths.has(dbWt.worktree_path)) {
        // Worktree missing from disk
        if (dbWt.status !== 'cleaned' && dbWt.status !== 'error') {
          result.orphaned.push(dbWt)
          updateWorktreeStatus(dbWt.id, 'error', 'Worktree missing from disk (possibly crashed)')
        }
      }
    }

    // 3. Find untracked git worktrees (on disk but not in DB)
    // Only report worktrees that are under our managed root
    const worktreeRoot = this.manager.getWorktreeRoot(this.config)
    for (const gitWt of gitWorktrees) {
      if (!dbPaths.has(gitWt.worktreePath)) {
        // Only flag as untracked if it's under our managed root
        if (gitWt.worktreePath.startsWith(worktreeRoot)) {
          result.untracked.push(gitWt.worktreePath)
        }
      }
    }

    // 4. Handle expired locks
    const expiredLocks = getExpiredWorktreeLocks()
    for (const wt of expiredLocks) {
      if (wt.project_id === this.projectId) {
        result.expiredLocks.push(wt)
        releaseWorktreeLock(wt.id)
        updateWorktreeStatus(wt.id, 'cleanup_pending', 'Lock expired (possible crash)')
      }
    }

    // 5. Process cleanup_pending worktrees
    const pendingCleanup = listWorktreesByStatus(this.projectId, 'cleanup_pending')
    for (const wt of pendingCleanup) {
      try {
        await this.manager.removeWorktree(wt.worktree_path, {
          force: true,
          config: this.config
        })
        updateWorktreeStatus(wt.id, 'cleaned')
        result.cleanedUp.push(wt)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        updateWorktreeStatus(wt.id, 'error', errorMsg)
        result.errors.push({ worktree: wt, error: errorMsg })
      }
    }

    // 6. Prune stale git worktree entries
    try {
      this.manager.prune()
    } catch (err) {
      console.warn('Failed to prune worktrees:', err)
    }

    return result
  }

  /**
   * Clean up a specific worktree by ID.
   */
  async cleanupWorktree(worktreeId: string): Promise<void> {
    const dbWorktrees = listWorktrees(this.projectId)
    const wt = dbWorktrees.find((w) => w.id === worktreeId)

    if (!wt) {
      throw new Error(`Worktree not found: ${worktreeId}`)
    }

    try {
      await this.manager.removeWorktree(wt.worktree_path, {
        force: true,
        config: this.config
      })
      updateWorktreeStatus(wt.id, 'cleaned')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      updateWorktreeStatus(wt.id, 'error', errorMsg)
      throw err
    }
  }

  /**
   * Clean up all stale worktrees for this project.
   */
  async cleanupAll(): Promise<number> {
    let cleaned = 0

    // Clean up all non-active worktrees
    const worktrees = listWorktrees(this.projectId)
    for (const wt of worktrees) {
      // Skip worktrees that are actively in use
      if (wt.status === 'running' || wt.status === 'creating') {
        continue
      }

      // Skip already cleaned/errored
      if (wt.status === 'cleaned') {
        continue
      }

      try {
        await this.manager.removeWorktree(wt.worktree_path, {
          force: true,
          config: this.config
        })
        updateWorktreeStatus(wt.id, 'cleaned')
        cleaned++
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        updateWorktreeStatus(wt.id, 'error', errorMsg)
      }
    }

    // Prune git worktree entries
    try {
      this.manager.prune()
    } catch (err) {
      console.warn('Failed to prune worktrees:', err)
    }

    return cleaned
  }
}

/**
 * Reconcile worktrees for all projects on startup.
 */
export async function reconcileAllProjects(
  projects: Array<{ id: string; local_path: string; policy_json: string | null }>
): Promise<Map<string, ReconciliationResult>> {
  const results = new Map<string, ReconciliationResult>()

  for (const project of projects) {
    if (!project.local_path) continue

    let policy: PolicyConfig | undefined
    try {
      policy = project.policy_json ? JSON.parse(project.policy_json) : undefined
    } catch {
      // Invalid policy JSON, use defaults
    }

    // Only reconcile if worktrees are enabled
    if (!policy?.worker?.worktree?.enabled) continue

    try {
      const reconciler = new WorktreeReconciler(project.id, project.local_path, policy)
      const result = await reconciler.reconcile()
      results.set(project.id, result)
    } catch (err) {
      console.error(`Failed to reconcile worktrees for project ${project.id}:`, err)
    }
  }

  return results
}
