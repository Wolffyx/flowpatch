/**
 * Plan Approvals Database Module
 *
 * Supports both central database (legacy) and project-local database.
 * Handles CRUD operations for plan approval requests.
 * Used when approvalRequired is enabled in planning config.
 */

import { asc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { planApprovals } from './schema'
import { planApprovals as projectPlanApprovals } from './schema/project'
import { generateId } from '@shared/utils'
import type { PlanApproval, PlanApprovalStatus, PlanningMode } from '@shared/types'
import { resolveProjectDb } from './db-resolver'

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
 * @param id - The approval ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getPlanApproval(id: string, projectId?: string): PlanApproval | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectPlanApprovals)
        .where(eq(projectPlanApprovals.id, id))
        .get()
      return row ? ({ ...row, project_id: projectId } as PlanApproval) : null
    }
    return (
      (db.select().from(planApprovals).where(eq(planApprovals.id, id)).get() as PlanApproval) ??
      null
    )
  }

  // Central DB fallback
  const db = getDrizzle()
  return (
    (db.select().from(planApprovals).where(eq(planApprovals.id, id)).get() as PlanApproval) ?? null
  )
}

/**
 * Get a plan approval by job ID.
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getPlanApprovalByJob(jobId: string, projectId?: string): PlanApproval | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectPlanApprovals)
        .where(eq(projectPlanApprovals.job_id, jobId))
        .get()
      return row ? ({ ...row, project_id: projectId } as PlanApproval) : null
    }
  }

  // Central DB fallback
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
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const rows = db
      .select()
      .from(projectPlanApprovals)
      .orderBy(asc(projectPlanApprovals.created_at))
      .all()
      .filter((row) => row.status === 'pending')
    return rows.map((r) => ({ ...r, project_id: projectId })) as PlanApproval[]
  }

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
 * Note: This only queries the central database for cross-project queries.
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
  const { db, isLocalDb } = resolveProjectDb(data.projectId)
  const id = generateId()
  const now = new Date().toISOString()

  if (isLocalDb) {
    db.insert(projectPlanApprovals)
      .values({
        id,
        job_id: data.jobId,
        card_id: data.cardId,
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
 * @param id - The approval ID
 * @param notes - Optional reviewer notes
 * @param projectId - Optional project ID for direct DB resolution
 */
export function approvePlan(id: string, notes?: string, projectId?: string): PlanApproval | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectPlanApprovals)
        .set({
          status: 'approved',
          reviewer_notes: notes ?? null,
          reviewed_at: now
        })
        .where(eq(projectPlanApprovals.id, id))
        .run()
      return getPlanApproval(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(planApprovals)
    .set({
      status: 'approved',
      reviewer_notes: notes ?? null,
      reviewed_at: now
    })
    .where(eq(planApprovals.id, id))
    .run()

  return getPlanApproval(id, projectId)
}

/**
 * Reject a plan.
 * @param id - The approval ID
 * @param notes - Optional reviewer notes
 * @param projectId - Optional project ID for direct DB resolution
 */
export function rejectPlan(id: string, notes?: string, projectId?: string): PlanApproval | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectPlanApprovals)
        .set({
          status: 'rejected',
          reviewer_notes: notes ?? null,
          reviewed_at: now
        })
        .where(eq(projectPlanApprovals.id, id))
        .run()
      return getPlanApproval(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(planApprovals)
    .set({
      status: 'rejected',
      reviewer_notes: notes ?? null,
      reviewed_at: now
    })
    .where(eq(planApprovals.id, id))
    .run()

  return getPlanApproval(id, projectId)
}

/**
 * Skip approval (auto-approve).
 * @param id - The approval ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function skipApproval(id: string, projectId?: string): PlanApproval | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectPlanApprovals)
        .set({
          status: 'skipped',
          reviewed_at: now
        })
        .where(eq(projectPlanApprovals.id, id))
        .run()
      return getPlanApproval(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(planApprovals)
    .set({
      status: 'skipped',
      reviewed_at: now
    })
    .where(eq(planApprovals.id, id))
    .run()

  return getPlanApproval(id, projectId)
}

/**
 * Delete a plan approval.
 * @param id - The approval ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deletePlanApproval(id: string, projectId?: string): void {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.delete(projectPlanApprovals).where(eq(projectPlanApprovals.id, id)).run()
      return
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.delete(planApprovals).where(eq(planApprovals.id, id)).run()
}

/**
 * Delete plan approvals by job ID.
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deletePlanApprovalsByJob(jobId: string, projectId?: string): void {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.delete(projectPlanApprovals).where(eq(projectPlanApprovals.job_id, jobId)).run()
      return
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.delete(planApprovals).where(eq(planApprovals.job_id, jobId)).run()
}
