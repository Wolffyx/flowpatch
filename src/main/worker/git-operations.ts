/**
 * Git Operations
 *
 * Common git command wrappers for worker operations.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolve } from 'path'

const execFileAsync = promisify(execFile)

export interface GitEnv {
  GIT_TERMINAL_PROMPT: string
  GIT_ASKPASS: string
  [key: string]: string | undefined
}

/**
 * Get environment variables for git commands.
 */
export function getGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: process.env.GIT_ASKPASS || 'echo'
  }
}

/**
 * Normalize a path for comparison.
 */
export function normalizePath(p: string): string {
  const resolved = resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * Execute a git command.
 */
export async function gitExec(
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: env ?? getGitEnv()
  })
  return stdout.toString().trim()
}

/**
 * Fetch from remote.
 */
export async function fetchOrigin(cwd: string, branch?: string): Promise<void> {
  const args = ['fetch', 'origin']
  if (branch) args.push(branch)
  await execFileAsync('git', args, { cwd, env: getGitEnv() })
}

/**
 * Get current branch name.
 */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const result = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    if (!result || result === 'HEAD') return null
    return result
  } catch {
    return null
  }
}

/**
 * Check if a local branch exists.
 */
export async function localBranchExists(cwd: string, branchName: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      cwd
    })
    return true
  } catch {
    return false
  }
}

/**
 * Check if a remote branch exists.
 */
export async function remoteBranchExists(cwd: string, branchName: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`],
      { cwd }
    )
    return true
  } catch {
    return false
  }
}

// ==================== Batch/Parallel Operations ====================

/**
 * Check if both local and remote branches exist in parallel.
 * More efficient than checking sequentially.
 */
export async function checkBranchExists(
  cwd: string,
  branchName: string
): Promise<{ localExists: boolean; remoteExists: boolean }> {
  const [localExists, remoteExists] = await Promise.all([
    localBranchExists(cwd, branchName),
    remoteBranchExists(cwd, branchName)
  ])
  return { localExists, remoteExists }
}

/**
 * Fetch multiple branches from origin in parallel.
 * Errors are caught per-branch and don't fail the entire operation.
 */
export async function fetchBranches(
  cwd: string,
  branches: string[]
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>()

  const fetches = branches.map(async (branch) => {
    try {
      await fetchOrigin(cwd, branch)
      results.set(branch, true)
    } catch {
      results.set(branch, false)
    }
  })

  await Promise.all(fetches)
  return results
}

/**
 * Perform multiple independent git operations in parallel.
 * Each operation returns its result or error.
 */
export async function batchGitOperations<T>(
  operations: Array<() => Promise<T>>
): Promise<Array<{ success: boolean; result?: T; error?: string }>> {
  const results = await Promise.allSettled(operations.map((op) => op()))

  return results.map((result) => {
    if (result.status === 'fulfilled') {
      return { success: true, result: result.value }
    } else {
      return {
        success: false,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      }
    }
  })
}

/**
 * Combined fetch and branch check for efficiency.
 * Fetches the branch first, then checks local/remote existence.
 */
export async function fetchAndCheckBranch(
  cwd: string,
  branchName: string
): Promise<{
  fetchSuccess: boolean
  localExists: boolean
  remoteExists: boolean
}> {
  // Fetch first (best effort)
  let fetchSuccess = false
  try {
    await fetchOrigin(cwd, branchName)
    fetchSuccess = true
  } catch {
    // Ignore fetch errors - we'll still check local refs
  }

  // Check existence in parallel
  const { localExists, remoteExists } = await checkBranchExists(cwd, branchName)

  return { fetchSuccess, localExists, remoteExists }
}

/**
 * Get repository state info in a single batch.
 * More efficient than multiple sequential calls.
 */
export async function getRepoState(cwd: string): Promise<{
  currentBranch: string | null
  isClean: boolean
  headSha: string | null
}> {
  const [currentBranch, status, headSha] = await Promise.all([
    getCurrentBranch(cwd),
    getWorkingTreeStatus(cwd),
    getHeadSha(cwd)
  ])

  return {
    currentBranch,
    isClean: status === '',
    headSha
  }
}

/**
 * Get worktree path for a branch.
 */
export async function getWorktreePathForBranch(
  cwd: string,
  branchName: string
): Promise<string | null> {
  try {
    const stdout = await gitExec(['worktree', 'list', '--porcelain'], cwd)
    const entries = stdout.split(/\r?\n\r?\n/).filter((e) => e.trim())
    for (const entry of entries) {
      const lines = entry.split(/\r?\n/)
      let worktreePath: string | null = null
      let branch: string | null = null
      for (const line of lines) {
        if (line.startsWith('worktree ')) worktreePath = line.slice('worktree '.length).trim()
        if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim()
      }
      if (worktreePath && branch === `refs/heads/${branchName}`) return worktreePath
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get the default branch.
 */
export async function getDefaultBranch(cwd: string): Promise<string> {
  // Try to read default from origin/HEAD
  try {
    const ref = await gitExec(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd)
    if (ref) return ref.replace(/^refs\/remotes\/origin\//, '')
  } catch {
    // ignore
  }

  // Try common branch names
  for (const candidate of ['main', 'master', 'develop']) {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', `refs/heads/${candidate}`], { cwd })
      return candidate
    } catch {
      // ignore
    }
  }

  return 'main'
}

/**
 * Check working tree status.
 */
export async function getWorkingTreeStatus(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd })
  return stdout.toString().trim()
}

/**
 * Check if working tree is clean.
 */
export async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  const status = await getWorkingTreeStatus(cwd)
  return status === ''
}

/**
 * Stash changes.
 */
export async function stashPush(cwd: string, message: string): Promise<void> {
  await execFileAsync('git', ['stash', 'push', '-m', message], { cwd })
}

/**
 * List stashes.
 */
export async function stashList(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['stash', 'list'], { cwd })
  return stdout.toString()
}

/**
 * Apply and drop a stash.
 */
export async function stashApplyDrop(cwd: string, ref: string): Promise<void> {
  await execFileAsync('git', ['stash', 'apply', ref], { cwd })
  await execFileAsync('git', ['stash', 'drop', ref], { cwd })
}

/**
 * Checkout a branch.
 */
export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  await execFileAsync('git', ['checkout', branch], { cwd, env: getGitEnv() })
}

/**
 * Create and checkout a new branch.
 */
export async function createBranch(cwd: string, branch: string): Promise<void> {
  await execFileAsync('git', ['checkout', '-b', branch], { cwd })
}

/**
 * Create a tracking branch.
 */
export async function createTrackingBranch(cwd: string, branch: string): Promise<void> {
  await execFileAsync('git', ['checkout', '--track', '-b', branch, `origin/${branch}`], { cwd })
}

/**
 * Pull from remote with rebase.
 */
export async function pullRebase(cwd: string, branch: string): Promise<void> {
  await execFileAsync('git', ['pull', '--rebase', 'origin', branch], { cwd, env: getGitEnv() })
}

/**
 * Get HEAD SHA.
 */
export async function getHeadSha(cwd: string): Promise<string | null> {
  try {
    return await gitExec(['rev-parse', 'HEAD'], cwd)
  } catch {
    return null
  }
}

/**
 * Reset hard to a commit.
 */
export async function resetHard(cwd: string, ref?: string): Promise<void> {
  const args = ['reset', '--hard']
  if (ref) args.push(ref)
  await execFileAsync('git', args, { cwd })
}

/**
 * Delete a local branch.
 */
export async function deleteBranch(cwd: string, branch: string): Promise<void> {
  await execFileAsync('git', ['branch', '-D', branch], { cwd })
}

/**
 * Stage all changes.
 */
export async function stageAll(cwd: string): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd, env: getGitEnv() })
}

/**
 * Commit staged changes.
 */
export async function commit(cwd: string, message: string): Promise<void> {
  await execFileAsync('git', ['commit', '-m', message], { cwd, env: getGitEnv() })
}

/**
 * Push to remote.
 */
export async function push(cwd: string, branch: string): Promise<void> {
  await execFileAsync('git', ['push', '-u', 'origin', branch], { cwd, env: getGitEnv() })
}

/**
 * Get diff stat against a ref.
 */
export async function getDiffStat(cwd: string, baseRef: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['diff', '--stat', baseRef], { cwd })
  return stdout.toString().trim()
}

/**
 * Get modified files since a ref.
 */
export async function getModifiedFiles(cwd: string, baseRef: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', baseRef], { cwd })
  return stdout
    .toString()
    .trim()
    .split('\n')
    .filter((f) => f.trim())
}

/**
 * Merge a branch into the current branch.
 * Returns true if merge succeeds, false if there are conflicts.
 */
export async function merge(cwd: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge', branch, '--no-edit'], { cwd, env: getGitEnv() })
    return true
  } catch {
    // Check if it's a conflict or other error
    const conflicted = await hasConflicts(cwd)
    if (conflicted) {
      return false
    }
    throw new Error(`Merge failed for branch ${branch}`)
  }
}

/**
 * Check if repository has merge conflicts.
 */
export async function hasConflicts(cwd: string): Promise<boolean> {
  const status = await getWorkingTreeStatus(cwd)
  // UU = both modified, AA = both added, DD = both deleted, UD/DU = one deleted
  return /^(UU|AA|DD|UD|DU) /m.test(status)
}

/**
 * Get list of files with conflicts.
 */
export async function getConflictFiles(cwd: string): Promise<string[]> {
  const status = await getWorkingTreeStatus(cwd)
  const lines = status.split('\n')
  const conflicted: string[] = []
  for (const line of lines) {
    if (/^(UU|AA|DD|UD|DU) /.test(line)) {
      // Format is "XY filename" where XY is the status code
      conflicted.push(line.slice(3).trim())
    }
  }
  return conflicted
}

/**
 * Abort an in-progress merge.
 */
export async function abortMerge(cwd: string): Promise<void> {
  try {
    await execFileAsync('git', ['merge', '--abort'], { cwd })
  } catch {
    // Merge may not be in progress, ignore
  }
}

/**
 * Stage a single file.
 */
export async function stageFile(cwd: string, filePath: string): Promise<void> {
  await execFileAsync('git', ['add', filePath], { cwd, env: getGitEnv() })
}

/**
 * Complete a merge after resolving conflicts.
 */
export async function completeMerge(cwd: string, message: string): Promise<void> {
  await execFileAsync('git', ['commit', '-m', message], { cwd, env: getGitEnv() })
}

// ==================== Class-Based API ====================

/**
 * Class-based wrapper for git operations.
 * Provides an object-oriented alternative to the function-based API.
 */
export class GitOperations {
  private cwd: string

  constructor(cwd: string) {
    this.cwd = cwd
  }

  /**
   * Get the working directory.
   */
  getWorkingDirectory(): string {
    return this.cwd
  }

  // ==================== Basic Operations ====================

  async exec(args: string[]): Promise<string> {
    return gitExec(args, this.cwd)
  }

  async fetchOrigin(branch?: string): Promise<void> {
    return fetchOrigin(this.cwd, branch)
  }

  async getCurrentBranch(): Promise<string | null> {
    return getCurrentBranch(this.cwd)
  }

  async getDefaultBranch(): Promise<string> {
    return getDefaultBranch(this.cwd)
  }

  async getHeadSha(): Promise<string | null> {
    return getHeadSha(this.cwd)
  }

  // ==================== Branch Operations ====================

  async localBranchExists(branchName: string): Promise<boolean> {
    return localBranchExists(this.cwd, branchName)
  }

  async remoteBranchExists(branchName: string): Promise<boolean> {
    return remoteBranchExists(this.cwd, branchName)
  }

  async checkBranchExists(branchName: string): Promise<{ localExists: boolean; remoteExists: boolean }> {
    return checkBranchExists(this.cwd, branchName)
  }

  async checkoutBranch(branch: string): Promise<void> {
    return checkoutBranch(this.cwd, branch)
  }

  async createBranch(branch: string): Promise<void> {
    return createBranch(this.cwd, branch)
  }

  async createTrackingBranch(branch: string): Promise<void> {
    return createTrackingBranch(this.cwd, branch)
  }

  async deleteBranch(branch: string): Promise<void> {
    return deleteBranch(this.cwd, branch)
  }

  async pullRebase(branch: string): Promise<void> {
    return pullRebase(this.cwd, branch)
  }

  async getWorktreePathForBranch(branchName: string): Promise<string | null> {
    return getWorktreePathForBranch(this.cwd, branchName)
  }

  // ==================== Working Tree Operations ====================

  async getWorkingTreeStatus(): Promise<string> {
    return getWorkingTreeStatus(this.cwd)
  }

  async isWorkingTreeClean(): Promise<boolean> {
    return isWorkingTreeClean(this.cwd)
  }

  async stashPush(message: string): Promise<void> {
    return stashPush(this.cwd, message)
  }

  async stashList(): Promise<string> {
    return stashList(this.cwd)
  }

  async stashApplyDrop(ref: string): Promise<void> {
    return stashApplyDrop(this.cwd, ref)
  }

  async resetHard(ref?: string): Promise<void> {
    return resetHard(this.cwd, ref)
  }

  // ==================== Staging & Committing ====================

  async stageAll(): Promise<void> {
    return stageAll(this.cwd)
  }

  async stageFile(filePath: string): Promise<void> {
    return stageFile(this.cwd, filePath)
  }

  async commit(message: string): Promise<void> {
    return commit(this.cwd, message)
  }

  async push(branch: string): Promise<void> {
    return push(this.cwd, branch)
  }

  // ==================== Diff Operations ====================

  async getDiffStat(baseRef: string): Promise<string> {
    return getDiffStat(this.cwd, baseRef)
  }

  async getModifiedFiles(baseRef: string): Promise<string[]> {
    return getModifiedFiles(this.cwd, baseRef)
  }

  // ==================== Merge Operations ====================

  async merge(branch: string): Promise<boolean> {
    return merge(this.cwd, branch)
  }

  async hasConflicts(): Promise<boolean> {
    return hasConflicts(this.cwd)
  }

  async getConflictFiles(): Promise<string[]> {
    return getConflictFiles(this.cwd)
  }

  async abortMerge(): Promise<void> {
    return abortMerge(this.cwd)
  }

  async completeMerge(message: string): Promise<void> {
    return completeMerge(this.cwd, message)
  }

  // ==================== Batch Operations ====================

  async fetchBranches(branches: string[]): Promise<Map<string, boolean>> {
    return fetchBranches(this.cwd, branches)
  }

  async getRepoState(): Promise<{
    currentBranch: string | null
    isClean: boolean
    headSha: string | null
  }> {
    return getRepoState(this.cwd)
  }

  async fetchAndCheckBranch(branchName: string): Promise<{
    fetchSuccess: boolean
    localExists: boolean
    remoteExists: boolean
  }> {
    return fetchAndCheckBranch(this.cwd, branchName)
  }
}
