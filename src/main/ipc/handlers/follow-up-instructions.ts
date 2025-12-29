/**
 * IPC handlers for follow-up instruction operations.
 * Handles: getFollowUpInstructions, createFollowUpInstruction, markInstructionApplied, markInstructionRejected, deleteFollowUpInstruction
 */

import { ipcMain } from 'electron'
import {
  getFollowUpInstruction,
  getFollowUpInstructionsByJob,
  getPendingFollowUpInstructions,
  getPendingInstructionsByProject,
  getPendingInstructionsByCard,
  createFollowUpInstruction,
  markInstructionApplied,
  markInstructionRejected,
  deleteFollowUpInstruction,
  deleteFollowUpInstructionsByJob,
  countPendingInstructions,
  createEvent
} from '../../db'
import type { FollowUpInstructionType } from '@shared/types'
import { logAction } from '@shared/utils'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerFollowUpInstructionHandlers(notifyRenderer: () => void): void {
  // Get follow-up instructions (by job, project, card, or specific ID)
  ipcMain.handle(
    'getFollowUpInstructions',
    (_e, payload: { id?: string; jobId?: string; projectId?: string; cardId?: string; pendingOnly?: boolean }) => {
      logAction('getFollowUpInstructions', payload)

      if (payload.id) {
        const instruction = getFollowUpInstruction(payload.id)
        return { instructions: instruction ? [instruction] : [] }
      }

      if (payload.jobId) {
        const instructions = payload.pendingOnly
          ? getPendingFollowUpInstructions(payload.jobId)
          : getFollowUpInstructionsByJob(payload.jobId)
        return { instructions }
      }

      if (payload.projectId) {
        const instructions = getPendingInstructionsByProject(payload.projectId)
        return { instructions }
      }

      if (payload.cardId) {
        const instructions = getPendingInstructionsByCard(payload.cardId)
        return { instructions }
      }

      return { error: 'Must provide id, jobId, projectId, or cardId' }
    }
  )

  // Create a new follow-up instruction
  ipcMain.handle(
    'createFollowUpInstruction',
    (
      _e,
      payload: {
        jobId: string
        cardId: string
        projectId: string
        instructionType: FollowUpInstructionType
        content: string
        priority?: number
      }
    ) => {
      logAction('createFollowUpInstruction', payload)

      if (!payload?.jobId || !payload?.cardId || !payload?.projectId) {
        return { error: 'jobId, cardId, and projectId are required' }
      }

      if (!payload?.instructionType || !payload?.content) {
        return { error: 'instructionType and content are required' }
      }

      const instruction = createFollowUpInstruction({
        jobId: payload.jobId,
        cardId: payload.cardId,
        projectId: payload.projectId,
        instructionType: payload.instructionType,
        content: payload.content,
        priority: payload.priority
      })

      // Create event
      createEvent(payload.projectId, 'follow_up_instruction_added', payload.cardId, {
        instructionId: instruction.id,
        jobId: payload.jobId,
        instructionType: payload.instructionType
      })

      notifyRenderer()
      return { success: true, instruction }
    }
  )

  // Mark an instruction as applied
  ipcMain.handle('markInstructionApplied', (_e, payload: { instructionId: string }) => {
    logAction('markInstructionApplied', payload)

    if (!payload?.instructionId) return { error: 'Instruction ID required' }

    const instruction = markInstructionApplied(payload.instructionId)
    if (!instruction) return { error: 'Instruction not found' }

    // Create event
    createEvent(instruction.project_id, 'follow_up_instruction_applied', instruction.card_id, {
      instructionId: instruction.id,
      jobId: instruction.job_id,
      instructionType: instruction.instruction_type
    })

    notifyRenderer()
    return { success: true, instruction }
  })

  // Mark an instruction as rejected
  ipcMain.handle('markInstructionRejected', (_e, payload: { instructionId: string }) => {
    logAction('markInstructionRejected', payload)

    if (!payload?.instructionId) return { error: 'Instruction ID required' }

    const instruction = markInstructionRejected(payload.instructionId)
    if (!instruction) return { error: 'Instruction not found' }

    // Create event
    createEvent(instruction.project_id, 'follow_up_instruction_rejected', instruction.card_id, {
      instructionId: instruction.id,
      jobId: instruction.job_id,
      instructionType: instruction.instruction_type
    })

    notifyRenderer()
    return { success: true, instruction }
  })

  // Delete a specific follow-up instruction
  ipcMain.handle('deleteFollowUpInstruction', (_e, payload: { instructionId: string }) => {
    logAction('deleteFollowUpInstruction', payload)

    if (!payload?.instructionId) return { error: 'Instruction ID required' }

    deleteFollowUpInstruction(payload.instructionId)
    notifyRenderer()
    return { success: true }
  })

  // Delete all follow-up instructions for a job
  ipcMain.handle('deleteFollowUpInstructionsByJob', (_e, payload: { jobId: string }) => {
    logAction('deleteFollowUpInstructionsByJob', payload)

    if (!payload?.jobId) return { error: 'Job ID required' }

    deleteFollowUpInstructionsByJob(payload.jobId)
    notifyRenderer()
    return { success: true }
  })

  // Count pending instructions for a job
  ipcMain.handle('countPendingInstructions', (_e, payload: { jobId: string }) => {
    logAction('countPendingInstructions', payload)

    if (!payload?.jobId) return { error: 'Job ID required' }

    const count = countPendingInstructions(payload.jobId)
    return { count }
  })
}
