import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  initDb,
  upsertProject,
  listProjects,
  listCards,
  listCardLinksByProject,
  createLocalTestCard,
  updateCardStatus,
  updateCardLabels,
  getStatusLabelFromPolicy,
  getAllStatusLabelsFromPolicy,
  deleteProject as dbDeleteProject,
  updateProjectWorkerEnabled,
  updateProjectPolicyJson,
  listEvents,
  listJobs,
  createEvent,
  createJob,
  getProject,
  getCard,
  getActiveWorkerJobForCard,
  cancelJob,
  updateJobState,
  upsertCard,
  listWorktrees,
  getWorktree,
  updateWorktreeStatus,
  getAppSetting,
  setAppSetting
} from './db'
import { SyncEngine, runSync } from './sync/engine'
import { GithubAdapter } from './adapters/github'
import { GitlabAdapter } from './adapters/gitlab'
import { runWorker as executeWorkerPipeline } from './worker/pipeline'
import {
  startWorkerLoop,
  stopWorkerLoop,
  startEnabledWorkerLoops,
  stopAllWorkerLoops
} from './worker/loop'
import { execFile } from 'child_process'
import { existsSync, readFileSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import YAML from 'yaml'
import {
  DEFAULT_POLICY,
  type RemoteInfo,
  type PolicyConfig,
  type OpenRepoResult,
  type CreateRepoPayload,
  type CreateRepoResult,
  type SelectDirectoryResult,
  type ApplyLabelConfigPayload,
  type CreateRepoLabelsPayload,
  type CreateRepoLabelsResult,
  type ListRepoLabelsPayload,
  type ListRepoLabelsResult,
  type RepoLabel,
  type RepoOnboardingState
} from '@shared/types'
import { logAction } from '@shared/utils'
import { GitWorktreeManager } from './services/git-worktree-manager'
import { WorktreeReconciler, reconcileAllProjects } from './services/worktree-reconciler'
import { startCleanupScheduler, stopCleanupScheduler } from './services/worktree-cleanup-scheduler'

let mainWindow: BrowserWindow | null = null

function getOnboardingKey(projectId: string, key: string): string {
  return `onboarding:${projectId}:${key}`
}

function getOnboardingBool(projectId: string, key: string): boolean {
  return getAppSetting(getOnboardingKey(projectId, key)) === '1'
}

function setOnboardingBool(projectId: string, key: string, value: boolean): void {
  setAppSetting(getOnboardingKey(projectId, key), value ? '1' : '0')
}

function parsePolicyJson(json: string | null): PolicyConfig {
  if (!json) return DEFAULT_POLICY
  try {
    return JSON.parse(json) as PolicyConfig
  } catch {
    return DEFAULT_POLICY
  }
}

function normalizeLabelName(s: string): string {
  return (s || '').trim().toLowerCase()
}

function labelExists(labelName: string, existing: RepoLabel[]): boolean {
  const needle = normalizeLabelName(labelName)
  if (!needle) return false
  return existing.some((l) => normalizeLabelName(l.name) === needle)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function notifyRenderer(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stateUpdated')
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.patchwork')

  initDb()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Open external links
  ipcMain.on('openExternal', (_e, url: string) => {
    if (url && typeof url === 'string') {
      shell.openExternal(url)
    }
  })

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

  // Get full app state
  ipcMain.handle('getState', () => {
    logAction('getState')
    const projects = listProjects()
    const data = projects.map((p) => ({
      project: p,
      cards: listCards(p.id),
      cardLinks: listCardLinksByProject(p.id),
      events: listEvents(p.id),
      jobs: listJobs(p.id)
    }))
    return { projects: data }
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

  ipcMain.handle('createRepo', async (_e, payload: CreateRepoPayload): Promise<CreateRepoResult> => {
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
          const groupJson = await execCli('glab', [...hostnameArgs, 'api', `groups/${encoded}`], repoPath)
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
  })

  // Select remote for project
  ipcMain.handle(
    'selectRemote',
    (
      _e,
      payload: { projectId: string; remoteName: string; remoteUrl: string; repoKey: string }
    ) => {
      logAction('selectRemote', payload)
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

  // Create test card (legacy - for simple local cards)
  ipcMain.handle('createTestCard', (_e, payload: { projectId: string; title: string }) => {
    logAction('createTestCard', payload)
    const card = createLocalTestCard(payload.projectId, payload.title)
    createEvent(payload.projectId, 'card_created', card.id, { title: payload.title })
    logAction('createTestCard:success', { cardId: card.id })
    notifyRenderer()
    return { card }
  })

  // Create card with type selection (local or GitHub issue)
  ipcMain.handle(
    'createCard',
    async (
      _e,
      payload: {
        projectId: string
        title: string
        body?: string
        createType: 'local' | 'github_issue'
      }
    ) => {
      logAction('createCard', payload)
      const project = getProject(payload.projectId)
      if (!project) {
        return { error: 'Project not found' }
      }

      if (payload.createType === 'local') {
        // Create local card
        const card = createLocalTestCard(payload.projectId, payload.title)
        // Update body if provided
        if (payload.body) {
          upsertCard({ ...card, body: payload.body })
        }
        createEvent(payload.projectId, 'card_created', card.id, {
          title: payload.title,
          type: 'local'
        })
        logAction('createCard:local:success', { cardId: card.id })
        notifyRenderer()
        return { card }
      }

      if (payload.createType === 'github_issue') {
        // Verify we have a GitHub remote
        if (!project.remote_repo_key?.startsWith('github:')) {
          return { error: 'GitHub remote not configured for this project' }
        }

        // Parse policy
        let policy: PolicyConfig = { version: 1 }
        if (project.policy_json) {
          try {
            policy = JSON.parse(project.policy_json)
          } catch {
            // Use default policy
          }
        }

        // Create GitHub adapter
        const adapter = new GithubAdapter(project.local_path, project.remote_repo_key, policy)

        // Check auth
        const authResult = await adapter.checkAuth()
        if (!authResult.authenticated) {
          return { error: `GitHub authentication failed: ${authResult.error || 'Not logged in'}` }
        }

        // Create the issue on GitHub
        const result = await adapter.createIssue(payload.title, payload.body)
        if (!result) {
          return { error: 'Failed to create GitHub issue' }
        }

        // Store the card in our database
        const card = upsertCard({
          ...result.card,
          project_id: payload.projectId
        })

        createEvent(payload.projectId, 'card_created', card.id, {
          title: payload.title,
          type: 'github_issue',
          issueNumber: result.number,
          url: result.url
        })

        logAction('createCard:github:success', {
          cardId: card.id,
          issueNumber: result.number,
          url: result.url
        })
        notifyRenderer()
        return { card, issueNumber: result.number, url: result.url }
      }

      return { error: 'Invalid createType' }
    }
  )

  // Move card
  ipcMain.handle(
    'moveCard',
    async (
      _e,
      payload: {
        cardId: string
        status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
      }
    ) => {
      const before = getCard(payload.cardId)
      const card = updateCardStatus(payload.cardId, payload.status)
      if (card) {
        logAction('moveCard', payload)
        createEvent(card.project_id, 'status_changed', card.id, {
          from: before?.status,
          to: payload.status
        })

        // Update local labels to reflect new status
        const project = getProject(card.project_id)
        if (project) {
          let policy: PolicyConfig = DEFAULT_POLICY
          if (project.policy_json) {
            try {
              policy = JSON.parse(project.policy_json) as PolicyConfig
            } catch {
              // fall back to DEFAULT_POLICY
            }
          }

          // Get current labels
          const currentLabels: string[] = card.labels_json ? JSON.parse(card.labels_json) : []

          // Get status label configuration
          const newStatusLabel = getStatusLabelFromPolicy(payload.status, policy)
          const allStatusLabels = getAllStatusLabelsFromPolicy(policy)

          // Replace old status labels with new one
          const filteredLabels = currentLabels.filter((l) => !allStatusLabels.includes(l))
          const updatedLabels = [...filteredLabels, newStatusLabel]

          // Update in database
          updateCardLabels(card.id, JSON.stringify(updatedLabels))
        }

        // If the user moves a card out of Ready/In Progress, cancel any active worker job for it.
        if (payload.status === 'draft' || payload.status === 'in_review' || payload.status === 'testing' || payload.status === 'done') {
          const activeJob = getActiveWorkerJobForCard(payload.cardId)
          if (activeJob) {
            cancelJob(activeJob.id, `Canceled: moved to ${payload.status}`)
            createEvent(card.project_id, 'worker_run', card.id, {
              jobId: activeJob.id,
              action: 'canceled',
              reason: `moved_to_${payload.status}`
            })
          }
        }

        // Sync status change to remote if card has remote
        if (card.remote_repo_key) {
          const job = createJob(card.project_id, 'sync_push', card.id, { status: payload.status })
          // Execute the sync push
          const engine = new SyncEngine(card.project_id)
          const initialized = await engine.initialize()
          if (initialized) {
            const success = await engine.pushStatusChange(payload.cardId, payload.status)
            updateJobState(job.id, success ? 'succeeded' : 'failed')
            logAction('moveCard:pushStatus', { cardId: payload.cardId, success })
          } else {
            updateJobState(job.id, 'failed', undefined, 'Failed to initialize sync engine')
            logAction('moveCard:pushStatus:init_failed', { cardId: payload.cardId })
          }
        }
      }
      notifyRenderer()
      return { card }
    }
  )

  // Delete project
  ipcMain.handle('deleteProject', (_e, payload: { projectId: string }) => {
    logAction('deleteProject', payload)
    const success = dbDeleteProject(payload.projectId)
    logAction('deleteProject:result', { projectId: payload.projectId, success })
    notifyRenderer()
    return { success }
  })

  // Toggle worker
  ipcMain.handle('toggleWorker', (_e, payload: { projectId: string; enabled: boolean }) => {
    logAction('toggleWorker', payload)
    const project = updateProjectWorkerEnabled(payload.projectId, payload.enabled)
    if (project) {
      createEvent(payload.projectId, 'status_changed', undefined, {
        action: 'worker_toggled',
        enabled: payload.enabled
      })
      logAction('toggleWorker:updated', { projectId: payload.projectId, enabled: payload.enabled })

      // Start or stop worker loop based on toggle state
      if (payload.enabled) {
        startWorkerLoop(payload.projectId)
      } else {
        stopWorkerLoop(payload.projectId)
      }
    }
    notifyRenderer()
    return { project }
  })

  // Update worker tool preference (Claude Code vs Codex)
  ipcMain.handle(
    'setWorkerToolPreference',
    (
      _e,
      payload: { projectId: string; toolPreference: 'auto' | 'claude' | 'codex' }
    ) => {
      logAction('setWorkerToolPreference', payload)

      const valid: Set<string> = new Set(['auto', 'claude', 'codex'])
      if (!payload?.projectId) return { error: 'Project not found' }
      if (!valid.has(payload.toolPreference)) return { error: 'Invalid tool preference' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      let policy: PolicyConfig = DEFAULT_POLICY
      if (project.policy_json) {
        try {
          policy = JSON.parse(project.policy_json) as PolicyConfig
        } catch {
          // fall back to DEFAULT_POLICY
        }
      }

      policy.worker = {
        ...policy.worker,
        toolPreference: payload.toolPreference
      }

      updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))
      createEvent(payload.projectId, 'status_changed', undefined, {
        action: 'worker_tool_preference',
        toolPreference: payload.toolPreference
      })

      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )

  ipcMain.handle(
    'setWorkerRollbackOnCancel',
    (_e, payload: { projectId: string; rollbackOnCancel: boolean }) => {
      logAction('setWorkerRollbackOnCancel', payload)

      if (!payload?.projectId) return { error: 'Project not found' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      let policy: PolicyConfig = DEFAULT_POLICY
      if (project.policy_json) {
        try {
          policy = JSON.parse(project.policy_json) as PolicyConfig
        } catch {
          // fall back to DEFAULT_POLICY
        }
      }

      policy.worker = {
        ...policy.worker,
        rollbackOnCancel: !!payload.rollbackOnCancel
      }

      updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))
      createEvent(payload.projectId, 'status_changed', undefined, {
        action: 'worker_rollback_on_cancel',
        rollbackOnCancel: !!payload.rollbackOnCancel
      })

      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )

  ipcMain.handle(
    'setShowPullRequestsSection',
    (_e, payload: { projectId: string; showPullRequestsSection: boolean }) => {
      logAction('setShowPullRequestsSection', payload)

      if (!payload?.projectId) return { error: 'Project not found' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      let policy: PolicyConfig = DEFAULT_POLICY
      if (project.policy_json) {
        try {
          policy = JSON.parse(project.policy_json) as PolicyConfig
        } catch {
          // fall back to DEFAULT_POLICY
        }
      }

      policy.ui = {
        ...policy.ui,
        showPullRequestsSection: !!payload.showPullRequestsSection
      }

      updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))
      createEvent(payload.projectId, 'status_changed', undefined, {
        action: 'ui_show_pull_requests_section',
        showPullRequestsSection: !!payload.showPullRequestsSection
      })

      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )

  // Theme preference handlers (global app settings)
  ipcMain.handle('getThemePreference', () => {
    const saved = getAppSetting('theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved
    }
    return 'system' // Default to system
  })

  ipcMain.handle('setThemePreference', (_e, theme: string) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') {
      return { error: 'Invalid theme preference' }
    }
    setAppSetting('theme', theme)
    return { success: true }
  })

  ipcMain.handle('getSystemTheme', () => {
    const { nativeTheme } = require('electron')
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })

  // API Key handlers (global app settings)
  ipcMain.handle('getApiKey', (_e, payload: { key: string }) => {
    if (!payload?.key) return null
    const settingKey = `api_key_${payload.key}`
    return getAppSetting(settingKey) || null
  })

  ipcMain.handle('setApiKey', (_e, payload: { key: string; value: string }) => {
    if (!payload?.key) return { error: 'Invalid key' }
    const settingKey = `api_key_${payload.key}`
    setAppSetting(settingKey, payload.value || '')
    return { success: true }
  })

  // ==================== Repo Onboarding ====================

  ipcMain.handle('getRepoOnboardingState', (_e, payload: { projectId: string }): RepoOnboardingState => {
    if (!payload?.projectId) return { shouldPromptGithubProject: false, shouldShowLabelWizard: false }

    const project = getProject(payload.projectId)
    if (!project?.remote_repo_key) {
      return { shouldPromptGithubProject: false, shouldShowLabelWizard: false }
    }

    const isGithub = project.remote_repo_key.startsWith('github:')
    const isGitlab = project.remote_repo_key.startsWith('gitlab:')
    const labelsCompleted = getOnboardingBool(payload.projectId, 'labelsCompleted')
    const labelsDismissed = getOnboardingBool(payload.projectId, 'labelsDismissed')

    const shouldShowLabelWizard = (isGithub || isGitlab) && !labelsCompleted && !labelsDismissed

    let shouldPromptGithubProject = false
    if (isGithub) {
      const promptDismissed = getOnboardingBool(payload.projectId, 'githubProjectDismissed')
      const policy = parsePolicyJson(project.policy_json)
      const enabled = policy.sync?.githubProjectsV2?.enabled
      const existingProjectId = policy.sync?.githubProjectsV2?.projectId
      shouldPromptGithubProject =
        !!project.last_sync_at &&
        !promptDismissed &&
        enabled !== false &&
        !existingProjectId
    }

    return { shouldPromptGithubProject, shouldShowLabelWizard }
  })

  ipcMain.handle('dismissLabelWizard', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }
    setOnboardingBool(payload.projectId, 'labelsDismissed', true)
    return { success: true }
  })

  ipcMain.handle('resetLabelWizard', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }
    setOnboardingBool(payload.projectId, 'labelsDismissed', false)
    setOnboardingBool(payload.projectId, 'labelsCompleted', false)
    notifyRenderer()
    return { success: true }
  })

  ipcMain.handle('dismissGithubProjectPrompt', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }
    setOnboardingBool(payload.projectId, 'githubProjectDismissed', true)
    return { success: true }
  })

  ipcMain.handle('resetGithubProjectPrompt', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }
    setOnboardingBool(payload.projectId, 'githubProjectDismissed', false)
    notifyRenderer()
    return { success: true }
  })

  ipcMain.handle('listRepoLabels', async (_e, payload: ListRepoLabelsPayload): Promise<ListRepoLabelsResult> => {
    if (!payload?.projectId) return { labels: [], error: 'Project ID required' }
    const project = getProject(payload.projectId)
    if (!project) return { labels: [], error: 'Project not found' }
    if (!project.remote_repo_key) return { labels: [], error: 'No remote configured' }

    const policy = parsePolicyJson(project.policy_json)
    try {
      if (project.remote_repo_key.startsWith('github:')) {
        const adapter = new GithubAdapter(project.local_path, project.remote_repo_key, policy)
        const labels = await adapter.listRepoLabels()
        return { labels }
      }
      if (project.remote_repo_key.startsWith('gitlab:')) {
        const adapter = new GitlabAdapter(project.local_path, project.remote_repo_key, policy)
        const labels = await adapter.listRepoLabels()
        return { labels }
      }
      return { labels: [], error: 'Unsupported provider' }
    } catch (error) {
      return { labels: [], error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(
    'createRepoLabels',
    async (_e, payload: CreateRepoLabelsPayload): Promise<CreateRepoLabelsResult> => {
      if (!payload?.projectId) return { created: [], skipped: [], error: 'Project ID required' }
      const project = getProject(payload.projectId)
      if (!project) return { created: [], skipped: [], error: 'Project not found' }
      if (!project.remote_repo_key) return { created: [], skipped: [], error: 'No remote configured' }

      const policy = parsePolicyJson(project.policy_json)
      const labelsToCreate = (payload.labels || []).filter((l) => (l.name || '').trim().length > 0)
      if (labelsToCreate.length === 0) return { created: [], skipped: [] }

      let existing: RepoLabel[] = []
      if (project.remote_repo_key.startsWith('github:')) {
        const adapter = new GithubAdapter(project.local_path, project.remote_repo_key, policy)
        existing = await adapter.listRepoLabels()
        const created: string[] = []
        const skipped: string[] = []
        for (const label of labelsToCreate) {
          if (labelExists(label.name, existing)) {
            skipped.push(label.name)
            continue
          }
          const res = await adapter.createRepoLabel(label)
          if (res.created) created.push(label.name)
          else skipped.push(label.name)
        }
        return { created, skipped }
      }

      if (project.remote_repo_key.startsWith('gitlab:')) {
        const adapter = new GitlabAdapter(project.local_path, project.remote_repo_key, policy)
        existing = await adapter.listRepoLabels()
        const created: string[] = []
        const skipped: string[] = []
        for (const label of labelsToCreate) {
          if (labelExists(label.name, existing)) {
            skipped.push(label.name)
            continue
          }
          const res = await adapter.createRepoLabel(label)
          if (res.created) created.push(label.name)
          else skipped.push(label.name)
        }
        return { created, skipped }
      }

      return { created: [], skipped: [], error: 'Unsupported provider' }
    }
  )

  ipcMain.handle('applyLabelConfig', async (_e, payload: ApplyLabelConfigPayload) => {
    if (!payload?.projectId) return { error: 'Project ID required' }
    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }

    const readyLabel = (payload.readyLabel || '').trim()
    const statusLabels = payload.statusLabels
    if (!readyLabel) return { error: 'Ready label is required' }
    if (!statusLabels?.draft || !statusLabels.ready || !statusLabels.inProgress || !statusLabels.inReview || !statusLabels.testing || !statusLabels.done) {
      return { error: 'All status labels are required' }
    }

    const policy = parsePolicyJson(project.policy_json)
    policy.sync = policy.sync ?? {}
    policy.sync.readyLabel = readyLabel
    policy.sync.statusLabels = statusLabels

    if (payload.createMissingLabels && project.remote_repo_key) {
      const requested: RepoLabel[] = [
        { name: readyLabel },
        { name: statusLabels.draft },
        { name: statusLabels.ready },
        { name: statusLabels.inProgress },
        { name: statusLabels.inReview },
        { name: statusLabels.testing },
        { name: statusLabels.done }
      ]

      const adapter =
        project.remote_repo_key.startsWith('github:')
          ? new GithubAdapter(project.local_path, project.remote_repo_key, policy)
          : project.remote_repo_key.startsWith('gitlab:')
            ? new GitlabAdapter(project.local_path, project.remote_repo_key, policy)
            : null
      if (adapter) {
        const existing = await adapter.listRepoLabels()
        for (const label of requested) {
          if (labelExists(label.name, existing)) continue
          await adapter.createRepoLabel(label)
        }
      }
    }

    updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))
    setOnboardingBool(payload.projectId, 'labelsCompleted', true)
    notifyRenderer()
    return { success: true, project: getProject(payload.projectId) }
  })

  ipcMain.handle(
    'createGithubProjectV2',
    async (_e, payload: { projectId: string; title?: string }) => {
      if (!payload?.projectId) return { error: 'Project ID required' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }
      if (!project.remote_repo_key?.startsWith('github:')) return { error: 'Project is not GitHub-backed' }

      const policy = parsePolicyJson(project.policy_json)
      if (policy.sync?.githubProjectsV2?.enabled === false) {
        return { error: 'GitHub Projects integration is disabled by policy' }
      }

      const repoKey = project.remote_repo_key.replace(/^github:/, '')
      const [owner, repo] = repoKey.split('/')
      if (!owner || !repo) return { error: 'Invalid GitHub repo key' }

      const title = (payload.title || '').trim() || `${project.name} Kanban`

      try {
        const ownerQuery = `
          query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              owner { id login }
            }
          }
        `

        const ownerResRaw = await execCli(
          'gh',
          ['api', 'graphql', '-f', `query=${ownerQuery}`, '-F', `owner=${owner}`, '-F', `repo=${repo}`],
          project.local_path
        )
        const ownerRes = JSON.parse(ownerResRaw) as { data?: { repository?: { owner?: { id: string } } }; errors?: { message: string }[] }
        const ownerId = ownerRes.data?.repository?.owner?.id
        if (!ownerId) {
          return { error: ownerRes.errors?.[0]?.message || 'Failed to resolve repository owner' }
        }

        const createMutation = `
          mutation($ownerId: ID!, $title: String!) {
            createProjectV2(input: { ownerId: $ownerId, title: $title }) {
              projectV2 { id url title }
            }
          }
        `

        const createResRaw = await execCli(
          'gh',
          ['api', 'graphql', '-f', `query=${createMutation}`, '-F', `ownerId=${ownerId}`, '-F', `title=${title}`],
          project.local_path
        )
        const createRes = JSON.parse(createResRaw) as { data?: { createProjectV2?: { projectV2?: { id: string; url?: string; title?: string } } }; errors?: { message: string }[] }
        const created = createRes.data?.createProjectV2?.projectV2
        if (!created?.id) {
          return { error: createRes.errors?.[0]?.message || 'Failed to create GitHub Project' }
        }

        policy.sync = policy.sync ?? {}
        policy.sync.githubProjectsV2 = policy.sync.githubProjectsV2 ?? {}
        policy.sync.githubProjectsV2.enabled = true
        policy.sync.githubProjectsV2.projectId = created.id
        updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))

        setOnboardingBool(payload.projectId, 'githubProjectDismissed', true)
        notifyRenderer()
        return { success: true, projectId: created.id, url: created.url, title: created.title }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // Unlink project (removes from app but keeps files)
  ipcMain.handle('unlinkProject', (_e, payload: { projectId: string }) => {
    logAction('unlinkProject', payload)
    if (!payload?.projectId) return { error: 'Project ID required' }

    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }

    // Stop worker loop if running
    stopWorkerLoop(payload.projectId)

    // Delete project from database (this also deletes associated cards, events, jobs, etc.)
    const success = dbDeleteProject(payload.projectId)
    if (!success) {
      return { error: 'Failed to unlink project' }
    }

    logAction('unlinkProject:success', { projectId: payload.projectId, name: project.name })
    notifyRenderer()
    return { success: true }
  })

  // Sync project
  ipcMain.handle('syncProject', async (_e, payload: { projectId: string }) => {
    logAction('syncProject:start', payload)
    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }
    if (!project.remote_repo_key) return { error: 'No remote configured' }

    // Create a sync job
    const job = createJob(payload.projectId, 'sync_poll')
    createEvent(payload.projectId, 'synced', undefined, { jobId: job.id })

    // Run the sync
    const result = await runSync(payload.projectId)
    logAction('syncProject:finished', { projectId: payload.projectId, success: result.success, error: result.error })

    // Update job state
    if (result.success) {
      updateJobState(job.id, 'succeeded')
    } else {
      updateJobState(job.id, 'failed', undefined, result.error)
    }

    notifyRenderer()
    return { success: result.success, error: result.error, job }
  })

  // Run worker
  ipcMain.handle('runWorker', async (_e, payload: { projectId: string; cardId?: string }) => {
    logAction('runWorker', payload)
    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }
    if (!project.remote_repo_key) return { error: 'No remote configured' }

    // Create a worker job
    const job = createJob(payload.projectId, 'worker_run', payload.cardId)
    createEvent(payload.projectId, 'worker_run', payload.cardId, { jobId: job.id })
    logAction('runWorker:queued', { projectId: payload.projectId, jobId: job.id })

    // Execute worker asynchronously (don't block IPC response)
    executeWorkerPipeline(job.id)
      .then((result) => {
        logAction('runWorker:complete', {
          jobId: job.id,
          success: result.success,
          phase: result.phase,
          prUrl: result.prUrl
        })
        notifyRenderer()
      })
      .catch((err) => {
        logAction('runWorker:error', {
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err)
        })
        notifyRenderer()
      })

    notifyRenderer()
    return { success: true, job }
  })

  // ==================== Worktree IPC Handlers ====================

  ipcMain.handle('listWorktrees', async (_e, projectId: string) => {
    logAction('listWorktrees', { projectId })
    return listWorktrees(projectId)
  })

  ipcMain.handle('getWorktree', async (_e, worktreeId: string) => {
    logAction('getWorktree', { worktreeId })
    return getWorktree(worktreeId)
  })

  ipcMain.handle('removeWorktree', async (_e, worktreeId: string) => {
    logAction('removeWorktree', { worktreeId })
    const wt = getWorktree(worktreeId)
    if (!wt) return { error: 'Worktree not found' }

    const project = getProject(wt.project_id)
    if (!project) return { error: 'Project not found' }

    let policy: PolicyConfig | undefined
    try {
      policy = project.policy_json ? JSON.parse(project.policy_json) : undefined
    } catch {
      // Use defaults
    }

    const manager = new GitWorktreeManager(project.local_path)
    const config = {
      root: policy?.worker?.worktree?.root ?? 'repo',
      customPath: policy?.worker?.worktree?.customPath
    }

    try {
      await manager.removeWorktree(wt.worktree_path, { force: true, config })
      updateWorktreeStatus(worktreeId, 'cleaned')
      notifyRenderer()
      return { success: true }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      updateWorktreeStatus(worktreeId, 'error', errorMsg)
      notifyRenderer()
      return { error: errorMsg }
    }
  })

  ipcMain.handle('recreateWorktree', async (_e, worktreeId: string) => {
    logAction('recreateWorktree', { worktreeId })
    const wt = getWorktree(worktreeId)
    if (!wt) return { error: 'Worktree not found' }

    const project = getProject(wt.project_id)
    if (!project) return { error: 'Project not found' }

    let policy: PolicyConfig | undefined
    try {
      policy = project.policy_json ? JSON.parse(project.policy_json) : undefined
    } catch {
      // Use defaults
    }

    const manager = new GitWorktreeManager(project.local_path)
    const config = {
      root: policy?.worker?.worktree?.root ?? 'repo',
      customPath: policy?.worker?.worktree?.customPath
    }

    try {
      // Force remove if exists
      try {
        await manager.removeWorktree(wt.worktree_path, { force: true, config })
      } catch {
        // Ignore removal errors
      }

      // Recreate
      const baseBranch = wt.base_ref.replace(/^origin\//, '')
      await manager.ensureWorktree(wt.worktree_path, wt.branch_name, baseBranch, {
        fetchFirst: true,
        force: true,
        config
      })

      updateWorktreeStatus(worktreeId, 'ready')
      notifyRenderer()
      return { success: true }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      updateWorktreeStatus(worktreeId, 'error', errorMsg)
      notifyRenderer()
      return { error: errorMsg }
    }
  })

  ipcMain.handle('openWorktreeFolder', async (_e, worktreePath: string) => {
    logAction('openWorktreeFolder', { worktreePath })
    shell.openPath(worktreePath)
    return { success: true }
  })

  ipcMain.handle('cleanupStaleWorktrees', async (_e, projectId: string) => {
    logAction('cleanupStaleWorktrees', { projectId })
    const project = getProject(projectId)
    if (!project) return { error: 'Project not found' }

    let policy: PolicyConfig | undefined
    try {
      policy = project.policy_json ? JSON.parse(project.policy_json) : undefined
    } catch {
      // Use defaults
    }

    try {
      const reconciler = new WorktreeReconciler(projectId, project.local_path, policy)
      const result = await reconciler.reconcile()
      notifyRenderer()
      return { success: true, result }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { error: errorMsg }
    }
  })

  createWindow()

  // Start worker loops for all projects that have worker enabled
  startEnabledWorkerLoops()

  // Start worktree cleanup scheduler
  startCleanupScheduler()

  // Reconcile worktrees on startup
  reconcileAllProjects(listProjects()).catch((err) => {
    console.error('Failed to reconcile worktrees on startup:', err)
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Stop all worker loops and cleanup scheduler on app quit
app.on('before-quit', () => {
  stopAllWorkerLoops()
  stopCleanupScheduler()
})

// Utility functions

function cryptoId(): string {
  const buf = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

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

async function openRepoAtPath(repoPath: string): Promise<OpenRepoResult> {
  const isGit = await isGitRepo(repoPath)
  if (!isGit) {
    return { error: 'Selected folder is not a git repository.' }
  }

  const remotes = await getGitRemotes(repoPath)

  const id = cryptoId()
  const name = repoPath.split(/[\\/]/).pop() || repoPath
  const policy = readPolicy(repoPath)

  const selectedRemote = remotes.length === 1 ? remotes[0] : null

  const project = upsertProject({
    id,
    name,
    local_path: repoPath,
    selected_remote_name: selectedRemote ? selectedRemote.name.split(':')[0] : null,
    remote_repo_key: selectedRemote ? selectedRemote.repoKey : null,
    provider_hint: selectedRemote ? detectProviderFromRemote(selectedRemote.url) : 'auto',
    policy_json: policy
  })

  createEvent(project.id, 'card_created', undefined, { action: 'project_opened' })

  return {
    project,
    remotes,
    needSelection: remotes.length > 1
  }
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

function parseRemoteUrl(url: string): { provider: 'github' | 'gitlab' | 'unknown'; repoKey: string } {
  // HTTPS GitHub: https://github.com/owner/repo.git
  // SSH GitHub: git@github.com:owner/repo.git
  // HTTPS GitLab: https://gitlab.com/group/repo.git
  // SSH GitLab: git@gitlab.com:group/repo.git
  // Self-hosted GitLab: git@my.gitlab.host:group/repo.git

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

  // GitLab patterns
  const gitlabHttps = cleanUrl.match(/https?:\/\/([^/]+)\/(.+)/)
  const gitlabSsh = cleanUrl.match(/git@([^:]+):(.+)/)

  if (!repoKey) {
    if (gitlabHttps && gitlabHttps[1].includes('gitlab')) {
      provider = 'gitlab'
      repoKey = `gitlab:${gitlabHttps[1]}/${gitlabHttps[2]}`
    } else if (gitlabSsh && gitlabSsh[1].includes('gitlab')) {
      provider = 'gitlab'
      repoKey = `gitlab:${gitlabSsh[1]}/${gitlabSsh[2]}`
    } else if (gitlabHttps) {
      // Assume any other host might be GitLab
      provider = 'unknown'
      repoKey = `unknown:${gitlabHttps[1]}/${gitlabHttps[2]}`
    } else if (gitlabSsh) {
      provider = 'unknown'
      repoKey = `unknown:${gitlabSsh[1]}/${gitlabSsh[2]}`
    }
  }

  return { provider, repoKey }
}

function detectProviderFromRemote(url: string): 'auto' | 'github' | 'gitlab' {
  if (url.includes('github.com')) return 'github'
  if (url.includes('gitlab')) return 'gitlab'
  return 'auto'
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
