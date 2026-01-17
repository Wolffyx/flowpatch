import { existsSync, mkdirSync } from 'fs'
import { dirname, basename, join } from 'path'
import { getProject, updateProjectPolicyJson } from '../db'
import { DEFAULT_POLICY, type PolicyConfig } from '../../shared/types'
import { GitWorktreeManager } from './git-worktree-manager'
import { logAction } from '../../shared/utils'

export interface WorktreeInitResult {
  configured: boolean
  worktreeRoot: string
  maxWorkers: number
  error?: string
}

/**
 * Initialize a project with autonomous worker settings.
 * This is called when a project is opened to ensure it has proper
 * worktree and pool configuration for multi-worker support.
 */
export async function initializeProjectWorktree(projectId: string): Promise<WorktreeInitResult> {
  const project = getProject(projectId)
  if (!project) {
    return {
      configured: false,
      worktreeRoot: '',
      maxWorkers: 0,
      error: 'Project not found'
    }
  }

  // Parse existing policy or use defaults
  let policy: PolicyConfig = { ...DEFAULT_POLICY }
  if (project.policy_json) {
    try {
      const parsed = JSON.parse(project.policy_json)
      policy = deepMerge(DEFAULT_POLICY, parsed)
    } catch {
      // Use defaults
    }
  }

  // Check if worktree already configured
  if (policy.worker?.worktree?.enabled) {
    logAction('projectInit:alreadyConfigured', { projectId })
    return {
      configured: true,
      worktreeRoot: policy.worker.worktree.customPath || project.local_path,
      maxWorkers: policy.worker.pool?.maxWorkers || 1
    }
  }

  // Check git version supports worktrees
  const worktreeManager = new GitWorktreeManager(project.local_path)
  const hasWorktreeSupport = await worktreeManager.checkWorktreeSupport()
  if (!hasWorktreeSupport) {
    logAction('projectInit:noWorktreeSupport', { projectId })
    return {
      configured: false,
      worktreeRoot: '',
      maxWorkers: 0,
      error: 'Git 2.17+ required for worktrees'
    }
  }

  // Determine worktree root location
  // Default: sibling directory named "{project}-worktrees"
  const worktreeRoot = determineWorktreeRoot(project.local_path)

  // Configure autonomous worker settings
  const autonomousConfig: Partial<PolicyConfig> = {
    worker: {
      ...policy.worker,
      enabled: true,
      worktree: {
        enabled: true,
        root: 'sibling',
        customPath: worktreeRoot,
        branchPrefix: 'flowpatch/',
        maxConcurrent: 3,
        cleanup: {
          onSuccess: 'immediate',
          onFailure: 'delay',
          delayMinutes: 30
        }
      },
      pool: {
        maxWorkers: 3,
        queueStrategy: 'fifo'
      },
      decomposition: {
        enabled: true,
        threshold: 'auto',
        createSubIssues: true,
        maxSubtasks: 5
      },
      session: {
        sessionMode: 'iterative',
        maxIterations: 5,
        progressCheckpoint: true,
        contextCarryover: 'summary'
      }
    }
  }

  // Merge with existing policy
  const updatedPolicy = deepMerge(policy, autonomousConfig)

  // Save to database
  updateProjectPolicyJson(projectId, JSON.stringify(updatedPolicy))

  // Create worktree root directory if it doesn't exist
  ensureWorktreeRoot(worktreeRoot)

  logAction('projectInit:configured', {
    projectId,
    worktreeRoot,
    maxWorkers: 3
  })

  return {
    configured: true,
    worktreeRoot,
    maxWorkers: 3
  }
}

/**
 * Determine the worktree root directory.
 * Creates a sibling directory named "{project}-worktrees".
 */
function determineWorktreeRoot(projectPath: string): string {
  const parentDir = dirname(projectPath)
  const projectName = basename(projectPath)
  return join(parentDir, `${projectName}-worktrees`)
}

/**
 * Ensure the worktree root directory exists.
 */
function ensureWorktreeRoot(worktreeRoot: string): void {
  if (!existsSync(worktreeRoot)) {
    mkdirSync(worktreeRoot, { recursive: true })
    logAction('projectInit:createdWorktreeRoot', { worktreeRoot })
  }
}

/**
 * Deep merge two objects.
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key]
      const targetValue = target[key]

      if (
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue, sourceValue as any)
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue as T[Extract<keyof T, string>]
      }
    }
  }

  return result
}

/**
 * Check if a project needs worktree initialization.
 */
export function needsWorktreeInit(projectId: string): boolean {
  const project = getProject(projectId)
  if (!project) return false

  if (!project.policy_json) return true

  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return !policy.worker?.worktree?.enabled
  } catch {
    return true
  }
}

/**
 * Get the current worktree configuration for a project.
 */
export function getWorktreeConfig(projectId: string): {
  enabled: boolean
  root: string | null
  maxConcurrent: number
} {
  const project = getProject(projectId)
  if (!project || !project.policy_json) {
    return { enabled: false, root: null, maxConcurrent: 1 }
  }

  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy.worker?.worktree?.enabled ?? false,
      root: policy.worker?.worktree?.customPath ?? null,
      maxConcurrent: policy.worker?.worktree?.maxConcurrent ?? 1
    }
  } catch {
    return { enabled: false, root: null, maxConcurrent: 1 }
  }
}
