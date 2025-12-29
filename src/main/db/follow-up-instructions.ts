/**
 * Follow-up Instructions Database Module
 *
 * Handles CRUD operations for follow-up instructions.
 * Used for providing feedback to running or paused workers.
 */

import { getDb } from './connection'
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

interface DbRow {
  id: string
  job_id: string
  card_id: string
  project_id: string
  instruction_type: string
  content: string
  status: string
  priority: number
  created_at: string
  processed_at: string | null
}

function rowToInstruction(row: DbRow): FollowUpInstruction {
  return {
    id: row.id,
    job_id: row.job_id,
    card_id: row.card_id,
    project_id: row.project_id,
    instruction_type: row.instruction_type as FollowUpInstructionType,
    content: row.content,
    status: row.status as FollowUpInstructionStatus,
    priority: row.priority,
    created_at: row.created_at,
    processed_at: row.processed_at ?? undefined
  }
}

/**
 * Get a follow-up instruction by ID.
 */
export function getFollowUpInstruction(id: string): FollowUpInstruction | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, job_id, card_id, project_id, instruction_type, content, status, priority, created_at, processed_at
       FROM follow_up_instructions WHERE id = ?`
    )
    .get(id) as DbRow | undefined

  if (!row) return null
  return rowToInstruction(row)
}

/**
 * Get all follow-up instructions for a job.
 */
export function getFollowUpInstructionsByJob(jobId: string): FollowUpInstruction[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, job_id, card_id, project_id, instruction_type, content, status, priority, created_at, processed_at
       FROM follow_up_instructions WHERE job_id = ? ORDER BY priority DESC, created_at ASC`
    )
    .all(jobId) as DbRow[]

  return rows.map(rowToInstruction)
}

/**
 * Get pending follow-up instructions for a job.
 */
export function getPendingFollowUpInstructions(jobId: string): FollowUpInstruction[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, job_id, card_id, project_id, instruction_type, content, status, priority, created_at, processed_at
       FROM follow_up_instructions WHERE job_id = ? AND status = 'pending' ORDER BY priority DESC, created_at ASC`
    )
    .all(jobId) as DbRow[]

  return rows.map(rowToInstruction)
}

/**
 * Get all pending follow-up instructions for a project.
 */
export function getPendingInstructionsByProject(projectId: string): FollowUpInstruction[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, job_id, card_id, project_id, instruction_type, content, status, priority, created_at, processed_at
       FROM follow_up_instructions WHERE project_id = ? AND status = 'pending' ORDER BY priority DESC, created_at ASC`
    )
    .all(projectId) as DbRow[]

  return rows.map(rowToInstruction)
}

/**
 * Get all pending follow-up instructions for a card.
 */
export function getPendingInstructionsByCard(cardId: string): FollowUpInstruction[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, job_id, card_id, project_id, instruction_type, content, status, priority, created_at, processed_at
       FROM follow_up_instructions WHERE card_id = ? AND status = 'pending' ORDER BY priority DESC, created_at ASC`
    )
    .all(cardId) as DbRow[]

  return rows.map(rowToInstruction)
}

/**
 * Create a new follow-up instruction.
 */
export function createFollowUpInstruction(data: FollowUpInstructionCreate): FollowUpInstruction {
  const db = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO follow_up_instructions (id, job_id, card_id, project_id, instruction_type, content, status, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(id, data.jobId, data.cardId, data.projectId, data.instructionType, data.content, data.priority ?? 0, now)

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
  const db = getDb()
  db.prepare(`UPDATE follow_up_instructions SET status = 'processing' WHERE id = ?`).run(id)
  return getFollowUpInstruction(id)
}

/**
 * Mark an instruction as applied.
 */
export function markInstructionApplied(id: string): FollowUpInstruction | null {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(`UPDATE follow_up_instructions SET status = 'applied', processed_at = ? WHERE id = ?`).run(now, id)
  return getFollowUpInstruction(id)
}

/**
 * Mark an instruction as rejected.
 */
export function markInstructionRejected(id: string): FollowUpInstruction | null {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(`UPDATE follow_up_instructions SET status = 'rejected', processed_at = ? WHERE id = ?`).run(now, id)
  return getFollowUpInstruction(id)
}

/**
 * Delete a follow-up instruction.
 */
export function deleteFollowUpInstruction(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM follow_up_instructions WHERE id = ?').run(id)
}

/**
 * Delete all follow-up instructions for a job.
 */
export function deleteFollowUpInstructionsByJob(jobId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM follow_up_instructions WHERE job_id = ?').run(jobId)
}

/**
 * Count pending instructions for a job.
 */
export function countPendingInstructions(jobId: string): number {
  const db = getDb()
  const result = db
    .prepare(`SELECT COUNT(*) as count FROM follow_up_instructions WHERE job_id = ? AND status = 'pending'`)
    .get(jobId) as { count: number }
  return result.count
}

/**
 * Get the next pending instruction for a job (by priority and creation time).
 */
export function getNextPendingInstruction(jobId: string): FollowUpInstruction | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, job_id, card_id, project_id, instruction_type, content, status, priority, created_at, processed_at
       FROM follow_up_instructions WHERE job_id = ? AND status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1`
    )
    .get(jobId) as DbRow | undefined

  if (!row) return null
  return rowToInstruction(row)
}
