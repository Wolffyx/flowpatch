import { execSync, spawnSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import path from 'path'
import type { WorktreeRoot } from '../../shared/types'

export interface WorktreeInfo {
  worktreePath: string
  headSha: string
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  prunable: boolean
}

export interface EnsureWorktreeResult {
  worktreePath: string
  branchName: string
  created: boolean
}

export interface WorktreeConfig {
  root: WorktreeRoot
  customPath?: string
}

/**
 * Manages git worktrees for isolated card processing.
 * All git operations use `git -C <path>` to avoid changing the current directory.
 */
export class GitWorktreeManager {
  constructor(private repoPath: string) {}

  /**
   * Execute a git command in the repo directory.
   * Returns stdout on success, throws on failure.
   */
  private git(args: string, options?: { cwd?: string }): string {
    const cwd = options?.cwd ?? this.repoPath
    try {
      const result = execSync(`git -C "${cwd}" ${args}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      return result.trim()
    } catch (err: unknown) {
      const error = err as { stderr?: Buffer | string; message?: string }
      const stderr = error.stderr?.toString() ?? error.message ?? 'Unknown git error'
      throw new Error(`Git command failed: git ${args}\n${stderr}`)
    }
  }

  /**
   * Check if git worktree feature is available (git >= 2.17.0)
   */
  checkWorktreeSupport(): boolean {
    try {
      const version = this.git('--version')
      const match = version.match(/git version (\d+)\.(\d+)/)
      if (!match) return false
      const major = parseInt(match[1], 10)
      const minor = parseInt(match[2], 10)
      return major > 2 || (major === 2 && minor >= 17)
    } catch {
      return false
    }
  }

  /**
   * List all worktrees using `git worktree list --porcelain`.
   * Parses the porcelain output format.
   */
  list(): WorktreeInfo[] {
    try {
      const output = this.git('worktree list --porcelain')
      return this.parsePorcelainOutput(output)
    } catch {
      return []
    }
  }

  /**
   * Parse the porcelain output from `git worktree list --porcelain`.
   * Format:
   *   worktree /path/to/worktree
   *   HEAD abc123
   *   branch refs/heads/main
   *   (empty line separates entries)
   */
  private parsePorcelainOutput(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = []
    const entries = output.split('\n\n').filter((e) => e.trim())

    for (const entry of entries) {
      const lines = entry.split('\n')
      const info: Partial<WorktreeInfo> = {
        bare: false,
        detached: false,
        locked: false,
        prunable: false
      }

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          info.worktreePath = line.slice(9)
        } else if (line.startsWith('HEAD ')) {
          info.headSha = line.slice(5)
        } else if (line.startsWith('branch ')) {
          // Convert refs/heads/foo to just foo
          info.branch = line.slice(7).replace(/^refs\/heads\//, '')
        } else if (line === 'bare') {
          info.bare = true
        } else if (line === 'detached') {
          info.detached = true
        } else if (line.startsWith('locked')) {
          info.locked = true
        } else if (line.startsWith('prunable')) {
          info.prunable = true
        }
      }

      if (info.worktreePath && info.headSha) {
        worktrees.push(info as WorktreeInfo)
      }
    }

    return worktrees
  }

  /**
   * Get the default branch name (main, master, or develop).
   */
  getDefaultBranch(): string {
    try {
      // Try to get the default branch from remote
      const remoteHead = this.git('symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo ""')
      if (remoteHead) {
        return remoteHead.replace(/^refs\/remotes\/origin\//, '')
      }
    } catch {
      // Ignore errors
    }

    // Try common branch names
    const candidates = ['main', 'master', 'develop']
    for (const branch of candidates) {
      try {
        this.git(`rev-parse --verify refs/heads/${branch}`)
        return branch
      } catch {
        // Branch doesn't exist, try next
      }
    }

    return 'main' // Default fallback
  }

  /**
   * Fetch from remote to ensure we have latest refs.
   */
  fetch(remote: string = 'origin'): void {
    this.git(`fetch ${remote} --prune`)
  }

  /**
   * Get the worktree root directory based on configuration.
   */
  getWorktreeRoot(config: WorktreeConfig): string {
    switch (config.root) {
      case 'repo':
        return path.join(this.repoPath, '.patchwork-worktrees')
      case 'sibling':
        return path.join(
          path.dirname(this.repoPath),
          `${path.basename(this.repoPath)}-worktrees`
        )
      case 'custom':
        if (!config.customPath) {
          throw new Error('Custom worktree path not configured')
        }
        return config.customPath
      default:
        return path.join(this.repoPath, '.patchwork-worktrees')
    }
  }

  /**
   * Compute the full worktree path for a branch.
   */
  computeWorktreePath(branchName: string, config: WorktreeConfig): string {
    const root = this.getWorktreeRoot(config)
    // Use the branch name (without prefix) as the folder name, sanitized
    const folderName = branchName
      .replace(/^patchwork\//, '')
      .replace(/[^a-zA-Z0-9-]/g, '-')
    return path.join(root, folderName)
  }

  /**
   * Validate that a path is a safe worktree location.
   * Only allows paths under configured worktree roots.
   */
  isValidWorktreePath(worktreePath: string, config: WorktreeConfig): boolean {
    const resolved = path.resolve(worktreePath)
    const repoResolved = path.resolve(this.repoPath)

    // Must not be the main repo
    if (resolved === repoResolved) {
      return false
    }

    // Must not be a parent of the repo
    if (repoResolved.startsWith(resolved + path.sep)) {
      return false
    }

    // Get allowed root
    const allowedRoot = path.resolve(this.getWorktreeRoot(config))

    // Must be under the allowed root
    return resolved.startsWith(allowedRoot + path.sep) || resolved === allowedRoot
  }

  /**
   * Check if a branch exists locally or remotely.
   */
  branchExists(branchName: string): { local: boolean; remote: boolean } {
    let local = false
    let remote = false

    try {
      this.git(`rev-parse --verify refs/heads/${branchName}`)
      local = true
    } catch {
      // Branch doesn't exist locally
    }

    try {
      this.git(`rev-parse --verify refs/remotes/origin/${branchName}`)
      remote = true
    } catch {
      // Branch doesn't exist on remote
    }

    return { local, remote }
  }

  /**
   * Check if a worktree already exists at the given path.
   */
  worktreeExistsAtPath(worktreePath: string): boolean {
    const worktrees = this.list()
    return worktrees.some((wt) => path.resolve(wt.worktreePath) === path.resolve(worktreePath))
  }

  /**
   * Ensure a worktree exists for the given branch.
   * Creates the branch and worktree if they don't exist.
   */
  async ensureWorktree(
    worktreePath: string,
    branchName: string,
    baseBranch: string,
    options?: {
      fetchFirst?: boolean
      force?: boolean
      config: WorktreeConfig
    }
  ): Promise<EnsureWorktreeResult> {
    const config = options?.config ?? { root: 'repo' }

    // Validate path safety
    if (!this.isValidWorktreePath(worktreePath, config)) {
      throw new Error(`Invalid worktree path: ${worktreePath}. Must be under worktree root.`)
    }

    // Fetch if requested
    if (options?.fetchFirst) {
      try {
        this.fetch()
      } catch (err) {
        console.warn('Failed to fetch, continuing with local refs:', err)
      }
    }

    // Check if worktree already exists at this path
    if (this.worktreeExistsAtPath(worktreePath)) {
      // Verify it's for the right branch
      const existing = this.list().find(
        (wt) => path.resolve(wt.worktreePath) === path.resolve(worktreePath)
      )
      if (existing && existing.branch === branchName) {
        return { worktreePath, branchName, created: false }
      }
      if (options?.force) {
        await this.removeWorktree(worktreePath, { force: true, config })
      } else {
        throw new Error(`Worktree already exists at ${worktreePath} for different branch`)
      }
    }

    // Check if branch exists
    const { local, remote } = this.branchExists(branchName)

    // Determine the base ref
    let baseRef = `origin/${baseBranch}`
    try {
      this.git(`rev-parse --verify ${baseRef}`)
    } catch {
      // Remote branch doesn't exist, try local
      baseRef = baseBranch
      try {
        this.git(`rev-parse --verify ${baseRef}`)
      } catch {
        throw new Error(`Base branch ${baseBranch} not found locally or on remote`)
      }
    }

    if (local) {
      // Branch exists locally, create worktree for it
      this.git(`worktree add "${worktreePath}" ${branchName}`)
    } else if (remote) {
      // Branch exists on remote, create tracking branch with worktree
      this.git(`worktree add --track -b ${branchName} "${worktreePath}" origin/${branchName}`)
    } else {
      // Branch doesn't exist, create new branch from base
      this.git(`worktree add -b ${branchName} "${worktreePath}" ${baseRef}`)
    }

    return { worktreePath, branchName, created: true }
  }

  /**
   * Check if a worktree is dirty (has uncommitted changes).
   */
  isDirty(worktreePath: string): boolean {
    try {
      const status = this.git('status --porcelain', { cwd: worktreePath })
      return status.length > 0
    } catch {
      return false
    }
  }

  /**
   * Remove a worktree safely.
   * Verifies the path is valid before removal.
   */
  async removeWorktree(
    worktreePath: string,
    options?: {
      force?: boolean
      config?: WorktreeConfig
    }
  ): Promise<void> {
    const config = options?.config ?? { root: 'repo' }

    // Validate path is safe
    if (!this.isValidWorktreePath(worktreePath, config)) {
      throw new Error(`Refusing to remove path outside allowed worktree root: ${worktreePath}`)
    }

    // Verify it's an actual worktree
    const worktrees = this.list()
    const match = worktrees.find(
      (wt) => path.resolve(wt.worktreePath) === path.resolve(worktreePath)
    )

    if (!match) {
      // Not a registered worktree, but might be a leftover directory
      // Only remove if it's under our worktree root and is empty/safe
      if (existsSync(worktreePath)) {
        // Just remove the directory since it's not a git worktree
        rmSync(worktreePath, { recursive: true, force: true })
      }
      return
    }

    // Remove via git worktree command
    const forceFlag = options?.force ? '--force' : ''
    try {
      this.git(`worktree remove ${forceFlag} "${worktreePath}"`)
    } catch (err) {
      if (options?.force) {
        // Force remove failed, try manual cleanup
        rmSync(worktreePath, { recursive: true, force: true })
        this.prune()
      } else {
        throw err
      }
    }
  }

  /**
   * Prune stale worktree entries.
   */
  prune(): void {
    this.git('worktree prune')
  }

  /**
   * Delete a branch (local only, not remote).
   */
  deleteBranch(branchName: string, force: boolean = false): boolean {
    try {
      const flag = force ? '-D' : '-d'
      this.git(`branch ${flag} ${branchName}`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the current HEAD SHA of a worktree.
   */
  getHeadSha(worktreePath: string): string {
    return this.git('rev-parse HEAD', { cwd: worktreePath })
  }

  /**
   * Get the current branch of a worktree.
   */
  getCurrentBranch(worktreePath: string): string | null {
    try {
      const ref = this.git('symbolic-ref --short HEAD', { cwd: worktreePath })
      return ref || null
    } catch {
      return null // Detached HEAD
    }
  }
}
