import { execFileSync } from 'child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import type { WorktreeRoot } from '../../shared/types'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

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

  private normalizePath(p: string): string {
    const resolved = path.resolve(p)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }

  /**
   * Execute a git command in the repo directory.
   * Uses execFileSync with array arguments to prevent shell injection.
   * Returns stdout on success, throws on failure.
   */
  private git(args: string[], options?: { cwd?: string; retry?: boolean }): string {
    const cwd = options?.cwd ?? this.repoPath
    const shouldRetry = options?.retry ?? false
    const fullArgs = ['-C', cwd, ...args]

    let lastError: Error | null = null
    const attempts = shouldRetry ? MAX_RETRIES : 1

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = execFileSync('git', fullArgs, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        })
        return result.trim()
      } catch (err: unknown) {
        const error = err as { stderr?: Buffer | string; message?: string }
        const stderr = error.stderr?.toString() ?? error.message ?? 'Unknown git error'
        lastError = new Error(`Git command failed: git ${args.join(' ')}\n${stderr}`)

        if (attempt < attempts) {
          // Wait before retrying (synchronous delay)
          const start = Date.now()
          while (Date.now() - start < RETRY_DELAY_MS) {
            // Busy wait - not ideal but necessary for sync function
          }
        }
      }
    }

    throw lastError!
  }

  /**
   * Check if git worktree feature is available (git >= 2.17.0)
   */
  checkWorktreeSupport(): boolean {
    try {
      const version = this.git(['--version'])
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
      const output = this.git(['worktree', 'list', '--porcelain'])
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
    // Try to get the default branch from remote (cross-platform; no shell redirection)
    try {
      const remoteHead = this.git(['symbolic-ref', 'refs/remotes/origin/HEAD'])
      if (remoteHead) return remoteHead.replace(/^refs\/remotes\/origin\//, '')
    } catch {}

    // Try common branch names
    const candidates = ['main', 'master', 'develop']
    for (const branch of candidates) {
      try {
        this.git(['rev-parse', '--verify', `refs/heads/${branch}`])
        return branch
      } catch {
        // Branch doesn't exist, try next
      }
    }

    return 'main' // Default fallback
  }

  /**
   * Fetch from remote to ensure we have latest refs.
   * Uses retry logic for network operations.
   */
  fetch(remote: string = 'origin'): void {
    this.git(['fetch', remote, '--prune'], { retry: true })
  }

  /**
   * Get the worktree root directory based on configuration.
   */
  getWorktreeRoot(config: WorktreeConfig): string {
    switch (config.root) {
      case 'repo':
        return path.join(this.repoPath, '.patchwork-worktrees')
      case 'sibling':
        return path.join(path.dirname(this.repoPath), `${path.basename(this.repoPath)}-worktrees`)
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
    const folderName = branchName.replace(/^patchwork\//, '').replace(/[^a-zA-Z0-9-]/g, '-')
    return path.join(root, folderName)
  }

  /**
   * Validate that a path is a safe worktree location.
   * Only allows paths under configured worktree roots.
   */
  isValidWorktreePath(worktreePath: string, config: WorktreeConfig): boolean {
    const resolved = this.normalizePath(worktreePath)
    const repoResolved = this.normalizePath(this.repoPath)

    // Must not be the main repo
    if (resolved === repoResolved) {
      return false
    }

    // Must not be a parent of the repo
    if (repoResolved.startsWith(resolved + path.sep)) {
      return false
    }

    // Get allowed root
    const allowedRoot = this.normalizePath(this.getWorktreeRoot(config))

    // Never operate on the root itself; only subfolders under it.
    if (resolved === allowedRoot) {
      return false
    }

    // Must be under the allowed root
    return resolved.startsWith(allowedRoot + path.sep)
  }

  /**
   * Check if a branch exists locally or remotely.
   */
  branchExists(branchName: string): { local: boolean; remote: boolean } {
    let local = false
    let remote = false

    try {
      this.git(['rev-parse', '--verify', `refs/heads/${branchName}`])
      local = true
    } catch {
      // Branch doesn't exist locally
    }

    try {
      this.git(['rev-parse', '--verify', `refs/remotes/origin/${branchName}`])
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
    const target = this.normalizePath(worktreePath)
    return worktrees.some((wt) => this.normalizePath(wt.worktreePath) === target)
  }

  private isWorktreeDirectory(p: string): boolean {
    try {
      const gitPath = path.join(p, '.git')
      if (!existsSync(gitPath)) return false
      // In worktrees, `.git` is usually a file containing "gitdir: ..."
      // In rare cases it may be a directory; accept either.
      return true
    } catch {
      return false
    }
  }

  private isEmptyDirectory(p: string): boolean {
    try {
      const entries = readdirSync(p)
      return entries.length === 0
    } catch {
      return false
    }
  }

  private tryWriteMarker(worktreePath: string): void {
    try {
      writeFileSync(path.join(worktreePath, '.patchwork-worktree'), 'managed\n', {
        encoding: 'utf-8'
      })
    } catch {
      // best-effort
    }
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

    // If branch is already checked out in another worktree, keep the path deterministic:
    // only reuse if it matches the requested path, otherwise fail fast with a clear error.
    const existingByBranch = this.list().find((wt) => wt.branch === branchName)
    if (existingByBranch) {
      const existingPath = this.normalizePath(existingByBranch.worktreePath)
      const requestedPath = this.normalizePath(worktreePath)
      if (existingPath === requestedPath) {
        this.tryWriteMarker(worktreePath)
        return { worktreePath, branchName, created: false }
      }
      throw new Error(
        `Branch ${branchName} is already checked out in another worktree: ${existingByBranch.worktreePath}`
      )
    }

    // Check if worktree already exists at this path
    if (this.worktreeExistsAtPath(worktreePath)) {
      // Verify it's for the right branch
      const existing = this.list().find(
        (wt) => this.normalizePath(wt.worktreePath) === this.normalizePath(worktreePath)
      )
      if (existing && existing.branch === branchName) {
        this.tryWriteMarker(worktreePath)
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
      this.git(['rev-parse', '--verify', baseRef])
    } catch {
      // Remote branch doesn't exist, try local
      baseRef = baseBranch
      try {
        this.git(['rev-parse', '--verify', baseRef])
      } catch {
        throw new Error(`Base branch ${baseBranch} not found locally or on remote`)
      }
    }

    if (local) {
      // Branch exists locally, create worktree for it
      this.git(['worktree', 'add', worktreePath, branchName])
    } else if (remote) {
      // Branch exists on remote, create tracking branch with worktree
      this.git([
        'worktree',
        'add',
        '--track',
        '-b',
        branchName,
        worktreePath,
        `origin/${branchName}`
      ])
    } else {
      // Branch doesn't exist, create new branch from base
      this.git(['worktree', 'add', '-b', branchName, worktreePath, baseRef])
    }

    this.tryWriteMarker(worktreePath)
    return { worktreePath, branchName, created: true }
  }

  /**
   * Check if a worktree is dirty (has uncommitted changes).
   */
  isDirty(worktreePath: string): boolean {
    try {
      const status = this.git(['status', '--porcelain'], { cwd: worktreePath })
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
      (wt) => this.normalizePath(wt.worktreePath) === this.normalizePath(worktreePath)
    )

    if (!match) {
      // Not a registered worktree, but might be a leftover directory
      if (existsSync(worktreePath)) {
        // Only remove if it looks like a worktree (has `.git`) or is empty.
        const stats = lstatSync(worktreePath)
        if (stats.isSymbolicLink()) {
          throw new Error(`Refusing to remove symlink path: ${worktreePath}`)
        }
        if (!stats.isDirectory()) {
          throw new Error(`Refusing to remove non-directory path: ${worktreePath}`)
        }
        if (this.isWorktreeDirectory(worktreePath) || this.isEmptyDirectory(worktreePath)) {
          rmSync(worktreePath, { recursive: true, force: true })
        } else {
          throw new Error(
            `Refusing to remove untracked non-empty directory (not a worktree): ${worktreePath}`
          )
        }
      }
      return
    }

    // Remove via git worktree command
    const args = ['worktree', 'remove']
    if (options?.force) {
      args.push('--force')
    }
    args.push(worktreePath)

    try {
      this.git(args)
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
    this.git(['worktree', 'prune'])
  }

  /**
   * Delete a branch (local only, not remote).
   */
  deleteBranch(branchName: string, force: boolean = false): boolean {
    try {
      const flag = force ? '-D' : '-d'
      this.git(['branch', flag, branchName])
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the current HEAD SHA of a worktree.
   */
  getHeadSha(worktreePath: string): string {
    return this.git(['rev-parse', 'HEAD'], { cwd: worktreePath })
  }

  /**
   * Get the current branch of a worktree.
   */
  getCurrentBranch(worktreePath: string): string | null {
    try {
      const ref = this.git(['symbolic-ref', '--short', 'HEAD'], { cwd: worktreePath })
      return ref || null
    } catch {
      return null // Detached HEAD
    }
  }

  /**
   * Verify that a worktree is healthy (exists on disk with correct branch).
   */
  verifyWorktree(
    worktreePath: string,
    expectedBranch?: string
  ): {
    exists: boolean
    healthy: boolean
    branch: string | null
    error?: string
  } {
    // Check if path exists
    if (!existsSync(worktreePath)) {
      return { exists: false, healthy: false, branch: null, error: 'Worktree path does not exist' }
    }

    // Check if it's a valid worktree directory
    if (!this.isWorktreeDirectory(worktreePath)) {
      return {
        exists: true,
        healthy: false,
        branch: null,
        error: 'Path exists but is not a worktree'
      }
    }

    // Verify git recognizes it as a worktree
    const worktrees = this.list()
    const match = worktrees.find(
      (wt) => this.normalizePath(wt.worktreePath) === this.normalizePath(worktreePath)
    )

    if (!match) {
      return {
        exists: true,
        healthy: false,
        branch: null,
        error: 'Directory exists but not registered as worktree'
      }
    }

    // Get current branch
    const branch = this.getCurrentBranch(worktreePath)

    // Verify branch matches if expected
    if (expectedBranch && branch !== expectedBranch) {
      return {
        exists: true,
        healthy: false,
        branch,
        error: `Branch mismatch: expected ${expectedBranch}, got ${branch}`
      }
    }

    return { exists: true, healthy: true, branch }
  }

  /**
   * Check if a worktree has the .patchwork-worktree marker file.
   */
  isPatchworkWorktree(worktreePath: string): boolean {
    try {
      const markerPath = path.join(worktreePath, '.patchwork-worktree')
      if (!existsSync(markerPath)) return false
      const content = readFileSync(markerPath, 'utf-8')
      return content.trim() === 'managed'
    } catch {
      return false
    }
  }
}
