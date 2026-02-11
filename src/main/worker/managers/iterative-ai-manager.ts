/**
 * Iterative AI Manager
 *
 * Manages iterative AI execution for worker pipeline.
 * Handles iteration loops, progress checkpointing, context carryover, and subtask management.
 */

import type { PipelineContext, ChecksResult } from '../phases/types'
import type { PolicyConfig, Card, Subtask, WorkerProgress } from '@shared/types'
import { buildAIPrompt } from '../phases/ai'
import {
  getWorkerProgress,
  createWorkerProgress,
  updateWorkerProgress,
  updateSubtaskStatus,
  getNextPendingSubtask
} from '../../db'
import {
  stageAll,
  commit,
  isWorkingTreeClean,
  getModifiedFiles,
  getHeadSha,
  getDiffNumstatMinimalBetween
} from '../git-operations'
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
type IterationMode = 'implement' | 'verify_and_continue'

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
   * @param subtasks - Subtask list
   * @param baseHeadSha - Base ref for diffs
   * @param log - Logging function
   * @param ensureNotCanceled - Cancellation check function
   * @param persistCheckpoint - Checkpoint persistence function
   * @param afterIterationCheck - Optional: run checks after each iteration; if passed, stop early
   * @returns Success flag and whether checks already passed (skip post-AI checks when true)
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
    persistCheckpoint: CheckpointFn,
    afterIterationCheck?: () => Promise<ChecksResult>
  ): Promise<{ success: boolean; checksAlreadyPassed: boolean }> {
    this.subtasks = subtasks
    
    const sessionConfig = this.policy.worker?.session
    const maxIterations = sessionConfig?.maxIterations ?? 3
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
    
    // Reset iteration to 1 if starting a new job (different jobId)
    if (existingProgress.job_id !== this.jobId) {
      existingProgress = {
        ...existingProgress,
        iteration: 1
      }
    }
    
    this.progress = existingProgress
    
    const startIteration = this.progress.iteration
    log(`Starting iterative AI from iteration ${startIteration}/${maxIterations}`)
    
    const baseRef = baseHeadSha ?? 'HEAD~1'
    const checkpointShas: string[] = [baseRef]
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
          const newSha = await this.checkpointProgress(
            i,
            contextCarryover,
            contextBuilder,
            taskDecomposer,
            baseHeadSha,
            log
          )
          if (newSha) checkpointShas.push(newSha)
        }
        
        if (contextCarryover !== 'none') {
          contextSummary = await this.generateContextSummary(
            contextCarryover,
            contextBuilder,
            checkpointShas
          )
        }
        
        if (this.progress) {
          updateWorkerProgress(this.progress.id, {
            iteration: i + 1,
            contextSummary
          })
          persistCheckpoint(i)
        }
        
        if (afterIterationCheck) {
          ensureNotCanceled()
          const checkResult = await afterIterationCheck()
          if (checkResult.passed) {
            log(`Checks passed after iteration ${i}, stopping early`)
            return { success: true, checksAlreadyPassed: true }
          }
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
    
    return { success: allSuccess, checksAlreadyPassed: false }
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
   * Get iteration mode based on iteration number.
   */
  private getIterationMode(iteration: number): IterationMode {
    return iteration <= 1 ? 'implement' : 'verify_and_continue'
  }
  
  /**
   * Build prompt for a specific iteration.
   * Uses minimal prompt for iterations 2+ when minimalContinuationPrompt is enabled.
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
    const useMinimal = this.policy.worker?.session?.minimalContinuationPrompt ?? true

    // First iteration or minimal mode disabled: use full prompt with project memory
    if (iteration <= 1 || !useMinimal) {
      return this.buildFullIterationPrompt(
        plan,
        iteration,
        maxIterations,
        contextSummary,
        ctx,
        approvalManager
      )
    }

    // Iterations 2+: use minimal prompt to reduce context/token usage
    return this.buildMinimalIterationPrompt(
      iteration,
      maxIterations,
      contextSummary,
      ctx,
      approvalManager
    )
  }

  /**
   * Build full prompt for first iteration (includes project memory and full context).
   */
  private async buildFullIterationPrompt(
    plan: string,
    iteration: number,
    maxIterations: number,
    contextSummary: string,
    ctx: PipelineContext,
    approvalManager: ApprovalManager | null
  ): Promise<string> {
    const basePrompt = await buildAIPrompt(ctx, plan)
    const iterationMode = this.getIterationMode(iteration)

    let iterationContext = `\n\n## Iteration Context
This is iteration ${iteration} of ${maxIterations}.
`

    if (iterationMode === 'implement') {
      iterationContext += `\n### Implementation Phase
Focus on implementing the card requirements:
- Work through the implementation plan
- Make meaningful progress on the feature
- Commit working chunks of code
`
    } else {
      const cardTitle = this.card?.title ?? 'Unknown'
      const cardBody = this.card?.body ?? 'No description provided.'
      const lintCommand = this.policy.worker?.lintCommand ?? 'Not configured'
      const testCommand = this.policy.worker?.testCommand ?? 'Not configured'
      const buildCommand = this.policy.worker?.buildCommand ?? 'Not configured'

      iterationContext += `\n### Verification Phase
Before continuing, evaluate if the card requirements are fully implemented:

**Step 1: Check Card Requirements**
Review the original card and verify all requirements are addressed:
- Title: ${cardTitle}
- Description: ${cardBody}

**Step 2: Run Verification Commands**
Execute these commands to ensure code quality:
- Lint: ${lintCommand}
- Test: ${testCommand}
- Build: ${buildCommand}
`
    }

    if (contextSummary) {
      iterationContext += `\n### Previous iterations (minimal)
${contextSummary}
`
      if (iterationMode === 'implement') {
        iterationContext += `\nContinue from where you left off. Focus on the next logical step.`
      }
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

    if (iterationMode === 'verify_and_continue') {
      iterationContext += `\n### Next Steps
- If requirements are NOT fully met: Continue implementing the remaining features
- If requirements ARE met but verification fails: Fix the issues
- If everything passes: Focus on code quality, edge cases, and cleanup
`
    }

    if (iterationMode === 'implement') {
      iterationContext += `\n### Iteration Guidelines
- Focus on making incremental progress
- Commit meaningful chunks of work
- Leave the codebase in a working state
- If you complete the current subtask, move to the next one
`
    } else {
      iterationContext += `\n### Iteration Guidelines
- Prioritize completing unfinished requirements
- Ensure all verification commands pass
- Leave the codebase in a stable state
- Continue implementation if gaps remain
`
    }

    // Add follow-up context
    const followUpContext = approvalManager?.buildFollowUpContext() ?? ''

    // Add comments context (user feedback from issue comments)
    const commentsContext = approvalManager?.buildCommentsContext() ?? ''

    return basePrompt + iterationContext + followUpContext + commentsContext
  }

  /**
   * Build minimal prompt for continuation iterations (2+).
   * Only includes essential context to reduce token usage significantly.
   * The AI already has the full context from iteration 1 and can read files if needed.
   */
  private buildMinimalIterationPrompt(
    iteration: number,
    maxIterations: number,
    contextSummary: string,
    ctx: PipelineContext,
    approvalManager: ApprovalManager | null
  ): string {
    const sections: string[] = []
    const cardTitle = this.card?.title ?? 'Unknown'

    // Brief header with card title
    sections.push(`# Continue Implementation: ${cardTitle}`)
    sections.push(`\nIteration ${iteration} of ${maxIterations}`)

    // Previous work summary (git diff stats)
    if (contextSummary) {
      sections.push(`\n## Previous Work`)
      sections.push(contextSummary)
    }

    // Current subtask focus
    const pendingSubtasks = this.subtasks.filter((s) => s.status === 'pending')
    if (pendingSubtasks.length > 0 && pendingSubtasks[0]) {
      sections.push(`\n## Current Focus`)
      sections.push(`Subtask: ${pendingSubtasks[0].title}`)
      if (pendingSubtasks[0].description) {
        sections.push(pendingSubtasks[0].description)
      }
      sections.push(`Remaining subtasks: ${pendingSubtasks.length}`)
    }

    // Verification commands
    const lintCommand = this.policy.worker?.lintCommand
    const testCommand = this.policy.worker?.testCommand
    const buildCommand = this.policy.worker?.buildCommand

    if (lintCommand || testCommand || buildCommand) {
      sections.push(`\n## Verification Commands`)
      if (lintCommand) sections.push(`- Lint: ${lintCommand}`)
      if (testCommand) sections.push(`- Test: ${testCommand}`)
      if (buildCommand) sections.push(`- Build: ${buildCommand}`)
    }

    // Instructions
    sections.push(`\n## Instructions
- Run verification commands to check current state
- Fix any failing tests, lint errors, or build issues
- If verification passes, ensure all card requirements are met
- Complete any remaining implementation work
- You can read any files you need to understand the current state`)

    // Follow-up instructions from user
    const followUpContext = approvalManager?.buildFollowUpContext() ?? ''
    if (followUpContext) {
      sections.push(followUpContext)
    }

    // User feedback from issue comments
    const commentsContext = approvalManager?.buildCommentsContext() ?? ''
    if (commentsContext) {
      sections.push(commentsContext)
    }

    return sections.join('\n')
  }
  
  /**
   * Checkpoint progress after an iteration.
   * @returns New HEAD SHA if a commit was made, null otherwise.
   */
  private async checkpointProgress(
    iteration: number,
    contextCarryover: 'full' | 'summary' | 'none',
    contextBuilder: () => PipelineContext,
    taskDecomposer: TaskDecomposer | null,
    baseHeadSha: string | null,
    log: LogFn
  ): Promise<string | null> {
    const ctx = contextBuilder()
    const workingDir = getWorkingDir(ctx)
    
    try {
      if (await isWorkingTreeClean(workingDir)) {
        log(`Iteration ${iteration}: No changes to checkpoint`)
        return null
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
      
      return await getHeadSha(workingDir)
    } catch (error) {
      log(`Checkpoint warning: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
  
  /**
   * Generate minimal per-iteration context summary for next iteration.
   * checkpointShas[0] = base ref, checkpointShas[k] = HEAD after iteration k.
   */
  private async generateContextSummary(
    mode: 'full' | 'summary' | 'none',
    contextBuilder: () => PipelineContext,
    checkpointShas: string[]
  ): Promise<string> {
    if (mode === 'none' || checkpointShas.length < 2) return ''
    
    const ctx = contextBuilder()
    const workingDir = getWorkingDir(ctx)
    const maxLinesTotal = 30
    const maxFilesPerIteration = 10
    
    try {
      const parts: string[] = []
      for (let k = 1; k < checkpointShas.length && parts.length < maxLinesTotal; k++) {
        const fromRef = checkpointShas[k - 1]
        const toRef = checkpointShas[k]
        const minimal = await getDiffNumstatMinimalBetween(
          workingDir,
          fromRef,
          toRef,
          maxFilesPerIteration
        )
        if (minimal) parts.push(`Iteration ${k}: ${minimal}`)
      }
      return parts.join('\n')
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
