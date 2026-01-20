/**
 * Subtask Database Operations
 *
 * Supports both central database (legacy) and project-local database.
 */

import { asc, desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { subtasks } from './schema'
import { subtasks as projectSubtasks } from './schema/project'
import { generateId } from '@shared/utils'
import type { Subtask, SubtaskStatus } from '@shared/types'
import { resolveProjectDb } from './db-resolver'

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
 * @param parentCardId - The parent card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function listSubtasks(parentCardId: string, projectId?: string): Subtask[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectSubtasks)
        .where(eq(projectSubtasks.parent_card_id, parentCardId))
        .orderBy(asc(projectSubtasks.sequence))
        .all()
      return rows.map((r) => ({ ...r, project_id: projectId })) as Subtask[]
    }
  }

  // Central DB fallback
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
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const rows = db.select().from(projectSubtasks).orderBy(desc(projectSubtasks.created_at)).all()
    return rows.map((r) => ({ ...r, project_id: projectId })) as Subtask[]
  }

  return db
    .select()
    .from(subtasks)
    .where(eq(subtasks.project_id, projectId))
    .orderBy(desc(subtasks.created_at))
    .all() as Subtask[]
}

/**
 * Get a subtask by ID.
 * @param id - The subtask ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getSubtask(id: string, projectId?: string): Subtask | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db.select().from(projectSubtasks).where(eq(projectSubtasks.id, id)).get()
      return row ? ({ ...row, project_id: projectId } as Subtask) : null
    }
    return (db.select().from(subtasks).where(eq(subtasks.id, id)).get() as Subtask) ?? null
  }

  // Central DB fallback
  const db = getDrizzle()
  return (db.select().from(subtasks).where(eq(subtasks.id, id)).get() as Subtask) ?? null
}

/**
 * Create a subtask.
 */
export function createSubtask(data: SubtaskCreate): Subtask {
  const { db, isLocalDb } = resolveProjectDb(data.projectId)
  const id = generateId()
  const now = new Date().toISOString()

  if (isLocalDb) {
    db.insert(projectSubtasks)
      .values({
        id,
        parent_card_id: data.parentCardId,
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

    const row = db.select().from(projectSubtasks).where(eq(projectSubtasks.id, id)).get()
    return { ...row, project_id: data.projectId } as Subtask
  }

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
 * @param id - The subtask ID
 * @param status - The new status
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateSubtaskStatus(
  id: string,
  status: SubtaskStatus,
  projectId?: string
): Subtask | null {
  const now = new Date().toISOString()
  const completedAt = status === 'completed' ? now : null

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectSubtasks)
        .set({
          status,
          completed_at: completedAt,
          updated_at: now
        })
        .where(eq(projectSubtasks.id, id))
        .run()
      return getSubtask(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(subtasks)
    .set({
      status,
      completed_at: completedAt,
      updated_at: now
    })
    .where(eq(subtasks.id, id))
    .run()

  return getSubtask(id, projectId)
}

/**
 * Get next pending subtask.
 * @param parentCardId - The parent card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getNextPendingSubtask(parentCardId: string, projectId?: string): Subtask | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectSubtasks)
        .where(eq(projectSubtasks.parent_card_id, parentCardId))
        .orderBy(asc(projectSubtasks.sequence))
        .all()
      const pending = rows.find((s) => s.status === 'pending')
      return pending ? ({ ...pending, project_id: projectId } as Subtask) : null
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const rows = db
    .select()
    .from(subtasks)
    .where(eq(subtasks.parent_card_id, parentCardId))
    .orderBy(asc(subtasks.sequence))
    .limit(1)
    .all()
  return (rows.find((s) => s.status === 'pending') as Subtask) ?? null
}

/**
 * Delete a subtask.
 * @param id - The subtask ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteSubtask(id: string, projectId?: string): boolean {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db.delete(projectSubtasks).where(eq(projectSubtasks.id, id)).run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db.delete(subtasks).where(eq(subtasks.id, id)).run()
  return result.changes > 0
}

/**
 * Delete all subtasks for a card.
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteSubtasksByCard(cardId: string, projectId?: string): number {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .delete(projectSubtasks)
        .where(eq(projectSubtasks.parent_card_id, cardId))
        .run()
      return result.changes
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db.delete(subtasks).where(eq(subtasks.parent_card_id, cardId)).run()
  return result.changes
}
