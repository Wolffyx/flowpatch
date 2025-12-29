/**
 * IPC handlers for plan approval operations.
 * Handles: getPendingApprovals, getPlanApproval, approvePlan, rejectPlan, skipApproval
 */

import { ipcMain } from 'electron'
import {
  getPendingApprovals,
  getAllPendingApprovals,
  getPlanApproval,
  getPlanApprovalByJob,
  approvePlan,
  rejectPlan,
  skipApproval,
  createEvent
} from '../../db'
import { resumeWorkerAfterApproval } from '../../worker/pipeline'
import { logAction } from '@shared/utils'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerPlanApprovalHandlers(notifyRenderer: () => void): void {
  // Get all pending approvals (optionally filtered by project)
  ipcMain.handle('getPendingApprovals', (_e, payload?: { projectId?: string }) => {
    logAction('getPendingApprovals', payload)

    if (payload?.projectId) {
      const approvals = getPendingApprovals(payload.projectId)
      return { approvals }
    }

    const approvals = getAllPendingApprovals()
    return { approvals }
  })

  // Get a specific plan approval
  ipcMain.handle('getPlanApproval', (_e, payload: { approvalId?: string; jobId?: string }) => {
    logAction('getPlanApproval', payload)

    if (payload.approvalId) {
      const approval = getPlanApproval(payload.approvalId)
      return { approval }
    }

    if (payload.jobId) {
      const approval = getPlanApprovalByJob(payload.jobId)
      return { approval }
    }

    return { error: 'Must provide approvalId or jobId' }
  })

  // Approve a plan
  ipcMain.handle(
    'approvePlan',
    async (_e, payload: { approvalId: string; notes?: string }) => {
      logAction('approvePlan', payload)

      if (!payload?.approvalId) return { error: 'Approval ID required' }

      const approval = approvePlan(payload.approvalId, payload.notes)
      if (!approval) return { error: 'Approval not found' }

      // Create event
      createEvent(approval.project_id, 'plan_approved', approval.card_id, {
        approvalId: approval.id,
        jobId: approval.job_id,
        notes: payload.notes
      })

      notifyRenderer()

      // Resume the worker
      const result = await resumeWorkerAfterApproval(approval.job_id)
      logAction('approvePlan:resumed', {
        jobId: approval.job_id,
        success: result.success,
        phase: result.phase
      })

      notifyRenderer()
      return { success: true, approval, workerResult: result }
    }
  )

  // Reject a plan
  ipcMain.handle(
    'rejectPlan',
    async (_e, payload: { approvalId: string; notes?: string }) => {
      logAction('rejectPlan', payload)

      if (!payload?.approvalId) return { error: 'Approval ID required' }

      const approval = rejectPlan(payload.approvalId, payload.notes)
      if (!approval) return { error: 'Approval not found' }

      // Create event
      createEvent(approval.project_id, 'plan_rejected', approval.card_id, {
        approvalId: approval.id,
        jobId: approval.job_id,
        notes: payload.notes
      })

      notifyRenderer()

      // Resume the worker (it will handle the rejection)
      const result = await resumeWorkerAfterApproval(approval.job_id)
      logAction('rejectPlan:handled', {
        jobId: approval.job_id,
        success: result.success,
        phase: result.phase
      })

      notifyRenderer()
      return { success: true, approval, workerResult: result }
    }
  )

  // Skip approval (auto-approve)
  ipcMain.handle(
    'skipPlanApproval',
    async (_e, payload: { approvalId: string }) => {
      logAction('skipPlanApproval', payload)

      if (!payload?.approvalId) return { error: 'Approval ID required' }

      const approval = skipApproval(payload.approvalId)
      if (!approval) return { error: 'Approval not found' }

      // Create event
      createEvent(approval.project_id, 'plan_skipped', approval.card_id, {
        approvalId: approval.id,
        jobId: approval.job_id
      })

      notifyRenderer()

      // Resume the worker
      const result = await resumeWorkerAfterApproval(approval.job_id)
      logAction('skipPlanApproval:resumed', {
        jobId: approval.job_id,
        success: result.success,
        phase: result.phase
      })

      notifyRenderer()
      return { success: true, approval, workerResult: result }
    }
  )
}
