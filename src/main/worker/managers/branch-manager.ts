/**
 * Branch Manager
 *
 * Handles git branch operations for the worker pipeline.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolve } from 'path'
import {
  getGitEnv,
  localBranchExists,
  remoteBranchExists,
  checkoutBranch,
  createBranch as gitCreateBranch,
  createTrackingBranch,
  pullRebase,
  fetchOrigin,
  getDefaultBranch,
  getCurrentBranch,
  getHeadSha,
  resetHard,
  deleteBranch,
  getWorktreePathForBranch
} from '../git-operations'
import { slugify } from '../../../shared/types'
import type { Card, PolicyConfig } from '../../../shared/types'

const execFileAsync = promisify(execFile)

export interface BranchManagerConfig {
  repoPath: string
  policy: PolicyConfig
  card: Card
}

/**
 * Manages git branch operations for the worker pipeline.
 */
export class BranchManager {
  private repoPath: string
  private policy: PolicyConfig
  private card: Card
  private log: (message: string) => void

  // State
  private startingBranch: string | null = null
  private baseBranch: string | null = null
  private baseHeadSha: string | null = null
  private workerBranch: string | null = null

  constructor(config: BranchManagerConfig, log: (message: string) => void) {
    this.repoPath = config.repoPath
    this.policy = config.policy
    this.card = config.card
    this.log = log
  }

  // ==================== Getters ====================

  getStartingBranch(): string | null {
    return this.startingBranch
  }

  getBaseBranch(): string | null {
    return this.baseBranch
  }

  getBaseHeadSha(): string | null {
    return this.baseHeadSha
  }

  getWorkerBranch(): string | null {
    return this.workerBranch
  }

  setWorkerBranch(branch: string): void {
    this.workerBranch = branch
  }

  // ==================== Branch Operations ====================

  /**
   * Generate branch name from pattern.
   */
  generateBranchName(): string {
    const pattern = this.policy.worker?.branchPattern || 'kanban/{id}-{slug}'
    const issueId = this.card.remote_number_or_iid || this.card.id.slice(0, 8)
    const titleSlug = slugify(this.card.title)

    return pattern.replace('{id}', issueId).replace('{slug}', titleSlug.slice(0, 30))
  }

  /**
   * Get the base branch for the repository.
   */
  async fetchBaseBranch(): Promise<string> {
    // Prefer explicit worker base branch, fallback to legacy worktree setting
    const configured =
      (this.policy.worker?.baseBranch || '').trim() ||
      (this.policy.worker?.worktree?.baseBranch || '').trim()
    if (configured) {
      this.baseBranch = configured
      return configured
    }

    const defaultBranch = await getDefaultBranch(this.repoPath)
    this.baseBranch = defaultBranch
    return defaultBranch
  }

  /**
   * Create or checkout a branch for the worker.
   */
  async createBranch(branchName: string): Promise<void> {
    const baseBranch = await this.fetchBaseBranch()

    try {
      if (!this.startingBranch) {
        this.startingBranch = await getCurrentBranch(this.repoPath)
      }

      // If branch already exists, just check it out and continue work there
      if (await localBranchExists(this.repoPath, branchName)) {
        const checkedOutAt = await getWorktreePathForBranch(this.repoPath, branchName)
        if (checkedOutAt && this.normalizePath(checkedOutAt) !== this.normalizePath(this.repoPath)) {
          throw new Error(
            `Branch ${branchName} is already checked out in another worktree: ${checkedOutAt}`
          )
        }
        this.log(`Branch exists locally; checking out: ${branchName}`)
        await checkoutBranch(this.repoPath, branchName)
        await this.updateBranchFromOrigin(branchName)
        this.workerBranch = branchName
        return
      }

      // Refresh remote refs for this branch name
      try {
        await fetchOrigin(this.repoPath, branchName)
      } catch {
        // ignore
      }

      // If remote branch exists, create a local tracking branch
      if (await remoteBranchExists(this.repoPath, branchName)) {
        const checkedOutAt = await getWorktreePathForBranch(this.repoPath, branchName)
        if (checkedOutAt && this.normalizePath(checkedOutAt) !== this.normalizePath(this.repoPath)) {
          throw new Error(
            `Branch ${branchName} is already checked out in another worktree: ${checkedOutAt}`
          )
        }
        this.log(`Branch exists on origin; creating local tracking branch: ${branchName}`)
        await createTrackingBranch(this.repoPath, branchName)
        await this.updateBranchFromOrigin(branchName)
        this.workerBranch = branchName
        return
      }

      // Checkout base branch and pull
      await checkoutBranch(this.repoPath, baseBranch)
      await execFileAsync('git', ['pull', 'origin', baseBranch], {
        cwd: this.repoPath,
        env: getGitEnv()
      })
      this.baseHeadSha = await getHeadSha(this.repoPath)

      // Create and checkout new branch
      await gitCreateBranch(this.repoPath, branchName)
      this.workerBranch = branchName
    } catch (error) {
      this.log(`Branch creation warning: ${error}`)
      throw error
    }
  }

  /**
   * Update branch from origin.
   */
  async updateBranchFromOrigin(branchName: string): Promise<void> {
    // Avoid disruptive pulls if the working tree is dirty
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: this.repoPath,
        env: getGitEnv()
      })
      if (stdout.trim()) {
        this.log('Skipping branch update: working tree not clean')
        return
      }
    } catch {
      // ignore
    }

    // Fetch remote ref for the branch
    try {
      await fetchOrigin(this.repoPath, branchName)
    } catch {
      // ignore
    }

    // If the remote branch exists, pull/rebase
    if (!(await remoteBranchExists(this.repoPath, branchName))) return

    try {
      await pullRebase(this.repoPath, branchName)
      this.log(`Updated branch from origin/${branchName}`)
    } catch (error) {
      this.log(`Branch update warning: ${error}`)
      throw error
    }
  }

  /**
   * Pull the base branch to get latest changes.
   */
  async pullBaseBranch(): Promise<void> {
    const baseBranch = await this.fetchBaseBranch()

    // Refresh remote refs for the base branch
    try {
      await fetchOrigin(this.repoPath, baseBranch)
    } catch (error) {
      this.log(`Base branch fetch warning: ${error}`)
    }

    // Avoid switching branches if working tree has uncommitted changes
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: this.repoPath,
        env: getGitEnv()
      })
      if (stdout.trim()) {
        this.log('Skipping base branch pull: working tree not clean')
        return
      }
    } catch (error) {
      this.log(`Base branch status warning: ${error}`)
      return
    }

    if (!this.startingBranch) {
      this.startingBranch = await getCurrentBranch(this.repoPath)
    }

    // Check out the base branch and pull latest
    try {
      await checkoutBranch(this.repoPath, baseBranch)
    } catch {
      try {
        await createTrackingBranch(this.repoPath, baseBranch)
      } catch (error) {
        this.log(`Base branch checkout warning: ${error}`)
        return
      }
    }

    try {
      await pullRebase(this.repoPath, baseBranch)
      this.log(`Updated base branch from origin/${baseBranch}`)
    } catch (error) {
      this.log(`Base branch pull warning: ${error}`)
    } finally {
      if (this.startingBranch && this.startingBranch !== baseBranch) {
        try {
          await checkoutBranch(this.repoPath, this.startingBranch)
        } catch (error) {
          this.log(`Return to starting branch warning: ${error}`)
        }
      }
    }
  }

  /**
   * Fetch latest from remote.
   */
  async fetchLatest(): Promise<void> {
    await this.pullBaseBranch()

    try {
      await fetchOrigin(this.repoPath)
    } catch (error) {
      this.log(`Fetch warning: ${error}`)
    }
  }

  /**
   * Rollback worker changes (used on cancel).
   */
  async rollbackWorkerChanges(): Promise<void> {
    if (!this.workerBranch) return

    this.log('Rollback enabled: reverting worker changes')

    try {
      if (this.baseHeadSha) {
        await resetHard(this.repoPath, this.baseHeadSha)
      } else {
        await resetHard(this.repoPath)
      }
    } catch (error) {
      this.log(`Rollback warning: reset failed: ${error}`)
    }

    const targetBranch = this.startingBranch || this.baseBranch || 'main'
    try {
      await checkoutBranch(this.repoPath, targetBranch)
    } catch (error) {
      this.log(`Rollback warning: checkout failed: ${error}`)
    }

    try {
      if (this.workerBranch !== targetBranch) {
        await deleteBranch(this.repoPath, this.workerBranch)
      }
    } catch (error) {
      this.log(`Rollback warning: branch delete failed: ${error}`)
    }
  }

  // ==================== Helpers ====================

  private normalizePath(p: string): string {
    const resolved = resolve(p)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
}
