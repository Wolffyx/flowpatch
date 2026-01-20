/**
 * Follow-up Instructions Database Module
 *
 * Supports both central database (legacy) and project-local database.
 * Handles CRUD operations for follow-up instructions.
 * Used for providing feedback to running or paused workers.
 */

import { and, asc, count, desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { followUpInstructions } from './schema'
import { followUpInstructions as projectFollowUpInstructions } from './schema/project'
import { generateId } from '@shared/utils'
import type {
  FollowUpInstruction,
  FollowUpInstructionStatus,
  FollowUpInstructionType
} from '@shared/types'
import { resolveProjectDb } from './db-resolver'

export type { FollowUpInstruction, FollowUpInstructionStatus, FollowUpInstructionType }

export interface FollowUpInstructionCreate {
  jobId: string
  cardId: string
  projectId: string
  instructionType: FollowUpInstructionType
  content: string
  priority?: number
}

/**
 * Get a follow-up instruction by ID.
 * @param id - The instruction ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getFollowUpInstruction(id: string, projectId?: string): FollowUpInstruction | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectFollowUpInstructions)
        .where(eq(projectFollowUpInstructions.id, id))
        .get()
      return row ? ({ ...row, project_id: projectId } as FollowUpInstruction) : null
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(followUpInstructions)
      .where(eq(followUpInstructions.id, id))
      .get() as FollowUpInstruction) ?? null
  )
}

/**
 * Get all follow-up instructions for a job.
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getFollowUpInstructionsByJob(
  jobId: string,
  projectId?: string
): FollowUpInstruction[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectFollowUpInstructions)
        .where(eq(projectFollowUpInstructions.job_id, jobId))
        .orderBy(
          desc(projectFollowUpInstructions.priority),
          asc(projectFollowUpInstructions.created_at)
        )
        .all()
      return rows.map((r) => ({ ...r, project_id: projectId })) as FollowUpInstruction[]
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  return db
    .select()
    .from(followUpInstructions)
    .where(eq(followUpInstructions.job_id, jobId))
    .orderBy(desc(followUpInstructions.priority), asc(followUpInstructions.created_at))
    .all() as FollowUpInstruction[]
}

/**
 * Get pending follow-up instructions for a job.
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getPendingFollowUpInstructions(
  jobId: string,
  projectId?: string
): FollowUpInstruction[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectFollowUpInstructions)
        .where(
          and(
            eq(projectFollowUpInstructions.job_id, jobId),
            eq(projectFollowUpInstructions.status, 'pending')
          )
        )
        .orderBy(
          desc(projectFollowUpInstructions.priority),
          asc(projectFollowUpInstructions.created_at)
        )
        .all()
      return rows.map((r) => ({ ...r, project_id: projectId })) as FollowUpInstruction[]
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  return db
    .select()
    .from(followUpInstructions)
    .where(and(eq(followUpInstructions.job_id, jobId), eq(followUpInstructions.status, 'pending')))
    .orderBy(desc(followUpInstructions.priority), asc(followUpInstructions.created_at))
    .all() as FollowUpInstruction[]
}

/**
 * Get all pending follow-up instructions for a project.
 */
export function getPendingInstructionsByProject(projectId: string): FollowUpInstruction[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const rows = db
      .select()
      .from(projectFollowUpInstructions)
      .where(eq(projectFollowUpInstructions.status, 'pending'))
      .orderBy(
        desc(projectFollowUpInstructions.priority),
        asc(projectFollowUpInstructions.created_at)
      )
      .all()
    return rows.map((r) => ({ ...r, project_id: projectId })) as FollowUpInstruction[]
  }

  return db
    .select()
    .from(followUpInstructions)
    .where(
      and(
        eq(followUpInstructions.project_id, projectId),
        eq(followUpInstructions.status, 'pending')
      )
    )
    .orderBy(desc(followUpInstructions.priority), asc(followUpInstructions.created_at))
    .all() as FollowUpInstruction[]
}

/**
 * Get all pending follow-up instructions for a card.
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getPendingInstructionsByCard(
  cardId: string,
  projectId?: string
): FollowUpInstruction[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectFollowUpInstructions)
        .where(
          and(
            eq(projectFollowUpInstructions.card_id, cardId),
            eq(projectFollowUpInstructions.status, 'pending')
          )
        )
        .orderBy(
          desc(projectFollowUpInstructions.priority),
          asc(projectFollowUpInstructions.created_at)
        )
        .all()
      return rows.map((r) => ({ ...r, project_id: projectId })) as FollowUpInstruction[]
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  return db
    .select()
    .from(followUpInstructions)
    .where(
      and(eq(followUpInstructions.card_id, cardId), eq(followUpInstructions.status, 'pending'))
    )
    .orderBy(desc(followUpInstructions.priority), asc(followUpInstructions.created_at))
    .all() as FollowUpInstruction[]
}

/**
 * Create a new follow-up instruction.
 */
export function createFollowUpInstruction(data: FollowUpInstructionCreate): FollowUpInstruction {
  const { db, isLocalDb } = resolveProjectDb(data.projectId)
  const id = generateId()
  const now = new Date().toISOString()

  if (isLocalDb) {
    db.insert(projectFollowUpInstructions)
      .values({
        id,
        job_id: data.jobId,
        card_id: data.cardId,
        instruction_type: data.instructionType,
        content: data.content,
        status: 'pending',
        priority: data.priority ?? 0,
        created_at: now
      })
      .run()

    return {
      id,
      job_id: data.jobId,
      card_id: data.cardId,
      project_id: data.projectId,
      instruction_type: data.instructionType,
      content: data.content,
      status: 'pending',
      priority: data.priority ?? 0,
      created_at: now
    }
  }

  db.insert(followUpInstructions)
    .values({
      id,
      job_id: data.jobId,
      card_id: data.cardId,
      project_id: data.projectId,
      instruction_type: data.instructionType,
      content: data.content,
      status: 'pending',
      priority: data.priority ?? 0,
      created_at: now
    })
    .run()

  return {
    id,
    job_id: data.jobId,
    card_id: data.cardId,
    project_id: data.projectId,
    instruction_type: data.instructionType,
    content: data.content,
    status: 'pending',
    priority: data.priority ?? 0,
    created_at: now
  }
}

/**
 * Mark an instruction as processing.
 * @param id - The instruction ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function markInstructionProcessing(
  id: string,
  projectId?: string
): FollowUpInstruction | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectFollowUpInstructions)
        .set({ status: 'processing' })
        .where(eq(projectFollowUpInstructions.id, id))
        .run()
      return getFollowUpInstruction(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(followUpInstructions)
    .set({ status: 'processing' })
    .where(eq(followUpInstructions.id, id))
    .run()
  return getFollowUpInstruction(id, projectId)
}

/**
 * Mark an instruction as applied.
 * @param id - The instruction ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function markInstructionApplied(id: string, projectId?: string): FollowUpInstruction | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectFollowUpInstructions)
        .set({ status: 'applied', processed_at: now })
        .where(eq(projectFollowUpInstructions.id, id))
        .run()
      return getFollowUpInstruction(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(followUpInstructions)
    .set({ status: 'applied', processed_at: now })
    .where(eq(followUpInstructions.id, id))
    .run()
  return getFollowUpInstruction(id, projectId)
}

/**
 * Mark an instruction as rejected.
 * @param id - The instruction ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function markInstructionRejected(
  id: string,
  projectId?: string
): FollowUpInstruction | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectFollowUpInstructions)
        .set({ status: 'rejected', processed_at: now })
        .where(eq(projectFollowUpInstructions.id, id))
        .run()
      return getFollowUpInstruction(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(followUpInstructions)
    .set({ status: 'rejected', processed_at: now })
    .where(eq(followUpInstructions.id, id))
    .run()
  return getFollowUpInstruction(id, projectId)
}

/**
 * Delete a follow-up instruction.
 * @param id - The instruction ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteFollowUpInstruction(id: string, projectId?: string): void {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.delete(projectFollowUpInstructions).where(eq(projectFollowUpInstructions.id, id)).run()
      return
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.delete(followUpInstructions).where(eq(followUpInstructions.id, id)).run()
}

/**
 * Delete all follow-up instructions for a job.
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteFollowUpInstructionsByJob(jobId: string, projectId?: string): void {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.delete(projectFollowUpInstructions)
        .where(eq(projectFollowUpInstructions.job_id, jobId))
        .run()
      return
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.delete(followUpInstructions).where(eq(followUpInstructions.job_id, jobId)).run()
}

/**
 * Count pending instructions for a job.
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function countPendingInstructions(jobId: string, projectId?: string): number {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .select({ count: count() })
        .from(projectFollowUpInstructions)
        .where(
          and(
            eq(projectFollowUpInstructions.job_id, jobId),
            eq(projectFollowUpInstructions.status, 'pending')
          )
        )
        .get()
      return result?.count ?? 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db
    .select({ count: count() })
    .from(followUpInstructions)
    .where(and(eq(followUpInstructions.job_id, jobId), eq(followUpInstructions.status, 'pending')))
    .get()
  return result?.count ?? 0
}

/**
 * Get the next pending instruction for a job (by priority and creation time).
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getNextPendingInstruction(
  jobId: string,
  projectId?: string
): FollowUpInstruction | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectFollowUpInstructions)
        .where(
          and(
            eq(projectFollowUpInstructions.job_id, jobId),
            eq(projectFollowUpInstructions.status, 'pending')
          )
        )
        .orderBy(
          desc(projectFollowUpInstructions.priority),
          asc(projectFollowUpInstructions.created_at)
        )
        .limit(1)
        .get()
      return row ? ({ ...row, project_id: projectId } as FollowUpInstruction) : null
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(followUpInstructions)
      .where(
        and(eq(followUpInstructions.job_id, jobId), eq(followUpInstructions.status, 'pending'))
      )
      .orderBy(desc(followUpInstructions.priority), asc(followUpInstructions.created_at))
      .limit(1)
      .get() as FollowUpInstruction) ?? null
  )
}
