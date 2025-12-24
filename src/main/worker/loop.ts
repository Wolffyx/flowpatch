import { getProject, listProjects } from '../db'
import {
  startWorkerPool,
  stopWorkerPool,
  stopAllWorkerPools,
  isWorkerPoolRunning,
  getWorkerPoolStatus,
  getPoolConfigFromPolicy
} from './pool'
import { logAction } from '../../shared/utils'
import type { PolicyConfig } from '../../shared/types'

/**
 * Starts the worker loop for a project.
 * Uses worker pool for parallel processing based on policy configuration.
 */
export function startWorkerLoop(projectId: string): void {
  // Don't start if already running
  if (isWorkerPoolRunning(projectId)) {
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

  // Parse policy for pool configuration
  let policy: PolicyConfig | null = null
  if (project.policy_json) {
    try {
      policy = JSON.parse(project.policy_json)
    } catch {
      // Use defaults
    }
  }

  const poolConfig = getPoolConfigFromPolicy(policy)

  logAction('workerLoop:starting', {
    projectId,
    projectName: project.name,
    maxWorkers: poolConfig.maxWorkers
  })

  // Start worker pool
  startWorkerPool(projectId, poolConfig)
}

/**
 * Stops the worker loop for a project.
 */
export function stopWorkerLoop(projectId: string): void {
  stopWorkerPool(projectId)
  logAction('workerLoop:stopped', { projectId })
}

/**
 * Checks if a worker loop is running for a project.
 */
export function isWorkerLoopRunning(projectId: string): boolean {
  return isWorkerPoolRunning(projectId)
}

/**
 * Stops all active worker loops.
 * Call this on app shutdown.
 */
export async function stopAllWorkerLoops(): Promise<void> {
  await stopAllWorkerPools()
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
    projects: projects.map((p) => ({
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
    enabledProjectNames: enabledProjects.map((p) => p.name)
  })

  for (const project of enabledProjects) {
    startWorkerLoop(project.id)
  }
}

/**
 * Gets the status of worker loops for all projects.
 */
export function getWorkerLoopStatus(): {
  projectId: string
  running: boolean
  activeWorkers?: number
  maxWorkers?: number
  idleSlots?: number
}[] {
  const projects = listProjects()
  return projects.map((p) => {
    const poolStatus = getWorkerPoolStatus(p.id)
    return {
      projectId: p.id,
      running: poolStatus?.running ?? false,
      activeWorkers: poolStatus?.activeWorkers,
      maxWorkers: poolStatus?.maxWorkers,
      idleSlots: poolStatus?.idleSlots
    }
  })
}
