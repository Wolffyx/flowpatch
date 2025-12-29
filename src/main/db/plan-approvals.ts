/**
 * Plan Approvals Database Module
 *
 * Handles CRUD operations for plan approval requests.
 * Used when approvalRequired is enabled in planning config.
 */

import { getDb } from './connection'
import { generateId } from '@shared/utils'
import type { PlanApproval, PlanApprovalStatus, PlanningMode } from '@shared/types'

export type { PlanApproval, PlanApprovalStatus }

export interface PlanApprovalCreate {
  jobId: string
  cardId: string
  projectId: string
  plan: string
  planningMode: PlanningMode
}

/**
 * Get a plan approval by ID.
 */
export function getPlanApproval(id: string): PlanApproval | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, job_id, card_id, project_id, plan, planning_mode, status, reviewer_notes, created_at, reviewed_at
       FROM plan_approvals WHERE id = ?`
    )
    .get(id) as
    | {
        id: string
        job_id: string
        card_id: string
        project_id: string
        plan: string
        planning_mode: string
        status: string
        reviewer_notes: string | null
        created_at: string
        reviewed_at: string | null
      }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    job_id: row.job_id,
    card_id: row.card_id,
    project_id: row.project_id,
    plan: row.plan,
    planning_mode: row.planning_mode as PlanningMode,
    status: row.status as PlanApprovalStatus,
    reviewer_notes: row.reviewer_notes ?? undefined,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at ?? undefined
  }
}

/**
 * Get a plan approval by job ID.
 */
export function getPlanApprovalByJob(jobId: string): PlanApproval | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, job_id, card_id, project_id, plan, planning_mode, status, reviewer_notes, created_at, reviewed_at
       FROM plan_approvals WHERE job_id = ?`
    )
    .get(jobId) as
    | {
        id: string
        job_id: string
        card_id: string
        project_id: string
        plan: string
        planning_mode: string
        status: string
        reviewer_notes: string | null
        created_at: string
        reviewed_at: string | null
      }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    job_id: row.job_id,
    card_id: row.card_id,
    project_id: row.project_id,
    plan: row.plan,
    planning_mode: row.planning_mode as PlanningMode,
    status: row.status as PlanApprovalStatus,
    reviewer_notes: row.reviewer_notes ?? undefined,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at ?? undefined
  }
}

/**
 * Get pending plan approvals for a project.
 */
export function getPendingApprovals(projectId: string): PlanApproval[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, job_id, card_id, project_id, plan, planning_mode, status, reviewer_notes, created_at, reviewed_at
       FROM plan_approvals WHERE project_id = ? AND status = 'pending' ORDER BY created_at ASC`
    )
    .all(projectId) as Array<{
    id: string
    job_id: string
    card_id: string
    project_id: string
    plan: string
    planning_mode: string
    status: string
    reviewer_notes: string | null
    created_at: string
    reviewed_at: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    job_id: row.job_id,
    card_id: row.card_id,
    project_id: row.project_id,
    plan: row.plan,
    planning_mode: row.planning_mode as PlanningMode,
    status: row.status as PlanApprovalStatus,
    reviewer_notes: row.reviewer_notes ?? undefined,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at ?? undefined
  }))
}

/**
 * Get all pending plan approvals across all projects.
 */
export function getAllPendingApprovals(): PlanApproval[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, job_id, card_id, project_id, plan, planning_mode, status, reviewer_notes, created_at, reviewed_at
       FROM plan_approvals WHERE status = 'pending' ORDER BY created_at ASC`
    )
    .all() as Array<{
    id: string
    job_id: string
    card_id: string
    project_id: string
    plan: string
    planning_mode: string
    status: string
    reviewer_notes: string | null
    created_at: string
    reviewed_at: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    job_id: row.job_id,
    card_id: row.card_id,
    project_id: row.project_id,
    plan: row.plan,
    planning_mode: row.planning_mode as PlanningMode,
    status: row.status as PlanApprovalStatus,
    reviewer_notes: row.reviewer_notes ?? undefined,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at ?? undefined
  }))
}

/**
 * Create a new plan approval request.
 */
export function createPlanApproval(data: PlanApprovalCreate): PlanApproval {
  const db = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO plan_approvals (id, job_id, card_id, project_id, plan, planning_mode, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(id, data.jobId, data.cardId, data.projectId, data.plan, data.planningMode, now)

  return {
    id,
    job_id: data.jobId,
    card_id: data.cardId,
    project_id: data.projectId,
    plan: data.plan,
    planning_mode: data.planningMode,
    status: 'pending',
    created_at: now
  }
}

/**
 * Approve a plan.
 */
export function approvePlan(id: string, notes?: string): PlanApproval | null {
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(
    `UPDATE plan_approvals SET status = 'approved', reviewer_notes = ?, reviewed_at = ? WHERE id = ?`
  ).run(notes ?? null, now, id)

  return getPlanApproval(id)
}

/**
 * Reject a plan.
 */
export function rejectPlan(id: string, notes?: string): PlanApproval | null {
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(
    `UPDATE plan_approvals SET status = 'rejected', reviewer_notes = ?, reviewed_at = ? WHERE id = ?`
  ).run(notes ?? null, now, id)

  return getPlanApproval(id)
}

/**
 * Skip approval (auto-approve).
 */
export function skipApproval(id: string): PlanApproval | null {
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(
    `UPDATE plan_approvals SET status = 'skipped', reviewed_at = ? WHERE id = ?`
  ).run(now, id)

  return getPlanApproval(id)
}

/**
 * Delete a plan approval.
 */
export function deletePlanApproval(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM plan_approvals WHERE id = ?').run(id)
}

/**
 * Delete plan approvals by job ID.
 */
export function deletePlanApprovalsByJob(jobId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM plan_approvals WHERE job_id = ?').run(jobId)
}
