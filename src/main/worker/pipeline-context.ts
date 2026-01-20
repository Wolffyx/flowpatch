/**
 * Pipeline Context Builder
 *
 * Utility for building PipelineContext from pipeline state.
 */

import type { PipelineContext } from './phases/types'
import type { Project, Card, PolicyConfig, Subtask, WorkerProgress } from '@shared/types'
import type { IRepoAdapter } from '../adapters'
import type { TaskDecomposer } from '../services/task-decomposer'
import type { BranchManager } from './managers/branch-manager'
import type { WorktreePipelineManager } from './managers/worktree-pipeline-manager'

/**
 * Configuration for building pipeline context.
 */
export interface PipelineContextConfig {
  // IDs
  projectId: string
  cardId: string
  jobId: string | null
  workerId: string

  // Entities
  project: Project | null
  card: Card | null
  policy: PolicyConfig
  adapter: IRepoAdapter | null

  // Managers
  branchManager: BranchManager | null
  worktreeManager: WorktreePipelineManager | null

  // Decomposition
  taskDecomposer: TaskDecomposer | null
  subtasks: Subtask[]
  progress: WorkerProgress | null

  // State
  phase: string
  logs: string[]
  useWorktree: boolean
}

/**
 * Build a PipelineContext from pipeline state.
 */
export function buildPipelineContext(config: PipelineContextConfig): PipelineContext {
  return {
    projectId: config.projectId,
    cardId: config.cardId,
    jobId: config.jobId,
    workerId: config.workerId,

    project: config.project,
    card: config.card,
    policy: config.policy,
    adapter: config.adapter,

    startingBranch: config.branchManager?.getStartingBranch() ?? null,
    baseBranch: config.branchManager?.getBaseBranch() ?? null,
    baseHeadSha: config.branchManager?.getBaseHeadSha() ?? null,
    workerBranch:
      config.branchManager?.getWorkerBranch() ?? config.worktreeManager?.getWorkerBranch() ?? null,

    useWorktree: config.useWorktree,
    worktreeManager: config.worktreeManager?.getWorktreeManager() ?? null,
    worktreeRecord: config.worktreeManager?.getWorktreeRecord() ?? null,
    worktreePath: config.worktreeManager?.getWorktreePath() ?? null,

    taskDecomposer: config.taskDecomposer,
    subtasks: config.subtasks,
    progress: config.progress,

    phase: config.phase,
    logs: config.logs,
    lastPlan: undefined,
    lastPersistMs: 0
  }
}
