/**
 * Project identity detection and normalization utilities.
 *
 * This module handles:
 * - Git repository detection
 * - Remote URL parsing (GitHub, GitLab, self-hosted)
 * - Project key computation (repoId vs path-based)
 * - Path normalization for cross-platform consistency
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join, normalize, sep } from 'path'
import type { RemoteInfo } from '@shared/types'

const execFileAsync = promisify(execFile)

// ============================================================================
// Git Command Execution
// ============================================================================

/**
 * Execute a git command in the specified directory.
 */
async function execGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo'
    }
  })
  return stdout
}

// ============================================================================
// Git Repository Detection
// ============================================================================

/**
 * Check if a directory is a git repository.
 * First checks for .git directory, then falls back to git rev-parse.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const dotGit = join(cwd, '.git')
  if (existsSync(dotGit)) return true
  try {
    const out = await execGit(['rev-parse', '--is-inside-work-tree'], cwd)
    return out.trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Get the root directory of a git repository.
 */
export async function getGitRoot(cwd: string): Promise<string | null> {
  try {
    const out = await execGit(['rev-parse', '--show-toplevel'], cwd)
    return out.trim()
  } catch {
    return null
  }
}

// ============================================================================
// Remote Detection and Parsing
// ============================================================================

/**
 * Get all remotes from a git repository.
 */
export async function getGitRemotes(cwd: string): Promise<RemoteInfo[]> {
  try {
    const out = await execGit(['remote', '-v'], cwd)
    const lines = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    const remoteMap = new Map<string, RemoteInfo>()

    for (const l of lines) {
      const m = l.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
      if (m) {
        const name = m[1]
        const url = m[2]
        if (!remoteMap.has(name)) {
          const parsed = parseRemoteUrl(url)
          remoteMap.set(name, {
            name: `${name}:${url}`,
            url,
            provider: parsed.provider,
            repoKey: parsed.repoKey
          })
        }
      }
    }

    return Array.from(remoteMap.values())
  } catch {
    return []
  }
}

/**
 * Parse a git remote URL to extract provider and repo key.
 *
 * Supports:
 * - GitHub HTTPS: https://github.com/owner/repo.git
 * - GitHub SSH: git@github.com:owner/repo.git
 * - GitLab HTTPS: https://gitlab.com/group/repo.git
 * - GitLab SSH: git@gitlab.com:group/repo.git
 * - Self-hosted GitLab: git@my.host:group/repo.git
 *
 * @returns Object with provider ('github' | 'gitlab' | 'unknown') and normalized repoKey
 */
export function parseRemoteUrl(url: string): {
  provider: 'github' | 'gitlab' | 'unknown'
  repoKey: string
} {
  let provider: 'github' | 'gitlab' | 'unknown' = 'unknown'
  let repoKey = ''

  // Remove .git suffix
  const cleanUrl = url.replace(/\.git$/, '')

  // GitHub patterns
  const githubHttps = cleanUrl.match(/https?:\/\/github\.com\/([^/]+\/[^/]+)/)
  const githubSsh = cleanUrl.match(/git@github\.com:([^/]+\/[^/]+)/)

  if (githubHttps) {
    provider = 'github'
    repoKey = `github:${githubHttps[1]}`
  } else if (githubSsh) {
    provider = 'github'
    repoKey = `github:${githubSsh[1]}`
  }

  // GitLab patterns (if not already matched as GitHub)
  if (!repoKey) {
    const gitlabHttps = cleanUrl.match(/https?:\/\/([^/]+)\/(.+)/)
    const gitlabSsh = cleanUrl.match(/git@([^:]+):(.+)/)

    if (gitlabHttps && gitlabHttps[1].includes('gitlab')) {
      provider = 'gitlab'
      repoKey = `gitlab:${gitlabHttps[1]}/${gitlabHttps[2]}`
    } else if (gitlabSsh && gitlabSsh[1].includes('gitlab')) {
      provider = 'gitlab'
      repoKey = `gitlab:${gitlabSsh[1]}/${gitlabSsh[2]}`
    } else if (gitlabHttps) {
      // Assume any other host might be self-hosted
      provider = 'unknown'
      repoKey = `unknown:${gitlabHttps[1]}/${gitlabHttps[2]}`
    } else if (gitlabSsh) {
      provider = 'unknown'
      repoKey = `unknown:${gitlabSsh[1]}/${gitlabSsh[2]}`
    }
  }

  return { provider, repoKey }
}

/**
 * Detect provider from remote URL (simple check).
 */
export function detectProviderFromRemote(url: string): 'auto' | 'github' | 'gitlab' {
  if (url.includes('github.com')) return 'github'
  if (url.includes('gitlab')) return 'gitlab'
  return 'auto'
}

// ============================================================================
// Project Key Computation
// ============================================================================

/**
 * Normalize a file path for consistent project identification.
 *
 * On Windows:
 * - Converts backslashes to forward slashes
 * - Lowercases the drive letter (C: -> c:)
 * - Removes trailing slashes
 *
 * On Unix:
 * - Removes trailing slashes
 */
export function normalizeProjectPath(path: string): string {
  // Normalize path separators and resolve . and ..
  let normalized = normalize(path)

  // Convert to forward slashes for consistency
  normalized = normalized.split(sep).join('/')

  // On Windows, lowercase the drive letter for consistency
  if (process.platform === 'win32' && /^[A-Z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1)
  }

  // Remove trailing slash
  normalized = normalized.replace(/\/$/, '')

  return normalized
}

/**
 * Compute the project key for settings and log storage.
 *
 * If the project has a valid repoId (from git remote), use that.
 * Otherwise, fall back to the normalized path as projectRootKey.
 *
 * @param repoId - The repository ID from remote (e.g., "github:owner/repo")
 * @param projectPath - The local path to the project
 * @returns A stable project key for storage
 */
export function computeProjectKey(repoId: string | null, projectPath: string): string {
  if (repoId && repoId.length > 0) {
    return repoId
  }
  return `path:${normalizeProjectPath(projectPath)}`
}

/**
 * Get the default remote for a repository.
 * Prefers 'origin' if present, otherwise returns the first remote.
 */
export function getDefaultRemote(remotes: RemoteInfo[]): RemoteInfo | null {
  if (remotes.length === 0) return null

  // Prefer origin
  const origin = remotes.find((r) => r.name.startsWith('origin:'))
  if (origin) return origin

  // Fall back to first remote
  return remotes[0]
}

// ============================================================================
// Full Project Identity Detection
// ============================================================================

export interface ProjectIdentity {
  isGit: boolean
  gitRoot: string | null
  remotes: RemoteInfo[]
  defaultRemote: RemoteInfo | null
  repoId: string | null
  projectRootKey: string
  projectKey: string
}

/**
 * Detect full project identity information.
 *
 * @param projectPath - Path to the project directory
 * @returns Complete identity information for the project
 */
export async function detectProjectIdentity(projectPath: string): Promise<ProjectIdentity> {
  const isGit = await isGitRepo(projectPath)
  const projectRootKey = normalizeProjectPath(projectPath)

  if (!isGit) {
    return {
      isGit: false,
      gitRoot: null,
      remotes: [],
      defaultRemote: null,
      repoId: null,
      projectRootKey,
      projectKey: computeProjectKey(null, projectPath)
    }
  }

  const gitRoot = await getGitRoot(projectPath)
  const remotes = await getGitRemotes(projectPath)
  const defaultRemote = getDefaultRemote(remotes)
  const repoId = defaultRemote?.repoKey ?? null

  return {
    isGit: true,
    gitRoot,
    remotes,
    defaultRemote,
    repoId,
    projectRootKey,
    projectKey: computeProjectKey(repoId, projectPath)
  }
}
