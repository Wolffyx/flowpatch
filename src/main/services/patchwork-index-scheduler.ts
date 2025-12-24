import { createJob, getProject, listProjects, updateJobState } from '../db'
import { broadcastToRenderers } from '../ipc/broadcast'
import { getResolvedBool } from '../settingsStore'
import { buildIndex, IndexCanceledError } from './patchwork-indexer'
import { ensurePatchworkWorkspace, getPatchworkWorkspaceStatus } from './patchwork-workspace'
import { startIndexWatch, stopIndexWatch } from './patchwork-watch-manager'

interface ProjectIndexState {
  projectId: string
  repoRoot: string
  enabled: boolean
  active: boolean
  inProgress: boolean
  pending: boolean
  cancelRequested: boolean
  lastRunAt: number
  periodicTimer: NodeJS.Timeout | null
}

const projects = new Map<string, ProjectIndexState>()
let activeProjectId: string | null = null

function nowMs(): number {
  return Date.now()
}

async function runIndex(projectId: string, reason: string): Promise<void> {
  const state = projects.get(projectId)
  if (!state) return
  if (!state.enabled && !reason.startsWith('manual:')) return

  if (state.inProgress) {
    state.pending = true
    return
  }

  state.inProgress = true
  state.pending = false
  state.lastRunAt = nowMs()
  state.cancelRequested = false

  const job = createJob(projectId, 'index_refresh', undefined, { trigger: 'scheduler', reason })
  updateJobState(job.id, 'running', { summary: `Indexing (${reason})…` })
  broadcastToRenderers('stateUpdated')

  try {
    const status = await getPatchworkWorkspaceStatus(state.repoRoot)
    if (!status.writable) {
      updateJobState(job.id, 'blocked', { summary: 'Repo not writable' }, 'Repo not writable')
      return
    }
    ensurePatchworkWorkspace(state.repoRoot)
    const { meta } = await buildIndex(state.repoRoot, { isCanceled: () => state.cancelRequested })
    updateJobState(job.id, 'succeeded', {
      summary: `Indexed ${meta.totalFiles} files`,
      artifacts: meta
    })
  } catch (e) {
    if (e instanceof IndexCanceledError) {
      updateJobState(job.id, 'canceled', { summary: 'Indexing canceled' })
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('already running')) {
      updateJobState(job.id, 'blocked', { summary: 'Index already running' }, msg)
      state.pending = true
    } else {
      updateJobState(job.id, 'failed', { summary: msg }, msg)
    }
  } finally {
    broadcastToRenderers('stateUpdated')
    state.inProgress = false
    if (state.pending && state.enabled) {
      void runIndex(projectId, 'coalesced')
    }
  }
}

function setPeriodic(state: ProjectIndexState): void {
  if (state.periodicTimer) clearInterval(state.periodicTimer)
  if (!state.enabled) {
    state.periodicTimer = null
    return
  }

  const intervalMs = state.active ? 60_000 : 10 * 60_000
  state.periodicTimer = setInterval(() => {
    void runIndex(state.projectId, state.active ? 'active:periodic' : 'background:periodic')
  }, intervalMs)
}

export function startIndexScheduler(): void {
  for (const p of listProjects()) {
    const enabled = getResolvedBool(p.id, 'index.autoIndexingEnabled')
    if (enabled) registerProject(p.id, p.local_path)
  }
}

export function stopIndexScheduler(): void {
  for (const state of projects.values()) {
    if (state.periodicTimer) clearInterval(state.periodicTimer)
    stopIndexWatch(state.repoRoot)
  }
  projects.clear()
  activeProjectId = null
}

export function ensureProjectRegistered(projectId: string, repoRoot: string): void {
  if (projects.has(projectId)) return
  projects.set(projectId, {
    projectId,
    repoRoot,
    enabled: false,
    active: false,
    inProgress: false,
    pending: false,
    cancelRequested: false,
    lastRunAt: 0,
    periodicTimer: null
  })
}

export function registerProject(projectId: string, repoRoot: string): void {
  ensureProjectRegistered(projectId, repoRoot)
  setProjectIndexingEnabled(projectId, true)
}

export function setProjectIndexingEnabled(projectId: string, enabled: boolean): void {
  const state = projects.get(projectId)
  if (!state) return
  if (state.enabled === enabled) return

  state.enabled = enabled

  if (!enabled) {
    state.cancelRequested = true
    state.pending = false
    if (state.periodicTimer) clearInterval(state.periodicTimer)
    state.periodicTimer = null
    stopIndexWatch(state.repoRoot)
    broadcastToRenderers('stateUpdated')
    return
  }

  state.cancelRequested = false
  state.active = activeProjectId === projectId

  startIndexWatch(state.repoRoot, () => {
    void runIndex(projectId, 'fswatch')
  })

  setPeriodic(state)

  void (async () => {
    const project = getProject(projectId)
    if (!project) return
    const status = await getPatchworkWorkspaceStatus(state.repoRoot)
    if (!status.writable) return
    ensurePatchworkWorkspace(state.repoRoot)
    void runIndex(projectId, 'manual:enabled')
  })()

  broadcastToRenderers('stateUpdated')
}

export function unregisterProject(projectId: string): void {
  const state = projects.get(projectId)
  if (!state) return
  if (state.periodicTimer) clearInterval(state.periodicTimer)
  stopIndexWatch(state.repoRoot)
  projects.delete(projectId)
  if (activeProjectId === projectId) activeProjectId = null
}

export function setActiveProject(projectId: string | null): void {
  activeProjectId = projectId
  for (const state of projects.values()) {
    state.active = state.projectId === projectId
    setPeriodic(state)
  }
  if (projectId) void runIndex(projectId, 'focus')
}

export function requestIndexNow(projectId: string, reason: string): void {
  void runIndex(projectId, reason)
}
