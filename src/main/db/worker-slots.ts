/**
 * Worker Slot Database Operations
 */

import { getDb } from './connection'
import { generateId } from '@shared/utils'
import type { WorkerSlot, WorkerSlotStatus } from '@shared/types'

export type { WorkerSlot, WorkerSlotStatus }

/**
 * List worker slots for a project.
 */
export function listWorkerSlots(projectId: string): WorkerSlot[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worker_slots WHERE project_id = ? ORDER BY slot_number ASC')
  return stmt.all(projectId) as WorkerSlot[]
}

/**
 * Get a worker slot by ID.
 */
export function getWorkerSlot(id: string): WorkerSlot | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worker_slots WHERE id = ?')
  return (stmt.get(id) as WorkerSlot) ?? null
}

/**
 * Initialize worker slots for a project.
 */
export function initializeWorkerSlots(projectId: string, count: number): void {
  const d = getDb()
  const now = new Date().toISOString()

  // Delete existing slots for this project
  d.prepare('DELETE FROM worker_slots WHERE project_id = ?').run(projectId)

  // Create new slots
  const insertStmt = d.prepare(
    `INSERT INTO worker_slots (id, project_id, slot_number, status, updated_at)
     VALUES (?, ?, ?, 'idle', ?)`
  )

  for (let i = 0; i < count; i++) {
    const id = generateId()
    insertStmt.run(id, projectId, i, now)
  }
}

/**
 * Acquire a worker slot.
 */
export function acquireWorkerSlot(projectId: string): WorkerSlot | null {
  const d = getDb()
  const now = new Date().toISOString()

  // Find first idle slot
  const slot = d
    .prepare(
      `SELECT * FROM worker_slots
       WHERE project_id = ? AND status = 'idle'
       ORDER BY slot_number ASC LIMIT 1`
    )
    .get(projectId) as WorkerSlot | undefined

  if (!slot) return null

  // Mark as running
  d.prepare(
    `UPDATE worker_slots SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`
  ).run(now, now, slot.id)

  return getWorkerSlot(slot.id)
}

/**
 * Update a worker slot.
 */
export function updateWorkerSlot(
  id: string,
  data: {
    cardId?: string | null
    jobId?: string | null
    worktreeId?: string | null
    status?: WorkerSlotStatus
    startedAt?: string | null
  }
): WorkerSlot | null {
  const d = getDb()
  const now = new Date().toISOString()
  const existing = getWorkerSlot(id)
  if (!existing) return null

  d.prepare(
    `UPDATE worker_slots SET
      card_id = ?, job_id = ?, worktree_id = ?, status = ?, started_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    data.cardId !== undefined ? data.cardId : existing.card_id,
    data.jobId !== undefined ? data.jobId : existing.job_id,
    data.worktreeId !== undefined ? data.worktreeId : existing.worktree_id,
    data.status ?? existing.status,
    data.startedAt !== undefined ? data.startedAt : existing.started_at,
    now,
    id
  )

  return getWorkerSlot(id)
}

/**
 * Release a worker slot.
 */
export function releaseWorkerSlot(id: string): WorkerSlot | null {
  const d = getDb()
  const now = new Date().toISOString()

  d.prepare(
    `UPDATE worker_slots SET
      card_id = NULL, job_id = NULL, worktree_id = NULL,
      status = 'idle', started_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(now, id)

  return getWorkerSlot(id)
}

/**
 * Get idle slot count.
 */
export function getIdleSlotCount(projectId: string): number {
  const d = getDb()
  const result = d
    .prepare(
      `SELECT COUNT(*) as count FROM worker_slots
       WHERE project_id = ? AND status = 'idle'`
    )
    .get(projectId) as { count: number }
  return result.count
}

/**
 * Get running slot count.
 */
export function getRunningSlotCount(projectId: string): number {
  const d = getDb()
  const result = d
    .prepare(
      `SELECT COUNT(*) as count FROM worker_slots
       WHERE project_id = ? AND status = 'running'`
    )
    .get(projectId) as { count: number }
  return result.count
}
