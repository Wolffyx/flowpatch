import { GitWorktreeManager, WorktreeConfig } from './git-worktree-manager'
import {
  listWorktrees,
  listWorktreesByStatus,
  updateWorktreeStatus,
  getExpiredWorktreeLocks,
  releaseWorktreeLock,
  Worktree
} from '../db'
import type { PolicyConfig } from '../../shared/types'
import path from 'path'

export interface ReconciliationResult {
  orphaned: Worktree[] // In DB but not on disk
  untracked: string[] // On disk but not in DB
  untrackedCleaned: string[] // Untracked worktrees that were cleaned
  expiredLocks: Worktree[] // Locks that expired
  cleanedUp: Worktree[] // Successfully cleaned up
  errors: Array<{ worktree: Worktree | null; path?: string; error: string }>
}

export interface ReconcileOptions {
  cleanUntracked?: boolean // If true, remove untracked worktrees that have .patchwork-worktree marker
}

function normalizePath(p: string): string {
  const resolved = path.resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isUnderRoot(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizePath(candidatePath)
  const root = normalizePath(rootPath)
  return candidate.startsWith(root + path.sep)
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
    repoPath: string,
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
   * @param options.cleanUntracked If true, remove untracked worktrees that have .patchwork-worktree marker
   */
  async reconcile(options?: ReconcileOptions): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      orphaned: [],
      untracked: [],
      untrackedCleaned: [],
      expiredLocks: [],
      cleanedUp: [],
      errors: []
    }

    // 1. Get all worktrees from DB and disk
    const dbWorktrees = listWorktrees(this.projectId)
    const gitWorktrees = this.manager.list()

    // Create lookup sets for efficient comparison
    const dbPaths = new Set(dbWorktrees.map((wt) => normalizePath(wt.worktree_path)))
    const gitPaths = new Set(gitWorktrees.map((wt) => normalizePath(wt.worktreePath)))

    // 2. Find orphaned DB records (in DB but not on disk)
    for (const dbWt of dbWorktrees) {
      if (!gitPaths.has(normalizePath(dbWt.worktree_path))) {
        // Worktree missing from disk - also check if it's running (shouldn't be if not on disk)
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
      if (!dbPaths.has(normalizePath(gitWt.worktreePath))) {
        // Only flag as untracked if it's under our managed root (avoid prefix false-positives)
        if (isUnderRoot(gitWt.worktreePath, worktreeRoot)) {
          result.untracked.push(gitWt.worktreePath)

          // Optionally clean up untracked worktrees that have the patchwork marker
          if (options?.cleanUntracked && this.manager.isPatchworkWorktree(gitWt.worktreePath)) {
            try {
              await this.manager.removeWorktree(gitWt.worktreePath, {
                force: true,
                config: this.config
              })
              result.untrackedCleaned.push(gitWt.worktreePath)
              console.log(`[WorktreeReconciler] Cleaned untracked patchwork worktree: ${gitWt.worktreePath}`)
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err)
              result.errors.push({ worktree: null, path: gitWt.worktreePath, error: errorMsg })
              console.error(`[WorktreeReconciler] Failed to clean untracked worktree ${gitWt.worktreePath}:`, errorMsg)
            }
          }
        }
      }
    }

    // 4. Handle expired locks
    const expiredLocks = getExpiredWorktreeLocks()
    for (const wt of expiredLocks) {
      if (wt.project_id === this.projectId) {
        result.expiredLocks.push(wt)
        // Force release (no lockedBy check since we're doing cleanup)
        releaseWorktreeLock(wt.id, null)
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
 * @param projects List of projects to reconcile
 * @param options.cleanUntracked If true, remove untracked worktrees that have .patchwork-worktree marker
 */
export async function reconcileAllProjects(
  projects: Array<{ id: string; local_path: string; policy_json: string | null }>,
  options?: ReconcileOptions
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
      const result = await reconciler.reconcile(options)
      results.set(project.id, result)

      // Log summary
      if (result.orphaned.length > 0 || result.cleanedUp.length > 0 || result.untrackedCleaned.length > 0) {
        console.log(
          `[WorktreeReconciler] Project ${project.id}: ` +
            `orphaned=${result.orphaned.length}, ` +
            `cleaned=${result.cleanedUp.length}, ` +
            `untrackedCleaned=${result.untrackedCleaned.length}, ` +
            `expiredLocks=${result.expiredLocks.length}`
        )
      }
    } catch (err) {
      console.error(`Failed to reconcile worktrees for project ${project.id}:`, err)
    }
  }

  return results
}
