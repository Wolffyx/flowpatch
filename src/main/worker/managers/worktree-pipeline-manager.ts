/**
 * Worktree Pipeline Manager
 *
 * Manages git worktrees for isolated worker execution.
 * Wraps the GitWorktreeManager service with pipeline-specific logic.
 */

import {
  createWorktree,
  updateWorktreeStatus,
  updateWorktreeJob,
  getWorktreeByCard,
  getWorktreeByBranch,
  acquireWorktreeLock,
  releaseWorktreeLock,
  renewWorktreeLock,
  countActiveWorktrees
} from '../../db'
import { GitWorktreeManager, WorktreeConfig } from '../../services/git-worktree-manager'
import { generateWorktreeBranchName } from '../../../shared/types'
import type { Card, PolicyConfig, Worktree } from '../../../shared/types'

export interface WorktreePipelineConfig {
  projectId: string
  cardId: string
  jobId: string | null
  workerId: string
  repoPath: string
  policy: PolicyConfig
  card: Card
}

/**
 * Manages worktree lifecycle for the worker pipeline.
 */
export class WorktreePipelineManager {
  private config: WorktreePipelineConfig
  private log: (message: string) => void

  // Service
  private worktreeManager: GitWorktreeManager

  // State
  private worktreeRecord: Worktree | null = null
  private worktreePath: string | null = null
  private workerBranch: string | null = null
  private baseBranch: string | null = null
  private lockInterval: NodeJS.Timeout | null = null

  constructor(config: WorktreePipelineConfig, log: (message: string) => void) {
    this.config = config
    this.log = log
    this.worktreeManager = new GitWorktreeManager(config.repoPath)
  }

  // ==================== Getters ====================

  getWorktreeRecord(): Worktree | null {
    return this.worktreeRecord
  }

  getWorktreePath(): string | null {
    return this.worktreePath
  }

  getWorkerBranch(): string | null {
    return this.workerBranch
  }

  getWorktreeManager(): GitWorktreeManager {
    return this.worktreeManager
  }

  // ==================== Setters ====================

  setBaseBranch(branch: string): void {
    this.baseBranch = branch
  }

  // ==================== Worktree Support ====================

  /**
   * Check if git version supports worktrees.
   */
  checkWorktreeSupport(): boolean {
    return this.worktreeManager.checkWorktreeSupport()
  }

  /**
   * Check if worktrees are enabled and available.
   */
  canUseWorktree(): boolean {
    if (!this.config.policy.worker?.worktree?.enabled) {
      return false
    }

    if (!this.checkWorktreeSupport()) {
      this.log('Git version does not support worktrees (requires 2.17+), falling back to stash mode')
      return false
    }

    // Check max concurrent limit
    const maxConcurrent = this.config.policy.worker.worktree.maxConcurrent ?? 1
    const activeCount = countActiveWorktrees(this.config.projectId)
    if (activeCount >= maxConcurrent) {
      this.log(
        `Max concurrent worktrees reached (${activeCount}/${maxConcurrent}), falling back to stash mode`
      )
      return false
    }

    return true
  }

  // ==================== Worktree Config ====================

  /**
   * Get worktree configuration from policy.
   */
  getWorktreeConfig(): WorktreeConfig {
    return {
      root: this.config.policy.worker?.worktree?.root ?? 'repo',
      customPath: this.config.policy.worker?.worktree?.customPath
    }
  }

  // ==================== Setup & Cleanup ====================

  /**
   * Setup a git worktree for isolated work.
   */
  async setup(): Promise<boolean> {
    const { card, projectId, cardId, jobId, workerId, policy } = this.config

    try {
      const wtConfig = this.getWorktreeConfig()
      const baseBranch = this.baseBranch || policy.worker?.worktree?.baseBranch || 'main'

      // Check for existing worktree for this card
      const existingWorktree = getWorktreeByCard(cardId)
      if (existingWorktree) {
        const health = this.worktreeManager.verifyWorktree(
          existingWorktree.worktree_path,
          existingWorktree.branch_name
        )

        if (!health.healthy) {
          this.log(`Existing worktree is unhealthy: ${health.error}. Will recreate.`)
          updateWorktreeStatus(existingWorktree.id, 'error', health.error)
        } else {
          // Acquire lock
          const locked = acquireWorktreeLock(existingWorktree.id, workerId, 10)
          if (!locked) {
            this.log(`Worktree is locked by another worker: ${existingWorktree.worktree_path}`)
            return false
          }

          this.log(`Reusing existing worktree: ${existingWorktree.worktree_path}`)
          this.worktreeRecord = existingWorktree
          this.worktreePath = existingWorktree.worktree_path
          this.workerBranch = existingWorktree.branch_name
          updateWorktreeJob(existingWorktree.id, jobId)
          updateWorktreeStatus(existingWorktree.id, 'running')
          return true
        }
      }

      // Generate branch name
      let branchName = generateWorktreeBranchName(
        card.provider,
        card.remote_number_or_iid,
        card.title,
        policy.worker?.worktree?.branchPrefix ?? 'patchwork/'
      )

      // Check for existing record by branch name
      const existingByBranch = getWorktreeByBranch(projectId, branchName)
      if (existingByBranch && existingByBranch.card_id === cardId) {
        const health = this.worktreeManager.verifyWorktree(
          existingByBranch.worktree_path,
          existingByBranch.branch_name
        )

        const locked = acquireWorktreeLock(existingByBranch.id, workerId, 10)
        if (!locked) {
          this.log(`Worktree is locked by another worker: ${existingByBranch.worktree_path}`)
          return false
        }

        if (health.healthy) {
          this.log(`Reusing existing worktree: ${existingByBranch.worktree_path}`)
          this.worktreeRecord = existingByBranch
          this.worktreePath = existingByBranch.worktree_path
          this.workerBranch = existingByBranch.branch_name
          updateWorktreeJob(existingByBranch.id, jobId)
          updateWorktreeStatus(existingByBranch.id, 'running')
          return true
        }

        this.log(`Existing worktree is unhealthy: ${health.error}. Attempting to recreate.`)
        this.worktreeRecord = existingByBranch
        updateWorktreeJob(existingByBranch.id, jobId)
        updateWorktreeStatus(existingByBranch.id, 'creating')
      } else if (existingByBranch && existingByBranch.card_id !== cardId) {
        // Another card uses this branch, add suffix
        branchName = `${branchName}-${cardId.slice(0, 6)}`
      }

      // Compute worktree path
      const worktreePath = this.worktreeManager.computeWorktreePath(branchName, wtConfig)

      if (!this.worktreeRecord) {
        // Create DB record with lock already acquired
        const now = new Date()
        const lockExpiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString()

        this.worktreeRecord = createWorktree({
          projectId,
          cardId,
          jobId: jobId ?? undefined,
          worktreePath,
          branchName,
          baseRef: `origin/${baseBranch}`,
          status: 'creating',
          lockedBy: workerId,
          lockExpiresAt
        })
      }

      this.log(`Creating worktree at: ${worktreePath}`)

      // Create the worktree
      const result = await this.worktreeManager.ensureWorktree(
        worktreePath,
        branchName,
        baseBranch,
        {
          fetchFirst: true,
          config: wtConfig
        }
      )

      this.worktreePath = result.worktreePath
      this.workerBranch = result.branchName

      // Verify the worktree
      const health = this.worktreeManager.verifyWorktree(result.worktreePath, result.branchName)
      if (!health.healthy) {
        const error = `Worktree verification failed: ${health.error}`
        this.log(error)
        updateWorktreeStatus(this.worktreeRecord.id, 'error', error)
        return false
      }

      // Update status to running
      updateWorktreeStatus(this.worktreeRecord.id, 'running')

      this.log(`Worktree ${result.created ? 'created' : 'reused'}: ${result.branchName}`)
      return true
    } catch (error) {
      this.log(`Failed to setup worktree: ${error}`)
      if (this.worktreeRecord) {
        updateWorktreeStatus(
          this.worktreeRecord.id,
          'error',
          error instanceof Error ? error.message : String(error)
        )
      }
      return false
    }
  }

  /**
   * Start the lock renewal interval.
   */
  startLockRenewal(): void {
    if (!this.worktreeRecord) return

    this.lockInterval = setInterval(
      () => {
        if (this.worktreeRecord) {
          renewWorktreeLock(this.worktreeRecord.id, this.config.workerId, 10)
        }
      },
      5 * 60 * 1000 // Renew every 5 minutes
    )
  }

  /**
   * Stop the lock renewal interval.
   */
  stopLockRenewal(): void {
    if (this.lockInterval) {
      clearInterval(this.lockInterval)
      this.lockInterval = null
    }
  }

  /**
   * Cleanup worktree after worker completes.
   */
  async cleanup(success: boolean): Promise<void> {
    if (!this.worktreeRecord) return

    const cleanup = this.config.policy.worker?.worktree?.cleanup
    const cleanupTiming = success ? cleanup?.onSuccess : cleanup?.onFailure

    // Release lock
    releaseWorktreeLock(this.worktreeRecord.id, this.config.workerId)

    switch (cleanupTiming) {
      case 'immediate':
        this.log('Cleaning up worktree immediately')
        try {
          await this.worktreeManager.removeWorktree(this.worktreePath!, {
            force: true,
            config: this.getWorktreeConfig()
          })
          updateWorktreeStatus(this.worktreeRecord.id, 'cleaned')
        } catch (error) {
          this.log(`Failed to cleanup worktree: ${error}`)
          updateWorktreeStatus(
            this.worktreeRecord.id,
            'error',
            error instanceof Error ? error.message : String(error)
          )
        }
        break

      case 'delay':
        this.log('Worktree marked for delayed cleanup')
        updateWorktreeStatus(this.worktreeRecord.id, 'cleanup_pending')
        break

      case 'never':
        this.log('Worktree kept (cleanup=never)')
        updateWorktreeStatus(this.worktreeRecord.id, 'ready')
        break

      default:
        // Default: immediate on success, delay on failure
        if (success) {
          try {
            await this.worktreeManager.removeWorktree(this.worktreePath!, {
              force: true,
              config: this.getWorktreeConfig()
            })
            updateWorktreeStatus(this.worktreeRecord.id, 'cleaned')
          } catch {
            updateWorktreeStatus(this.worktreeRecord.id, 'cleanup_pending')
          }
        } else {
          updateWorktreeStatus(this.worktreeRecord.id, 'cleanup_pending')
        }
    }
  }
}
