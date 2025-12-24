/**
 * Worker Pipeline Phase Types
 */

import type { Card, PolicyConfig, Project, Subtask, Worktree, WorkerProgress } from '@shared/types'
import type { GithubAdapter } from '../../adapters/github'
import type { GitlabAdapter } from '../../adapters/gitlab'
import type { GitWorktreeManager } from '../../services/git-worktree-manager'
import type { TaskDecomposer } from '../../services/task-decomposer'

/**
 * Shared context passed between pipeline phases.
 */
export interface PipelineContext {
  // IDs
  projectId: string
  cardId: string
  jobId: string | null
  workerId: string

  // Loaded entities
  project: Project | null
  card: Card | null
  policy: PolicyConfig

  // Adapters
  adapter: GithubAdapter | GitlabAdapter | null

  // Git state
  startingBranch: string | null
  baseBranch: string | null
  baseHeadSha: string | null
  workerBranch: string | null

  // Worktree state
  useWorktree: boolean
  worktreeManager: GitWorktreeManager | null
  worktreeRecord: Worktree | null
  worktreePath: string | null

  // Decomposition and progress
  taskDecomposer: TaskDecomposer | null
  subtasks: Subtask[]
  progress: WorkerProgress | null

  // Execution state
  phase: string
  logs: string[]
  lastPlan: string | undefined
  lastPersistMs: number
}

/**
 * Worker result returned by the pipeline.
 */
export interface WorkerResult {
  success: boolean
  phase: string
  prUrl?: string
  error?: string
  plan?: string
  logs?: string[]
}

/**
 * Logger function type.
 */
export type LogFn = (
  message: string,
  meta?: { source?: string; stream?: 'stdout' | 'stderr' }
) => void

/**
 * Create initial pipeline context.
 */
export function createPipelineContext(projectId: string, cardId: string): PipelineContext {
  return {
    projectId,
    cardId,
    jobId: null,
    workerId: '',

    project: null,
    card: null,
    policy: {
      version: 1,
      worker: {
        enabled: true,
        toolPreference: 'auto',
        planFirst: true,
        maxMinutes: 25,
        rollbackOnCancel: false,
        branchPattern: 'kanban/{id}-{slug}',
        commitMessage: '#{issue} {title}'
      }
    },

    adapter: null,

    startingBranch: null,
    baseBranch: null,
    baseHeadSha: null,
    workerBranch: null,

    useWorktree: false,
    worktreeManager: null,
    worktreeRecord: null,
    worktreePath: null,

    taskDecomposer: null,
    subtasks: [],
    progress: null,

    phase: 'init',
    logs: [],
    lastPlan: undefined,
    lastPersistMs: 0
  }
}

/**
 * Get the working directory for operations.
 */
export function getWorkingDir(ctx: PipelineContext): string {
  return ctx.worktreePath ?? ctx.project!.local_path
}
