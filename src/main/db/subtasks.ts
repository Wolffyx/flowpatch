/**
 * Subtask Database Operations
 */

import { getDb } from './connection'
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
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM subtasks WHERE parent_card_id = ? ORDER BY sequence ASC')
  return stmt.all(parentCardId) as Subtask[]
}

/**
 * List subtasks for a project.
 */
export function listSubtasksByProject(projectId: string): Subtask[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM subtasks WHERE project_id = ? ORDER BY created_at DESC')
  return stmt.all(projectId) as Subtask[]
}

/**
 * Get a subtask by ID.
 */
export function getSubtask(id: string): Subtask | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM subtasks WHERE id = ?')
  return (stmt.get(id) as Subtask) ?? null
}

/**
 * Create a subtask.
 */
export function createSubtask(data: SubtaskCreate): Subtask {
  const d = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  d.prepare(
    `
    INSERT INTO subtasks (
      id, parent_card_id, project_id, title, description,
      estimated_minutes, sequence, status, remote_issue_number,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `
  ).run(
    id,
    data.parentCardId,
    data.projectId,
    data.title,
    data.description ?? null,
    data.estimatedMinutes ?? null,
    data.sequence,
    data.remoteIssueNumber ?? null,
    now,
    now
  )

  return d.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as Subtask
}

/**
 * Update subtask status.
 */
export function updateSubtaskStatus(id: string, status: SubtaskStatus): Subtask | null {
  const d = getDb()
  const now = new Date().toISOString()
  const completedAt = status === 'completed' ? now : null

  d.prepare('UPDATE subtasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
    status,
    completedAt,
    now,
    id
  )

  return getSubtask(id)
}

/**
 * Get next pending subtask.
 */
export function getNextPendingSubtask(parentCardId: string): Subtask | null {
  const d = getDb()
  const stmt = d.prepare(
    `SELECT * FROM subtasks
     WHERE parent_card_id = ? AND status = 'pending'
     ORDER BY sequence ASC LIMIT 1`
  )
  return (stmt.get(parentCardId) as Subtask) ?? null
}

/**
 * Delete a subtask.
 */
export function deleteSubtask(id: string): boolean {
  const d = getDb()
  const result = d.prepare('DELETE FROM subtasks WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Delete all subtasks for a card.
 */
export function deleteSubtasksByCard(cardId: string): number {
  const d = getDb()
  const result = d.prepare('DELETE FROM subtasks WHERE parent_card_id = ?').run(cardId)
  return result.changes
}
