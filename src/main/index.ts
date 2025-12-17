import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  initDb,
  upsertProject,
  listProjects,
  listCards,
  createLocalTestCard,
  updateCardStatus,
  deleteProject as dbDeleteProject,
  updateProjectWorkerEnabled,
  listEvents,
  listJobs,
  createEvent,
  createJob,
  getProject,
  updateJobState,
  upsertCard
} from './db'
import { SyncEngine, runSync } from './sync/engine'
import { GithubAdapter } from './adapters/github'
import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import YAML from 'yaml'
import type { RemoteInfo, PolicyConfig } from '@shared/types'
import { logAction } from '@shared/utils'

let mainWindow: BrowserWindow | null = null


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

  // Get full app state
  ipcMain.handle('getState', () => {
    logAction('getState')
    const projects = listProjects()
    const data = projects.map((p) => ({
      project: p,
      cards: listCards(p.id),
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
    const isGit = await isGitRepo(repoPath)
    if (!isGit) {
      logAction('openRepo:error:not_git', { repoPath })
      return { error: 'Selected folder is not a git repository.' }
    }
    const remotes = await getGitRemotes(repoPath)
    if (remotes.length === 0) {
      logAction('openRepo:error:no_remotes', { repoPath })
      return { error: 'No git remotes found in this repository.' }
    }

    const id = cryptoId()
    const name = repoPath.split(/[\\/]/).pop() || repoPath
    const policy = readPolicy(repoPath)

    // Auto-select if only one remote
    const autoSelect = remotes.length === 1

    const project = upsertProject({
      id,
      name,
      local_path: repoPath,
      selected_remote_name: autoSelect ? remotes[0].name.split(':')[0] : null,
      remote_repo_key: autoSelect ? remotes[0].repoKey : null,
      provider_hint: autoSelect ? detectProviderFromRemote(remotes[0].url) : 'auto',
      policy_json: policy
    })

    createEvent(project.id, 'card_created', undefined, { action: 'project_opened' })
    logAction('openRepo:success', { projectId: project.id, remotes: remotes.length })

    return {
      project,
      remotes,
      needSelection: !autoSelect
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
      const card = updateCardStatus(payload.cardId, payload.status)
      if (card) {
        logAction('moveCard', payload)
        createEvent(card.project_id, 'status_changed', card.id, {
          from: card.status,
          to: payload.status
        })
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
    }
    notifyRenderer()
    return { project }
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

    // TODO: Actually run the worker
    notifyRenderer()
    return { success: true, job }
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
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
