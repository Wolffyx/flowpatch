import {
  getProject,
  getNextReadyCard,
  hasActiveWorkerJob,
  createJob,
  createEvent,
  listProjects
} from '../db'
import { runWorker } from './pipeline'
import { logAction } from '../../shared/utils'
import { broadcastToRenderers } from '../ipc/broadcast'

// Store for active worker loops per project
const activeLoops = new Map<string, NodeJS.Timeout>()

// Default polling interval (how often to check for Ready cards)
const DEFAULT_POLL_INTERVAL_MS = 30_000 // 30 seconds

/**
 * Starts the worker loop for a project.
 * The loop will poll for Ready cards and process them automatically.
 */
export function startWorkerLoop(projectId: string): void {
  // Don't start if already running
  if (activeLoops.has(projectId)) {
    logAction('workerLoop:alreadyRunning', { projectId })
    return
  }

  const project = getProject(projectId)
  if (!project) {
    logAction('workerLoop:projectNotFound', { projectId })
    return
  }

  if (!project.remote_repo_key) {
    logAction('workerLoop:noRemote', { projectId })
    return
  }

  logAction('workerLoop:starting', { projectId, projectName: project.name })

  // Run immediately once, then set up interval
  processNextCard(projectId)

  const interval = setInterval(() => {
    processNextCard(projectId)
  }, DEFAULT_POLL_INTERVAL_MS)

  activeLoops.set(projectId, interval)
  logAction('workerLoop:started', { projectId })
}

/**
 * Stops the worker loop for a project.
 */
export function stopWorkerLoop(projectId: string): void {
  const interval = activeLoops.get(projectId)
  if (interval) {
    clearInterval(interval)
    activeLoops.delete(projectId)
    logAction('workerLoop:stopped', { projectId })
  }
}

/**
 * Checks if a worker loop is running for a project.
 */
export function isWorkerLoopRunning(projectId: string): boolean {
  return activeLoops.has(projectId)
}

/**
 * Stops all active worker loops.
 * Call this on app shutdown.
 */
export function stopAllWorkerLoops(): void {
  for (const [projectId, interval] of activeLoops) {
    clearInterval(interval)
    logAction('workerLoop:stopped', { projectId })
  }
  activeLoops.clear()
  logAction('workerLoop:allStopped')
}

/**
 * Starts worker loops for all projects that have worker_enabled=1.
 * Call this on app startup.
 */
export function startEnabledWorkerLoops(): void {
  const projects = listProjects()

  logAction('workerLoop:startingEnabled:allProjects', {
    totalCount: projects.length,
    projects: projects.map(p => ({
      id: p.id,
      name: p.name,
      worker_enabled: p.worker_enabled,
      hasRemote: !!p.remote_repo_key
    }))
  })

  const enabledProjects = projects.filter(
    (p) => Number(p.worker_enabled) === 1 && p.remote_repo_key
  )

  logAction('workerLoop:startingEnabled', {
    count: enabledProjects.length,
    enabledProjectNames: enabledProjects.map(p => p.name)
  })

  for (const project of enabledProjects) {
    startWorkerLoop(project.id)
  }
}

/**
 * Process the next Ready card for a project.
 * This is the main worker loop iteration.
 */
async function processNextCard(projectId: string): Promise<void> {
  try {
    // Check if there's already an active worker job
    if (hasActiveWorkerJob(projectId)) {
      logAction('workerLoop:jobInProgress', { projectId })
      return
    }

    // Check if worker is still enabled
    const project = getProject(projectId)
    if (!project || Number(project.worker_enabled) !== 1) {
      logAction('workerLoop:workerDisabled', { projectId, worker_enabled: project?.worker_enabled })
      stopWorkerLoop(projectId)
      return
    }

    // Get retry cooldown from policy (could be made configurable)
    const retryCooldownMinutes = 30

    // Find next eligible Ready card
    const card = getNextReadyCard(projectId, retryCooldownMinutes)
    if (!card) {
      // No Ready cards to process - this is normal, just wait
      return
    }

    logAction('workerLoop:foundCard', {
      projectId,
      cardId: card.id,
      cardTitle: card.title,
      issueNumber: card.remote_number_or_iid
    })

    // Create and execute worker job
    const job = createJob(projectId, 'worker_run', card.id)
    createEvent(projectId, 'worker_run', card.id, {
      jobId: job.id,
      trigger: 'auto'
    })
    broadcastToRenderers('stateUpdated')

    logAction('workerLoop:startingJob', {
      projectId,
      jobId: job.id,
      cardId: card.id
    })

    // Execute the worker pipeline
    const result = await runWorker(job.id)
    broadcastToRenderers('stateUpdated')

    logAction('workerLoop:jobComplete', {
      projectId,
      jobId: job.id,
      success: result.success,
      phase: result.phase,
      prUrl: result.prUrl,
      error: result.error
    })
  } catch (error) {
    logAction('workerLoop:error', {
      projectId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Gets the status of worker loops for all projects.
 */
export function getWorkerLoopStatus(): { projectId: string; running: boolean }[] {
  const projects = listProjects()
  return projects.map((p) => ({
    projectId: p.id,
    running: activeLoops.has(p.id)
  }))
}
