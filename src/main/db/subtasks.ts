/**
 * Subtask Database Operations
 */

import { asc, desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { subtasks } from './schema'
import { generateId } from '@shared/utils'
import type { Subtask, SubtaskStatus } from '@shared/types'

export type { Subtask, SubtaskStatus }

export interface SubtaskCreate {
  parentCardId: string
  projectId: string
  title: string
  description?: string
  estimatedMinutes?: number
  sequence: number
  remoteIssueNumber?: string
}

/**
 * List subtasks for a card.
 */
export function listSubtasks(parentCardId: string): Subtask[] {
  const db = getDrizzle()
  return db
    .select()
    .from(subtasks)
    .where(eq(subtasks.parent_card_id, parentCardId))
    .orderBy(asc(subtasks.sequence))
    .all() as Subtask[]
}

/**
 * List subtasks for a project.
 */
export function listSubtasksByProject(projectId: string): Subtask[] {
  const db = getDrizzle()
  return db
    .select()
    .from(subtasks)
    .where(eq(subtasks.project_id, projectId))
    .orderBy(desc(subtasks.created_at))
    .all() as Subtask[]
}

/**
 * Get a subtask by ID.
 */
export function getSubtask(id: string): Subtask | null {
  const db = getDrizzle()
  return (db.select().from(subtasks).where(eq(subtasks.id, id)).get() as Subtask) ?? null
}

/**
 * Create a subtask.
 */
export function createSubtask(data: SubtaskCreate): Subtask {
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

  db.insert(subtasks)
    .values({
      id,
      parent_card_id: data.parentCardId,
      project_id: data.projectId,
      title: data.title,
      description: data.description ?? null,
      estimated_minutes: data.estimatedMinutes ?? null,
      sequence: data.sequence,
      status: 'pending',
      remote_issue_number: data.remoteIssueNumber ?? null,
      created_at: now,
      updated_at: now
    })
    .run()

  return db.select().from(subtasks).where(eq(subtasks.id, id)).get() as Subtask
}

/**
 * Update subtask status.
 */
export function updateSubtaskStatus(id: string, status: SubtaskStatus): Subtask | null {
  const db = getDrizzle()
  const now = new Date().toISOString()
  const completedAt = status === 'completed' ? now : null

  db.update(subtasks)
    .set({
      status,
      completed_at: completedAt,
      updated_at: now
    })
    .where(eq(subtasks.id, id))
    .run()

  return getSubtask(id)
}

/**
 * Get next pending subtask.
 */
export function getNextPendingSubtask(parentCardId: string): Subtask | null {
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(subtasks)
      .where(eq(subtasks.parent_card_id, parentCardId))
      .orderBy(asc(subtasks.sequence))
      .limit(1)
      .all()
      .find((s) => s.status === 'pending') as Subtask) ?? null
  )
}

/**
 * Delete a subtask.
 */
export function deleteSubtask(id: string): boolean {
  const db = getDrizzle()
  const result = db.delete(subtasks).where(eq(subtasks.id, id)).run()
  return result.changes > 0
}

/**
 * Delete all subtasks for a card.
 */
export function deleteSubtasksByCard(cardId: string): number {
  const db = getDrizzle()
  const result = db.delete(subtasks).where(eq(subtasks.parent_card_id, cardId)).run()
  return result.changes
}
