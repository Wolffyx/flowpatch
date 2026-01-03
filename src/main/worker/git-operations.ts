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
