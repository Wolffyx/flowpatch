/**
 * Worker Slot Database Operations
 */

import { and, asc, count, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { workerSlots } from './schema'
import { generateId } from '@shared/utils'
import type { WorkerSlot, WorkerSlotStatus } from '@shared/types'

export type { WorkerSlot, WorkerSlotStatus }

/**
 * List worker slots for a project.
 */
export function listWorkerSlots(projectId: string): WorkerSlot[] {
  const db = getDrizzle()
  return db
    .select()
    .from(workerSlots)
    .where(eq(workerSlots.project_id, projectId))
    .orderBy(asc(workerSlots.slot_number))
    .all() as WorkerSlot[]
}

/**
 * Get a worker slot by ID.
 */
export function getWorkerSlot(id: string): WorkerSlot | null {
  const db = getDrizzle()
  return (db.select().from(workerSlots).where(eq(workerSlots.id, id)).get() as WorkerSlot) ?? null
}

/**
 * Initialize worker slots for a project.
 */
export function initializeWorkerSlots(projectId: string, slotCount: number): void {
  const db = getDrizzle()
  const now = new Date().toISOString()

  // Delete existing slots for this project
  db.delete(workerSlots).where(eq(workerSlots.project_id, projectId)).run()

  // Create new slots
  for (let i = 0; i < slotCount; i++) {
    const id = generateId()
    db.insert(workerSlots)
      .values({
        id,
        project_id: projectId,
        slot_number: i,
        status: 'idle',
        updated_at: now
      })
      .run()
  }
}

/**
 * Acquire a worker slot.
 */
export function acquireWorkerSlot(projectId: string): WorkerSlot | null {
  const db = getDrizzle()
  const now = new Date().toISOString()

  // Find first idle slot
  const slot = db
    .select()
    .from(workerSlots)
    .where(and(eq(workerSlots.project_id, projectId), eq(workerSlots.status, 'idle')))
    .orderBy(asc(workerSlots.slot_number))
    .limit(1)
    .get() as WorkerSlot | undefined

  if (!slot) return null

  // Mark as running
  db.update(workerSlots)
    .set({
      status: 'running',
      started_at: now,
      updated_at: now
    })
    .where(eq(workerSlots.id, slot.id))
    .run()

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
  const db = getDrizzle()
  const now = new Date().toISOString()
  const existing = getWorkerSlot(id)
  if (!existing) return null

  db.update(workerSlots)
    .set({
      card_id: data.cardId !== undefined ? data.cardId : existing.card_id,
      job_id: data.jobId !== undefined ? data.jobId : existing.job_id,
      worktree_id: data.worktreeId !== undefined ? data.worktreeId : existing.worktree_id,
      status: data.status ?? existing.status,
      started_at: data.startedAt !== undefined ? data.startedAt : existing.started_at,
      updated_at: now
    })
    .where(eq(workerSlots.id, id))
    .run()

  return getWorkerSlot(id)
}

/**
 * Release a worker slot.
 */
export function releaseWorkerSlot(id: string): WorkerSlot | null {
  const db = getDrizzle()
  const now = new Date().toISOString()

  db.update(workerSlots)
    .set({
      card_id: null,
      job_id: null,
      worktree_id: null,
      status: 'idle',
      started_at: null,
      updated_at: now
    })
    .where(eq(workerSlots.id, id))
    .run()

  return getWorkerSlot(id)
}

/**
 * Get idle slot count.
 */
export function getIdleSlotCount(projectId: string): number {
  const db = getDrizzle()
  const result = db
    .select({ count: count() })
    .from(workerSlots)
    .where(and(eq(workerSlots.project_id, projectId), eq(workerSlots.status, 'idle')))
    .get()
  return result?.count ?? 0
}

/**
 * Get running slot count.
 */
export function getRunningSlotCount(projectId: string): number {
  const db = getDrizzle()
  const result = db
    .select({ count: count() })
    .from(workerSlots)
    .where(and(eq(workerSlots.project_id, projectId), eq(workerSlots.status, 'running')))
    .get()
  return result?.count ?? 0
}
