/**
 * Git URL parsing and remote detection utilities.
 */

export type GitProvider = 'github' | 'gitlab' | 'unknown'

export interface ParsedRemoteUrl {
  provider: GitProvider
  repoKey: string
  owner?: string
  repo?: string
  host?: string
}

/**
 * Parse a git remote URL and extract provider information.
 * Supports GitHub and GitLab (including self-hosted).
 *
 * @example
 * parseRemoteUrl('https://github.com/owner/repo.git')
 * // { provider: 'github', repoKey: 'github:owner/repo', owner: 'owner', repo: 'repo' }
 *
 * parseRemoteUrl('git@gitlab.com:group/repo.git')
 * // { provider: 'gitlab', repoKey: 'gitlab:gitlab.com/group/repo', owner: 'group', repo: 'repo' }
 */
export function parseRemoteUrl(url: string): ParsedRemoteUrl {
  // Remove .git suffix
  const cleanUrl = url.replace(/\.git$/, '')

  // GitHub patterns
  const githubHttps = cleanUrl.match(/https?:\/\/github\.com\/([^/]+)\/([^/]+)/)
  const githubSsh = cleanUrl.match(/git@github\.com:([^/]+)\/([^/]+)/)

  if (githubHttps) {
    return {
      provider: 'github',
      repoKey: `github:${githubHttps[1]}/${githubHttps[2]}`,
      owner: githubHttps[1],
      repo: githubHttps[2]
    }
  }

  if (githubSsh) {
    return {
      provider: 'github',
      repoKey: `github:${githubSsh[1]}/${githubSsh[2]}`,
      owner: githubSsh[1],
      repo: githubSsh[2]
    }
  }

  // GitLab patterns (including self-hosted)
  const gitlabHttps = cleanUrl.match(/https?:\/\/([^/]+)\/(.+)/)
  const gitlabSsh = cleanUrl.match(/git@([^:]+):(.+)/)

  if (gitlabHttps && gitlabHttps[1].includes('gitlab')) {
    const pathParts = gitlabHttps[2].split('/')
    return {
      provider: 'gitlab',
      repoKey: `gitlab:${gitlabHttps[1]}/${gitlabHttps[2]}`,
      host: gitlabHttps[1],
      owner: pathParts.slice(0, -1).join('/'),
      repo: pathParts[pathParts.length - 1]
    }
  }

  if (gitlabSsh && gitlabSsh[1].includes('gitlab')) {
    const pathParts = gitlabSsh[2].split('/')
    return {
      provider: 'gitlab',
      repoKey: `gitlab:${gitlabSsh[1]}/${gitlabSsh[2]}`,
      host: gitlabSsh[1],
      owner: pathParts.slice(0, -1).join('/'),
      repo: pathParts[pathParts.length - 1]
    }
  }

  // Unknown provider - still try to extract info
  if (gitlabHttps) {
    const pathParts = gitlabHttps[2].split('/')
    return {
      provider: 'unknown',
      repoKey: `unknown:${gitlabHttps[1]}/${gitlabHttps[2]}`,
      host: gitlabHttps[1],
      owner: pathParts.slice(0, -1).join('/'),
      repo: pathParts[pathParts.length - 1]
    }
  }

  if (gitlabSsh) {
    const pathParts = gitlabSsh[2].split('/')
    return {
      provider: 'unknown',
      repoKey: `unknown:${gitlabSsh[1]}/${gitlabSsh[2]}`,
      host: gitlabSsh[1],
      owner: pathParts.slice(0, -1).join('/'),
      repo: pathParts[pathParts.length - 1]
    }
  }

  return {
    provider: 'unknown',
    repoKey: `unknown:${cleanUrl}`
  }
}

/**
 * Detect provider from a remote URL string.
 */
export function detectProviderFromRemote(url: string): 'auto' | 'github' | 'gitlab' {
  if (url.includes('github.com')) return 'github'
  if (url.includes('gitlab')) return 'gitlab'
  return 'auto'
}

/**
 * Parse a repo key (e.g., "github:owner/repo") into its components.
 */
export function parseRepoKey(repoKey: string): {
  provider: GitProvider
  path: string
  owner?: string
  repo?: string
} {
  const colonIndex = repoKey.indexOf(':')
  if (colonIndex === -1) {
    return { provider: 'unknown', path: repoKey }
  }

  const provider = repoKey.slice(0, colonIndex) as GitProvider
  const path = repoKey.slice(colonIndex + 1)
  const parts = path.split('/')

  // Handle host-prefixed paths (e.g., "gitlab.com/group/repo")
  if (provider === 'gitlab' && parts.length >= 3) {
    return {
      provider,
      path,
      owner: parts.slice(1, -1).join('/'),
      repo: parts[parts.length - 1]
    }
  }

  // Standard owner/repo format
  if (parts.length >= 2) {
    return {
      provider,
      path,
      owner: parts[0],
      repo: parts[1]
    }
  }

  return { provider, path }
}

/**
 * Check if a repo key is for GitHub.
 */
export function isGitHubRepoKey(repoKey: string | null | undefined): boolean {
  return repoKey?.startsWith('github:') ?? false
}

/**
 * Check if a repo key is for GitLab.
 */
export function isGitLabRepoKey(repoKey: string | null | undefined): boolean {
  return repoKey?.startsWith('gitlab:') ?? false
}
