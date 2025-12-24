/**
 * IPC handlers for repository operations.
 * Handles: openRepo, createRepo, selectDirectory, selectRemote
 */

import { ipcMain, dialog } from 'electron'
import { join } from 'path'
import { userInfo } from 'os'
import { existsSync, readFileSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import YAML from 'yaml'
import { upsertProject, getProject, createEvent, listProjects } from '../../db'
import { parseRemoteUrl, detectProviderFromRemote, generateId, logAction } from '@shared/utils'
import { getDefaultRemote, normalizeProjectPath } from '../../projectIdentity'
import type {
  RemoteInfo,
  OpenRepoResult,
  CreateRepoPayload,
  CreateRepoResult,
  SelectDirectoryResult
} from '@shared/types'

// ============================================================================
// Utility Functions
// ============================================================================

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.toString())
    })
  })
}

function execCli(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.toString())
    })
  })
}

async function isGitRepo(cwd: string): Promise<boolean> {
  const dotGit = join(cwd, '.git')
  if (existsSync(dotGit)) return true
  try {
    const out = await execGit(['rev-parse', '--is-inside-work-tree'], cwd)
    return out.trim() === 'true'
  } catch {
    return false
  }
}

async function getGitRemotes(cwd: string): Promise<RemoteInfo[]> {
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
}

async function getGitConfigValue(cwd: string, key: string): Promise<string | null> {
  try {
    const out = await execGit(['config', '--get', key], cwd)
    const value = out.trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

function safeEmailLocalPart(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return normalized || 'patchwork'
}

function getDefaultGitUserName(): string {
  const envName =
    process.env.GIT_AUTHOR_NAME ||
    process.env.GIT_COMMITTER_NAME ||
    process.env.USERNAME ||
    process.env.USER

  if (envName && envName.trim()) return envName.trim()

  try {
    const osName = userInfo().username
    if (osName && osName.trim()) return osName.trim()
  } catch {
    // ignore
  }

  return 'Patchwork'
}

function getDefaultGitUserEmail(userName: string): string {
  const envEmail = process.env.GIT_AUTHOR_EMAIL || process.env.GIT_COMMITTER_EMAIL
  if (envEmail && envEmail.trim()) return envEmail.trim()

  return `${safeEmailLocalPart(userName)}@localhost`
}

async function ensureGitIdentity(repoPath: string, warnings: string[]): Promise<void> {
  const existingName = await getGitConfigValue(repoPath, 'user.name')
  const existingEmail = await getGitConfigValue(repoPath, 'user.email')

  if (existingName && existingEmail) return

  const userName = existingName || getDefaultGitUserName()
  const userEmail = existingEmail || getDefaultGitUserEmail(userName)

  if (!existingName) {
    await execGit(['config', 'user.name', userName], repoPath)
  }
  if (!existingEmail) {
    await execGit(['config', 'user.email', userEmail], repoPath)
  }

  warnings.push('Git user.name/user.email were missing; configured them locally for this repo.')
}

function readPolicy(repoPath: string): string | null {
  const file = join(repoPath, '.kanban-agent.yml')
  if (!existsSync(file)) return null
  try {
    const txt = readFileSync(file, 'utf-8')
    const obj = YAML.parse(txt)
    return JSON.stringify(obj)
  } catch {
    return null
  }
}

async function openRepoAtPath(repoPath: string): Promise<OpenRepoResult> {
  const isGit = await isGitRepo(repoPath)
  if (!isGit) {
    return { error: 'Selected folder is not a git repository.' }
  }

  const remotes = await getGitRemotes(repoPath)

  const normalizedPath = normalizeProjectPath(repoPath)
  const existing = listProjects().find((p) => normalizeProjectPath(p.local_path) === normalizedPath)

  const id = existing?.id ?? generateId()
  const name = repoPath.split(/[\\/]/).pop() || repoPath
  const policy = readPolicy(repoPath) ?? existing?.policy_json ?? null

  const selectedRemoteName = existing?.selected_remote_name ?? null
  const selectedRemote =
    (selectedRemoteName
      ? remotes.find((r) => r.name.startsWith(`${selectedRemoteName}:`)) ?? null
      : null) ??
    getDefaultRemote(remotes)

  const providerHint =
    existing?.provider_hint && existing.provider_hint !== 'auto'
      ? existing.provider_hint
      : selectedRemote
        ? detectProviderFromRemote(selectedRemote.url)
        : existing?.provider_hint ?? 'auto'

  const project = upsertProject({
    id,
    name,
    local_path: repoPath,
    selected_remote_name:
      existing?.selected_remote_name ?? (selectedRemote ? selectedRemote.name.split(':')[0] : null),
    remote_repo_key: existing?.remote_repo_key ?? (selectedRemote ? selectedRemote.repoKey : null),
    provider_hint: providerHint,
    policy_json: policy
  })

  createEvent(project.id, 'card_created', undefined, { action: 'project_opened' })

  // Auto-configure worktree for autonomous workers
  try {
    const { initializeProjectWorktree } = await import('../../services/project-initializer')
    const initResult = await initializeProjectWorktree(project.id)
    if (initResult.configured) {
      logAction('project:worktreeInitialized', {
        projectId: project.id,
        worktreeRoot: initResult.worktreeRoot,
        maxWorkers: initResult.maxWorkers
      })
    } else if (initResult.error) {
      logAction('project:worktreeInitError', {
        projectId: project.id,
        error: initResult.error
      })
    }
  } catch (error) {
    logAction('project:worktreeInitException', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return {
    project,
    remotes,
    needSelection: false
  }
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerRepoHandlers(): void {
  // Select directory
  ipcMain.handle('selectDirectory', async (): Promise<SelectDirectoryResult> => {
    logAction('selectDirectory:start')
    try {
      const res = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory']
      })
      if (res.canceled || res.filePaths.length === 0) {
        logAction('selectDirectory:canceled')
        return { canceled: true }
      }
      return { path: res.filePaths[0] }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to select directory'
      logAction('selectDirectory:error', { message })
      return { error: message }
    }
  })

  // Open repository
  ipcMain.handle('openRepo', async () => {
    logAction('openRepo:start')
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || res.filePaths.length === 0) {
      logAction('openRepo:canceled')
      return { canceled: true }
    }

    const repoPath = res.filePaths[0]
    const result = await openRepoAtPath(repoPath)
    if (result.error) {
      logAction('openRepo:error', { repoPath, error: result.error })
      return result
    }

    logAction('openRepo:success', {
      projectId: result.project?.id,
      remotes: result.remotes?.length ?? 0
    })
    return result
  })

  // Ensure a project has a selected remote (auto-picks origin/first remote).
  ipcMain.handle('ensureProjectRemote', async (_e, payload: { projectId: string }) => {
    logAction('ensureProjectRemote', payload)
    const { setOnboardingBool } = await import('./onboarding')
    const { notifyRenderer } = await import('./index')

    if (!payload?.projectId) return { error: 'Project ID required' }

    const p = getProject(payload.projectId)
    if (!p) return { error: 'Project not found' }

    if (p.remote_repo_key) return { project: p }

    const remotes = await getGitRemotes(p.local_path)
    const selected = getDefaultRemote(remotes)
    if (!selected) return { error: 'No git remotes found' }

    const selectedRemoteName = selected.name.split(':')[0]

    if (p.remote_repo_key !== selected.repoKey) {
      setOnboardingBool(p.id, 'labelsCompleted', false)
      setOnboardingBool(p.id, 'labelsDismissed', false)
      setOnboardingBool(p.id, 'githubProjectDismissed', false)
    }

    const updated = upsertProject({
      id: p.id,
      name: p.name,
      local_path: p.local_path,
      selected_remote_name: selectedRemoteName,
      remote_repo_key: selected.repoKey,
      provider_hint: detectProviderFromRemote(selected.url),
      policy_json: p.policy_json
    })

    createEvent(p.id, 'status_changed', undefined, {
      action: 'remote_selected',
      remote: selectedRemoteName
    })

    notifyRenderer()
    return { project: updated }
  })

  // Create repository
  ipcMain.handle(
    'createRepo',
    async (_e, payload: CreateRepoPayload): Promise<CreateRepoResult> => {
      logAction('createRepo:start', payload)
      const warnings: string[] = []

      try {
        const repoName = (payload.repoName || '').trim()
        const localParentPath = (payload.localParentPath || '').trim()
        if (!repoName) return { error: 'Repository name is required.' }
        if (!localParentPath) return { error: 'Local parent path is required.' }
        if (!/^[a-zA-Z0-9._-]+$/.test(repoName)) {
          return { error: 'Repository name may only include letters, numbers, ., _, and -.' }
        }

        const repoPath = join(localParentPath, repoName)

        if (existsSync(repoPath)) {
          const files = readdirSync(repoPath)
          if (files.length > 0) {
            return { error: 'Target folder already exists and is not empty.' }
          }
        } else {
          mkdirSync(repoPath, { recursive: true })
        }

        const remoteName = payload.remoteName?.trim() || 'origin'
        const addReadme = payload.addReadme !== false
        const initialCommit = payload.initialCommit !== false
        const initialCommitMessage = payload.initialCommitMessage?.trim() || 'Initial commit'

        // Initialize local repo
        await execGit(['init', '-b', 'main'], repoPath)

        if (addReadme) {
          const readmePath = join(repoPath, 'README.md')
          if (!existsSync(readmePath)) {
            writeFileSync(readmePath, `# ${repoName}\n`, 'utf-8')
          }
        }

        let commitSucceeded = false
        if (initialCommit) {
          try {
            await ensureGitIdentity(repoPath, warnings)
            await execGit(['add', '-A'], repoPath)
            await execGit(['commit', '-m', initialCommitMessage], repoPath)
            commitSucceeded = true
          } catch (error) {
            warnings.push(
              `Initial commit failed: ${error instanceof Error ? error.message : 'unknown error'}`
            )
          }
        }

        const remoteProvider = payload.remoteProvider || 'none'
        const remoteVisibility = payload.remoteVisibility || 'private'
        const pushToRemote = payload.pushToRemote === true

        if (remoteProvider === 'github') {
          const owner = payload.githubOwner?.trim()
          const target = owner ? `${owner}/${repoName}` : repoName
          const args = [
            'repo',
            'create',
            target,
            remoteVisibility === 'public' ? '--public' : '--private',
            '--source',
            '.',
            '--remote',
            remoteName,
            '--confirm'
          ]
          if (pushToRemote && commitSucceeded) {
            args.push('--push')
          }
          await execCli('gh', args, repoPath)
        } else if (remoteProvider === 'gitlab') {
          // glab is required for GitLab remote repo creation
          await execCli('glab', ['--version'], repoPath)

          const visibility = remoteVisibility
          const namespace = payload.gitlabNamespace?.trim()
          const host = payload.gitlabHost?.trim()
          const hostnameArgs = host ? ['--hostname', host] : []

          let namespaceId: number | undefined
          if (namespace) {
            const encoded = namespace.replaceAll('/', '%2F')
            const groupJson = await execCli(
              'glab',
              [...hostnameArgs, 'api', `groups/${encoded}`],
              repoPath
            )
            const group = JSON.parse(groupJson) as { id?: number }
            if (!group.id) return { error: `Could not resolve GitLab namespace: ${namespace}` }
            namespaceId = group.id
          }

          const createArgs = [
            ...hostnameArgs,
            'api',
            'projects',
            '-X',
            'POST',
            '-f',
            `name=${repoName}`,
            '-f',
            `visibility=${visibility}`
          ]
          if (namespaceId) {
            createArgs.push('-f', `namespace_id=${namespaceId}`)
          }

          const projectJson = await execCli('glab', createArgs, repoPath)
          const project = JSON.parse(projectJson) as {
            ssh_url_to_repo?: string
            http_url_to_repo?: string
          }
          const remoteUrl = project.ssh_url_to_repo || project.http_url_to_repo
          if (!remoteUrl) return { error: 'GitLab repo created, but remote URL was not returned.' }

          await execGit(['remote', 'add', remoteName, remoteUrl], repoPath)
          if (pushToRemote && commitSucceeded) {
            await execGit(['push', '-u', remoteName, 'main'], repoPath)
          }
        }

        const openResult = await openRepoAtPath(repoPath)
        if (openResult.error) return { error: openResult.error, warnings, repoPath }

        // New repo created by Patchwork: offer starter cards wizard on first open.
        try {
          const { setOnboardingBool } = await import('./onboarding')
          if (openResult.project?.id) {
            setOnboardingBool(openResult.project.id, 'starterCardsEligible', true)
            setOnboardingBool(openResult.project.id, 'starterCardsDismissed', false)
            setOnboardingBool(openResult.project.id, 'starterCardsCompleted', false)
          }
        } catch {
          // ignore
        }

        return {
          ...openResult,
          warnings,
          repoPath
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create repository.'
        logAction('createRepo:error', { message })
        return { error: message, warnings }
      }
    }
  )

  // Select remote for project
  ipcMain.handle(
    'selectRemote',
    async (
      _e,
      payload: { projectId: string; remoteName: string; remoteUrl: string; repoKey: string }
    ) => {
      logAction('selectRemote', payload)
      const { setOnboardingBool } = await import('./onboarding')
      const { notifyRenderer } = await import('./index')

      const p = getProject(payload.projectId)
      if (!p) return { error: 'Project not found' }

      if (p.remote_repo_key !== payload.repoKey) {
        setOnboardingBool(p.id, 'labelsCompleted', false)
        setOnboardingBool(p.id, 'labelsDismissed', false)
        setOnboardingBool(p.id, 'githubProjectDismissed', false)
      }

      const updated = upsertProject({
        id: p.id,
        name: p.name,
        local_path: p.local_path,
        selected_remote_name: payload.remoteName,
        remote_repo_key: payload.repoKey,
        provider_hint: detectProviderFromRemote(payload.remoteUrl),
        policy_json: p.policy_json
      })

      createEvent(p.id, 'status_changed', undefined, {
        action: 'remote_selected',
        remote: payload.remoteName
      })
      logAction('selectRemote:updated', { projectId: p.id, remote: payload.remoteName })

      notifyRenderer()
      return { project: updated }
    }
  )
}
