import { execFile } from 'child_process'
import { promisify } from 'util'
import { URL } from 'url'
import type { GitAuthMode, GitAuthState } from '@shared/types'
import { getGitEnv } from '../worker/git-operations'

const execFileAsync = promisify(execFile)

function safeParseUrl(remote: string | null): { protocol: 'ssh' | 'https' | 'unknown'; host: string | null } {
  if (!remote) return { protocol: 'unknown', host: null }
  if (remote.startsWith('git@') || remote.startsWith('ssh://')) return { protocol: 'ssh', host: remote.split('@')[1]?.split(':')[0] ?? null }
  if (remote.startsWith('https://') || remote.startsWith('http://')) {
    try {
      const u = new URL(remote)
      return { protocol: 'https', host: u.hostname }
    } catch {
      return { protocol: 'unknown', host: null }
    }
  }
  return { protocol: 'unknown', host: null }
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, env: getGitEnv() })
  return stdout.toString().trim()
}

async function hasCredentialHelper(cwd: string): Promise<boolean> {
  try {
    const helpers = await git(['config', '--get-all', 'credential.helper'], cwd)
    return helpers.split('\n').filter(Boolean).length > 0
  } catch {
    return false
  }
}

async function checkGhAuth(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['auth', 'status', '--show-token'], { env: getGitEnv() })
    return true
  } catch {
    return false
  }
}

async function checkGlabAuth(): Promise<boolean> {
  try {
    await execFileAsync('glab', ['auth', 'status'], { env: getGitEnv() })
    return true
  } catch {
    return false
  }
}

async function checkSsh(host: string | null): Promise<boolean> {
  if (!host) return false
  try {
    await execFileAsync('ssh', ['-T', '-o', 'BatchMode=yes', `git@${host}`], {
      env: getGitEnv(),
      timeout: 5000
    })
    return true
  } catch {
    return false
  }
}

export async function getRemoteUrl(cwd: string): Promise<string | null> {
  try {
    return await git(['remote', 'get-url', 'origin'], cwd)
  } catch {
    return null
  }
}

export async function detectGitAuthState(cwd: string): Promise<GitAuthState> {
  const remoteUrl = await getRemoteUrl(cwd)
  const parsed = safeParseUrl(remoteUrl)

  const [helper, gh, glab, sshOk] = await Promise.all([
    hasCredentialHelper(cwd),
    checkGhAuth(),
    checkGlabAuth(),
    checkSsh(parsed.host)
  ])

  const warnings: string[] = []
  if (!remoteUrl) warnings.push('No origin remote configured')
  if (parsed.protocol === 'https' && !helper && !gh && !glab) {
    warnings.push('HTTPS remote without credential helper or CLI auth')
  }
  if (parsed.protocol === 'ssh' && !sshOk) {
    warnings.push('SSH remote not reachable with current key')
  }

  return {
    remoteUrl,
    protocol: parsed.protocol,
    host: parsed.host,
    hasCredentialHelper: helper,
    hasGhAuth: gh,
    hasGlabAuth: glab,
    sshOk,
    warnings: warnings.length ? warnings : undefined
  }
}

export function rewriteRemoteToSsh(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null
  if (remoteUrl.startsWith('git@') || remoteUrl.startsWith('ssh://')) return remoteUrl
  try {
    const u = new URL(remoteUrl)
    const path = u.pathname.replace(/^\//, '')
    return `git@${u.hostname}:${path}`
  } catch {
    return null
  }
}

export async function applyPreferredAuth(
  cwd: string,
  mode: GitAuthMode,
  forceSshRewrite?: boolean
): Promise<{ changed: boolean; newUrl?: string; error?: string; state: GitAuthState }> {
  const state = await detectGitAuthState(cwd)
  if (mode === 'ssh' || forceSshRewrite) {
    const sshUrl = rewriteRemoteToSsh(state.remoteUrl)
    if (sshUrl && sshUrl !== state.remoteUrl) {
      try {
        await git(['remote', 'set-url', 'origin', sshUrl], cwd)
        const newState = await detectGitAuthState(cwd)
        return { changed: true, newUrl: sshUrl, state: newState }
      } catch (error) {
        return { changed: false, error: error instanceof Error ? error.message : String(error), state }
      }
    }
  }

  return { changed: false, state }
}
