/**
 * Approval Manager
 *
 * Handles plan approval workflow and follow-up instructions.
 */

import {
  createPlanApproval,
  getPlanApprovalByJob,
  getNextPendingInstruction,
  markInstructionProcessing,
  markInstructionApplied,
  createEvent,
  updateJobState
} from '../../db'
import { broadcastToRenderers } from '../../ipc/broadcast'
import { WorkerCanceledError, WorkerPendingApprovalError } from '../errors'
import type {
  PolicyConfig,
  PlanningMode,
  PlanApproval,
  FollowUpInstruction
} from '../../../shared/types'

export interface ApprovalContext {
  projectId: string
  cardId: string
  jobId: string
  logs: string[]
}

/**
 * Manages plan approval and follow-up instructions for worker pipeline.
 */
export class ApprovalManager {
  private policy: PolicyConfig
  private ctx: ApprovalContext
  private planApproval: PlanApproval | null = null
  private followUpInstructions: FollowUpInstruction[] = []
  private log: (message: string) => void
  private cancelJob: (reason?: string) => void

  constructor(
    policy: PolicyConfig,
    ctx: ApprovalContext,
    log: (message: string) => void,
    cancelJob: (reason?: string) => void
  ) {
    this.policy = policy
    this.ctx = ctx
    this.log = log
    this.cancelJob = cancelJob
  }

  /**
   * Get the current plan approval.
   */
  getPlanApproval(): PlanApproval | null {
    return this.planApproval
  }

  /**
   * Get accumulated follow-up instructions.
   */
  getFollowUpInstructions(): FollowUpInstruction[] {
    return this.followUpInstructions
  }

  /**
   * Check if plan approval is required and handle the approval flow.
   * Returns true if we can proceed, throws WorkerPendingApprovalError if waiting for approval.
   */
  async checkPlanApproval(plan: string, planningMode: PlanningMode): Promise<void> {
    const planningConfig = this.policy.features?.planning
    if (!planningConfig?.approvalRequired) {
      return // No approval needed
    }

    // Check if we already have an approval for this job
    const existingApproval = getPlanApprovalByJob(this.ctx.jobId)

    if (existingApproval) {
      this.planApproval = existingApproval

      if (existingApproval.status === 'approved' || existingApproval.status === 'skipped') {
        this.log(`Plan already ${existingApproval.status}`)
        return // Already approved or skipped
      }

      if (existingApproval.status === 'rejected') {
        // Plan was rejected - cancel the job
        this.cancelJob('Plan rejected by reviewer')
        throw new WorkerCanceledError('Plan rejected')
      }

      if (existingApproval.status === 'pending') {
        // Still waiting for approval
        this.log('Waiting for plan approval...')
        throw new WorkerPendingApprovalError(existingApproval.id)
      }
    }

    // Create a new plan approval request
    this.log('Creating plan approval request...')
    this.planApproval = createPlanApproval({
      jobId: this.ctx.jobId,
      cardId: this.ctx.cardId,
      projectId: this.ctx.projectId,
      plan,
      planningMode
    })

    // Update job state to pending_approval
    updateJobState(this.ctx.jobId, 'pending_approval', {
      success: false,
      phase: 'pending_approval',
      plan,
      logs: this.ctx.logs.slice(-500)
    })

    // Broadcast the update
    broadcastToRenderers('stateUpdated')
    broadcastToRenderers('planApprovalRequired', {
      projectId: this.ctx.projectId,
      cardId: this.ctx.cardId,
      jobId: this.ctx.jobId,
      approvalId: this.planApproval.id
    })

    // Create event for the approval request
    createEvent(this.ctx.projectId, 'plan_approval_requested', this.ctx.cardId, {
      approvalId: this.planApproval.id,
      planningMode
    })

    this.log('Plan submitted for approval')
    throw new WorkerPendingApprovalError(this.planApproval.id)
  }

  /**
   * Check for pending follow-up instructions and process them.
   * Returns any pending instructions to be incorporated into the next iteration.
   */
  checkFollowUpInstructions(): FollowUpInstruction[] {
    const followUpConfig = this.policy.features?.followUpInstructions
    if (!followUpConfig?.enabled) return []

    // Get the next pending instruction
    const instruction = getNextPendingInstruction(this.ctx.jobId)
    if (!instruction) return []

    // Handle abort instruction specially
    if (instruction.instruction_type === 'abort') {
      this.log('Received abort instruction, canceling job')
      markInstructionApplied(instruction.id)
      createEvent(this.ctx.projectId, 'follow_up_instruction_applied', this.ctx.cardId, {
        instructionId: instruction.id,
        instructionType: 'abort'
      })
      throw new WorkerCanceledError('Aborted by follow-up instruction')
    }

    // Mark as processing
    markInstructionProcessing(instruction.id)
    this.log(`Processing follow-up instruction: ${instruction.instruction_type}`)

    // Add to our tracked list
    this.followUpInstructions.push(instruction)

    return [instruction]
  }

  /**
   * Build additional context from follow-up instructions for the AI prompt.
   */
  buildFollowUpContext(): string {
    if (this.followUpInstructions.length === 0) return ''

    const sections: string[] = [
      '\n## Follow-up Instructions from User\n',
      'The user has provided the following additional instructions that should be incorporated:\n'
    ]

    for (const instruction of this.followUpInstructions) {
      const typeLabel =
        instruction.instruction_type === 'revision'
          ? 'REVISION REQUEST'
          : instruction.instruction_type === 'clarification'
            ? 'CLARIFICATION'
            : instruction.instruction_type === 'additional'
              ? 'ADDITIONAL REQUIREMENT'
              : instruction.instruction_type.toUpperCase()

      sections.push(`### ${typeLabel}`)
      sections.push(instruction.content)
      sections.push('')
    }

    return sections.join('\n')
  }

  /**
   * Mark all processed follow-up instructions as applied.
   */
  markFollowUpInstructionsApplied(): void {
    for (const instruction of this.followUpInstructions) {
      if (instruction.status === 'processing') {
        markInstructionApplied(instruction.id)
        createEvent(this.ctx.projectId, 'follow_up_instruction_applied', this.ctx.cardId, {
          instructionId: instruction.id,
          instructionType: instruction.instruction_type
        })
      }
    }
    this.followUpInstructions = []
  }
}
