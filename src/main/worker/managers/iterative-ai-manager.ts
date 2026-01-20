/**
 * Iterative AI Manager
 *
 * Manages iterative AI execution for worker pipeline.
 * Handles iteration loops, progress checkpointing, context carryover, and subtask management.
 */

import type { PipelineContext } from '../phases/types'
import type { PolicyConfig, Card, Subtask, WorkerProgress } from '@shared/types'
import { buildAIPrompt } from '../phases/ai'
import {
  getWorkerProgress,
  createWorkerProgress,
  updateWorkerProgress,
  updateSubtaskStatus,
  getNextPendingSubtask
} from '../../db'
import { stageAll, commit, isWorkingTreeClean, getDiffStat, getModifiedFiles } from '../git-operations'
import { getWorkingDir } from '../phases/types'
import { WorkerCanceledError } from '../errors'
import type { TaskDecomposer } from '../../services/task-decomposer'
import type { ApprovalManager } from './approval-manager'

export interface IterativeAIConfig {
  projectId: string
  cardId: string
  jobId: string | null
  policy: PolicyConfig
  card: Card | null
}

export type LogFn = (message: string) => void
export type AIRunnerFn = (prompt: string) => Promise<boolean>
export type CancelCheckFn = () => void
export type CheckpointFn = (iteration?: number) => void

/**
 * Manages iterative AI execution with progress tracking and checkpointing.
 */
export class IterativeAIManager {
  private projectId: string
  private cardId: string
  private jobId: string | null
  private policy: PolicyConfig
  private card: Card | null
  
  private progress: WorkerProgress | null = null
  private subtasks: Subtask[] = []
  
  constructor(config: IterativeAIConfig) {
    this.projectId = config.projectId
    this.cardId = config.cardId
    this.jobId = config.jobId
    this.policy = config.policy
    this.card = config.card
  }
  
  // ==================== Public API ====================
  
  /**
   * Run iterative AI execution.
   * 
   * @param plan - Implementation plan
   * @param contextBuilder - Function to build pipeline context
   * @param aiRunner - Function to run AI phase with a prompt
   * @param taskDecomposer - Optional task decomposer for subtask management
   * @param approvalManager - Optional approval manager for follow-up instructions
   * @param log - Logging function
   * @param ensureNotCanceled - Cancellation check function
   * @param persistCheckpoint - Checkpoint persistence function
   * @returns True if all iterations succeeded
   */
  async runIterativeAI(
    plan: string,
    contextBuilder: () => PipelineContext,
    aiRunner: AIRunnerFn,
    taskDecomposer: TaskDecomposer | null,
    approvalManager: ApprovalManager | null,
    subtasks: Subtask[],
    baseHeadSha: string | null,
    log: LogFn,
    ensureNotCanceled: CancelCheckFn,
    persistCheckpoint: CheckpointFn
  ): Promise<boolean> {
    this.subtasks = subtasks
    
    const sessionConfig = this.policy.worker?.session
    const maxIterations = sessionConfig?.maxIterations ?? 5
    const progressCheckpoint = sessionConfig?.progressCheckpoint ?? true
    const contextCarryover = sessionConfig?.contextCarryover ?? 'summary'
    
    // Initialize or resume progress tracking
    let existingProgress = getWorkerProgress(this.cardId, this.projectId)
    if (!existingProgress) {
      existingProgress = createWorkerProgress({
        projectId: this.projectId,
        cardId: this.cardId,
        jobId: this.jobId ?? undefined,
        totalIterations: maxIterations
      })
    }
    
    // Reset iteration to 0 if starting a new job (different jobId)
    if (existingProgress.job_id !== this.jobId) {
      existingProgress = {
        ...existingProgress,
        iteration: 0
      }
    }
    
    this.progress = existingProgress
    
    const startIteration = this.progress.iteration
    log(`Starting iterative AI from iteration ${startIteration}/${maxIterations}`)
    
    let contextSummary = this.progress.context_summary ?? ''
    let allSuccess = true
    
    for (let i = startIteration; i <= maxIterations; i++) {
      ensureNotCanceled()
      
      const iterationPrompt = await this.buildIterationPrompt(
        plan,
        i,
        maxIterations,
        contextSummary,
        contextBuilder,
        approvalManager
      )
      
      log(`Running iteration ${i}/${maxIterations}`)
      
      try {
        const success = await aiRunner(iterationPrompt)
        
        if (!success) {
          log(`Iteration ${i} failed`)
          allSuccess = false
        }
        
        if (progressCheckpoint) {
          await this.checkpointProgress(
            i,
            contextCarryover,
            contextBuilder,
            taskDecomposer,
            baseHeadSha,
            log
          )
        }
        
        if (await this.isIterationComplete()) {
          log(`Task completed after iteration ${i}`)
          break
        }
        
        if (contextCarryover !== 'none') {
          contextSummary = await this.generateContextSummary(
            contextCarryover,
            contextBuilder,
            baseHeadSha
          )
        }
        
        if (this.progress) {
          updateWorkerProgress(this.progress.id, {
            iteration: i + 1,
            contextSummary
          })
          persistCheckpoint(i)
        }
      } catch (error) {
        if (error instanceof WorkerCanceledError) {
          throw error
        }
        log(`Iteration ${i} error: ${error instanceof Error ? error.message : String(error)}`)
        allSuccess = false
        break
      }
    }
    
    return allSuccess
  }
  
  /**
   * Get current progress.
   */
  getProgress(): WorkerProgress | null {
    return this.progress
  }
  
  /**
   * Get current subtasks.
   */
  getSubtasks(): Subtask[] {
    return this.subtasks
  }
  
  // ==================== Private Methods ====================
  
  /**
   * Build prompt for a specific iteration.
   */
  private async buildIterationPrompt(
    plan: string,
    iteration: number,
    maxIterations: number,
    contextSummary: string,
    contextBuilder: () => PipelineContext,
    approvalManager: ApprovalManager | null
  ): Promise<string> {
    const ctx = contextBuilder()
    const basePrompt = await buildAIPrompt(ctx, plan)
    
    let iterationContext = `\n\n## Iteration Context
This is iteration ${iteration} of ${maxIterations}.
`
    
    if (contextSummary) {
      iterationContext += `\n### Previous Progress
${contextSummary}

Continue from where you left off. Focus on the next logical step.
`
    }
    
    if (this.subtasks.length > 0) {
      const pendingSubtasks = this.subtasks.filter((s) => s.status === 'pending')
      const currentSubtask = pendingSubtasks[0]
      
      if (currentSubtask) {
        iterationContext += `\n### Current Subtask
Focus on this subtask: ${currentSubtask.title}
${currentSubtask.description || ''}

Remaining subtasks: ${pendingSubtasks.length}
`
      }
    }
    
    iterationContext += `\n### Iteration Guidelines
- Focus on making incremental progress
- Commit meaningful chunks of work
- Leave the codebase in a working state
- If you complete the current subtask, move to the next one
`
    
    // Add follow-up context
    const followUpContext = approvalManager?.buildFollowUpContext() ?? ''
    
    return basePrompt + iterationContext + followUpContext
  }
  
  /**
   * Checkpoint progress after an iteration.
   */
  private async checkpointProgress(
    iteration: number,
    contextCarryover: 'full' | 'summary' | 'none',
    contextBuilder: () => PipelineContext,
    taskDecomposer: TaskDecomposer | null,
    baseHeadSha: string | null,
    log: LogFn
  ): Promise<void> {
    const ctx = contextBuilder()
    const workingDir = getWorkingDir(ctx)
    
    try {
      if (await isWorkingTreeClean(workingDir)) {
        log(`Iteration ${iteration}: No changes to checkpoint`)
        return
      }
      
      await stageAll(workingDir)
      
      const commitMsg = `[WIP] Iteration ${iteration}: Progress checkpoint

Automated checkpoint by FlowPatch worker.
Card: #${this.card?.remote_number_or_iid} ${this.card?.title}`
      
      await commit(workingDir, commitMsg)
      
      log(`Iteration ${iteration}: Progress checkpointed`)
      
      await this.updateSubtaskProgress(taskDecomposer)
      
      if (this.progress && contextCarryover !== 'none') {
        const modifiedFiles = await getModifiedFiles(
          workingDir,
          baseHeadSha ?? 'HEAD~1'
        )
        updateWorkerProgress(this.progress.id, {
          iteration,
          filesModified: modifiedFiles
        })
      }
    } catch (error) {
      log(`Checkpoint warning: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  
  /**
   * Check if all iterations are complete.
   */
  private async isIterationComplete(): Promise<boolean> {
    if (this.subtasks.length > 0) {
      return this.subtasks.every((s) => s.status === 'completed')
    }
    return false
  }
  
  /**
   * Generate context summary for next iteration.
   */
  private async generateContextSummary(
    mode: 'full' | 'summary' | 'none',
    contextBuilder: () => PipelineContext,
    baseHeadSha: string | null
  ): Promise<string> {
    if (mode === 'none') return ''
    
    const ctx = contextBuilder()
    const workingDir = getWorkingDir(ctx)
    const baseRef = baseHeadSha ?? 'HEAD~1'
    
    try {
      const diffStat = await getDiffStat(workingDir, baseRef)
      const modifiedFiles = await getModifiedFiles(workingDir, baseRef)
      
      let summary = `Files modified:\n${modifiedFiles.join('\n')}\n\nChange summary:\n${diffStat}`
      
      if (mode === 'summary') {
        const lines = summary.split('\n')
        if (lines.length > 20) {
          summary = lines.slice(0, 20).join('\n') + '\n... (truncated)'
        }
      }
      
      return summary
    } catch {
      return ''
    }
  }
  
  /**
   * Update subtask progress after checkpoint.
   */
  private async updateSubtaskProgress(taskDecomposer: TaskDecomposer | null): Promise<void> {
    if (this.subtasks.length === 0) return
    
    const inProgress = this.subtasks.find((s) => s.status === 'in_progress')
    if (inProgress) {
      updateSubtaskStatus(inProgress.id, 'completed')
      const updated = taskDecomposer?.getExistingSubtasks(this.cardId)
      if (updated) this.subtasks = updated
    }
    
    const nextPending = getNextPendingSubtask(this.cardId)
    if (nextPending) {
      updateSubtaskStatus(nextPending.id, 'in_progress')
      const updated = taskDecomposer?.getExistingSubtasks(this.cardId)
      if (updated) this.subtasks = updated
    }
    
    if (this.progress) {
      const completed = this.subtasks.filter((s) => s.status === 'completed').length
      updateWorkerProgress(this.progress.id, {
        subtasksCompleted: completed,
        subtaskIndex: this.subtasks.findIndex((s) => s.status === 'in_progress')
      })
    }
  }
}
