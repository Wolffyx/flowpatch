/**
 * Follow-up Instructions Database Module
 *
 * Handles CRUD operations for follow-up instructions.
 * Used for providing feedback to running or paused workers.
 */

import { and, asc, count, desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { followUpInstructions } from './schema'
import { generateId } from '@shared/utils'
import type {
  FollowUpInstruction,
  FollowUpInstructionStatus,
  FollowUpInstructionType
} from '@shared/types'

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
 */
export function getFollowUpInstruction(id: string): FollowUpInstruction | null {
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
 */
export function getFollowUpInstructionsByJob(jobId: string): FollowUpInstruction[] {
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
 */
export function getPendingFollowUpInstructions(jobId: string): FollowUpInstruction[] {
  const db = getDrizzle()
  return db
    .select()
    .from(followUpInstructions)
    .where(
      and(eq(followUpInstructions.job_id, jobId), eq(followUpInstructions.status, 'pending'))
    )
    .orderBy(desc(followUpInstructions.priority), asc(followUpInstructions.created_at))
    .all() as FollowUpInstruction[]
}

/**
 * Get all pending follow-up instructions for a project.
 */
export function getPendingInstructionsByProject(projectId: string): FollowUpInstruction[] {
  const db = getDrizzle()
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
 */
export function getPendingInstructionsByCard(cardId: string): FollowUpInstruction[] {
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
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

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
 */
export function markInstructionProcessing(id: string): FollowUpInstruction | null {
  const db = getDrizzle()
  db.update(followUpInstructions)
    .set({ status: 'processing' })
    .where(eq(followUpInstructions.id, id))
    .run()
  return getFollowUpInstruction(id)
}

/**
 * Mark an instruction as applied.
 */
export function markInstructionApplied(id: string): FollowUpInstruction | null {
  const db = getDrizzle()
  const now = new Date().toISOString()
  db.update(followUpInstructions)
    .set({ status: 'applied', processed_at: now })
    .where(eq(followUpInstructions.id, id))
    .run()
  return getFollowUpInstruction(id)
}

/**
 * Mark an instruction as rejected.
 */
export function markInstructionRejected(id: string): FollowUpInstruction | null {
  const db = getDrizzle()
  const now = new Date().toISOString()
  db.update(followUpInstructions)
    .set({ status: 'rejected', processed_at: now })
    .where(eq(followUpInstructions.id, id))
    .run()
  return getFollowUpInstruction(id)
}

/**
 * Delete a follow-up instruction.
 */
export function deleteFollowUpInstruction(id: string): void {
  const db = getDrizzle()
  db.delete(followUpInstructions).where(eq(followUpInstructions.id, id)).run()
}

/**
 * Delete all follow-up instructions for a job.
 */
export function deleteFollowUpInstructionsByJob(jobId: string): void {
  const db = getDrizzle()
  db.delete(followUpInstructions).where(eq(followUpInstructions.job_id, jobId)).run()
}

/**
 * Count pending instructions for a job.
 */
export function countPendingInstructions(jobId: string): number {
  const db = getDrizzle()
  const result = db
    .select({ count: count() })
    .from(followUpInstructions)
    .where(
      and(eq(followUpInstructions.job_id, jobId), eq(followUpInstructions.status, 'pending'))
    )
    .get()
  return result?.count ?? 0
}

/**
 * Get the next pending instruction for a job (by priority and creation time).
 */
export function getNextPendingInstruction(jobId: string): FollowUpInstruction | null {
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
