/**
 * Plan Approvals Database Module
 *
 * Handles CRUD operations for plan approval requests.
 * Used when approvalRequired is enabled in planning config.
 */

import { asc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { planApprovals } from './schema'
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
  const db = getDrizzle()
  return (
    (db.select().from(planApprovals).where(eq(planApprovals.id, id)).get() as PlanApproval) ?? null
  )
}

/**
 * Get a plan approval by job ID.
 */
export function getPlanApprovalByJob(jobId: string): PlanApproval | null {
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(planApprovals)
      .where(eq(planApprovals.job_id, jobId))
      .get() as PlanApproval) ?? null
  )
}

/**
 * Get pending plan approvals for a project.
 */
export function getPendingApprovals(projectId: string): PlanApproval[] {
  const db = getDrizzle()
  return db
    .select()
    .from(planApprovals)
    .where(eq(planApprovals.project_id, projectId))
    .orderBy(asc(planApprovals.created_at))
    .all()
    .filter((row) => row.status === 'pending') as PlanApproval[]
}

/**
 * Get all pending plan approvals across all projects.
 */
export function getAllPendingApprovals(): PlanApproval[] {
  const db = getDrizzle()
  return db
    .select()
    .from(planApprovals)
    .orderBy(asc(planApprovals.created_at))
    .all()
    .filter((row) => row.status === 'pending') as PlanApproval[]
}

/**
 * Create a new plan approval request.
 */
export function createPlanApproval(data: PlanApprovalCreate): PlanApproval {
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

  db.insert(planApprovals)
    .values({
      id,
      job_id: data.jobId,
      card_id: data.cardId,
      project_id: data.projectId,
      plan: data.plan,
      planning_mode: data.planningMode,
      status: 'pending',
      created_at: now
    })
    .run()

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
  const db = getDrizzle()
  const now = new Date().toISOString()

  db.update(planApprovals)
    .set({
      status: 'approved',
      reviewer_notes: notes ?? null,
      reviewed_at: now
    })
    .where(eq(planApprovals.id, id))
    .run()

  return getPlanApproval(id)
}

/**
 * Reject a plan.
 */
export function rejectPlan(id: string, notes?: string): PlanApproval | null {
  const db = getDrizzle()
  const now = new Date().toISOString()

  db.update(planApprovals)
    .set({
      status: 'rejected',
      reviewer_notes: notes ?? null,
      reviewed_at: now
    })
    .where(eq(planApprovals.id, id))
    .run()

  return getPlanApproval(id)
}

/**
 * Skip approval (auto-approve).
 */
export function skipApproval(id: string): PlanApproval | null {
  const db = getDrizzle()
  const now = new Date().toISOString()

  db.update(planApprovals)
    .set({
      status: 'skipped',
      reviewed_at: now
    })
    .where(eq(planApprovals.id, id))
    .run()

  return getPlanApproval(id)
}

/**
 * Delete a plan approval.
 */
export function deletePlanApproval(id: string): void {
  const db = getDrizzle()
  db.delete(planApprovals).where(eq(planApprovals.id, id)).run()
}

/**
 * Delete plan approvals by job ID.
 */
export function deletePlanApprovalsByJob(jobId: string): void {
  const db = getDrizzle()
  db.delete(planApprovals).where(eq(planApprovals.job_id, jobId)).run()
}
