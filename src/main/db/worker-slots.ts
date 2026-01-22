/**
 * Worker Slot Database Operations
 *
 * Supports both central database (legacy) and project-local database.
 */

import { and, asc, count, eq, inArray } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { workerSlots } from './schema'
import { workerSlots as projectWorkerSlots } from './schema/project'
import { generateId } from '@shared/utils'
import type { WorkerSlot, WorkerSlotStatus } from '@shared/types'
import { resolveProjectDb } from './db-resolver'
import { getRunningJobs, cancelJob } from './jobs'
import { jobs } from './schema'
import { jobs as projectJobs } from './schema/project'

export type { WorkerSlot, WorkerSlotStatus }

/**
 * List worker slots for a project.
 */
export function listWorkerSlots(projectId: string): WorkerSlot[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const rows = db
      .select()
      .from(projectWorkerSlots)
      .orderBy(asc(projectWorkerSlots.slot_number))
      .all()
    return rows.map((r) => ({ ...r, project_id: projectId })) as WorkerSlot[]
  }

  return db
    .select()
    .from(workerSlots)
    .where(eq(workerSlots.project_id, projectId))
    .orderBy(asc(workerSlots.slot_number))
    .all() as WorkerSlot[]
}

/**
 * Get a worker slot by ID.
 * @param id - The slot ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getWorkerSlot(id: string, projectId?: string): WorkerSlot | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db.select().from(projectWorkerSlots).where(eq(projectWorkerSlots.id, id)).get()
      return row ? ({ ...row, project_id: projectId } as WorkerSlot) : null
    }
    return (db.select().from(workerSlots).where(eq(workerSlots.id, id)).get() as WorkerSlot) ?? null
  }

  // Central DB fallback
  const db = getDrizzle()
  return (db.select().from(workerSlots).where(eq(workerSlots.id, id)).get() as WorkerSlot) ?? null
}

/**
 * Initialize worker slots for a project.
 */
export function initializeWorkerSlots(projectId: string, slotCount: number): void {
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const now = new Date().toISOString()

  if (isLocalDb) {
    // Delete existing slots
    db.delete(projectWorkerSlots).run()

    // Create new slots
    for (let i = 0; i < slotCount; i++) {
      const id = generateId()
      db.insert(projectWorkerSlots)
        .values({
          id,
          slot_number: i,
          status: 'idle',
          updated_at: now
        })
        .run()
    }
    return
  }

  // Central DB
  db.delete(workerSlots).where(eq(workerSlots.project_id, projectId)).run()

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
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const now = new Date().toISOString()

  if (isLocalDb) {
    const slot = db
      .select()
      .from(projectWorkerSlots)
      .where(eq(projectWorkerSlots.status, 'idle'))
      .orderBy(asc(projectWorkerSlots.slot_number))
      .limit(1)
      .get()

    if (!slot) return null

    db.update(projectWorkerSlots)
      .set({
        status: 'running',
        started_at: now,
        updated_at: now
      })
      .where(eq(projectWorkerSlots.id, slot.id))
      .run()

    return getWorkerSlot(slot.id, projectId)
  }

  // Central DB
  const slot = db
    .select()
    .from(workerSlots)
    .where(and(eq(workerSlots.project_id, projectId), eq(workerSlots.status, 'idle')))
    .orderBy(asc(workerSlots.slot_number))
    .limit(1)
    .get() as WorkerSlot | undefined

  if (!slot) return null

  db.update(workerSlots)
    .set({
      status: 'running',
      started_at: now,
      updated_at: now
    })
    .where(eq(workerSlots.id, slot.id))
    .run()

  return getWorkerSlot(slot.id, projectId)
}

/**
 * Update a worker slot.
 * @param id - The slot ID
 * @param data - The update data
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateWorkerSlot(
  id: string,
  data: {
    cardId?: string | null
    jobId?: string | null
    worktreeId?: string | null
    status?: WorkerSlotStatus
    startedAt?: string | null
  },
  projectId?: string
): WorkerSlot | null {
  const now = new Date().toISOString()
  const existing = getWorkerSlot(id, projectId)
  if (!existing) return null

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectWorkerSlots)
        .set({
          card_id: data.cardId !== undefined ? data.cardId : existing.card_id,
          job_id: data.jobId !== undefined ? data.jobId : existing.job_id,
          worktree_id: data.worktreeId !== undefined ? data.worktreeId : existing.worktree_id,
          status: data.status ?? existing.status,
          started_at: data.startedAt !== undefined ? data.startedAt : existing.started_at,
          updated_at: now
        })
        .where(eq(projectWorkerSlots.id, id))
        .run()
      return getWorkerSlot(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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

  return getWorkerSlot(id, projectId)
}

/**
 * Release a worker slot.
 * @param id - The slot ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function releaseWorkerSlot(id: string, projectId?: string): WorkerSlot | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectWorkerSlots)
        .set({
          card_id: null,
          job_id: null,
          worktree_id: null,
          status: 'idle',
          started_at: null,
          updated_at: now
        })
        .where(eq(projectWorkerSlots.id, id))
        .run()
      return getWorkerSlot(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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

  return getWorkerSlot(id, projectId)
}

/**
 * Get idle slot count.
 */
export function getIdleSlotCount(projectId: string): number {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const result = db
      .select({ count: count() })
      .from(projectWorkerSlots)
      .where(eq(projectWorkerSlots.status, 'idle'))
      .get()
    return result?.count ?? 0
  }

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
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const result = db
      .select({ count: count() })
      .from(projectWorkerSlots)
      .where(eq(projectWorkerSlots.status, 'running'))
      .get()
    return result?.count ?? 0
  }

  const result = db
    .select({ count: count() })
    .from(workerSlots)
    .where(and(eq(workerSlots.project_id, projectId), eq(workerSlots.status, 'running')))
    .get()
  return result?.count ?? 0
}

/**
 * Reset worker state for a project.
 * Cancels all running/queued worker jobs and releases all running slots.
 * @param projectId - The project ID
 * @returns Summary of canceled jobs and released slots
 */
export function resetWorkerState(projectId: string): { canceledJobs: number; releasedSlots: number } {
  let canceledJobs = 0
  let releasedSlots = 0

  // Get all running jobs and filter for worker_run type
  const runningJobs = getRunningJobs(projectId)
  const workerJobs = runningJobs.filter((job) => job.type === 'worker_run')

  // Also get queued worker jobs
  const { db, isLocalDb } = resolveProjectDb(projectId)

  let queuedWorkerJobs: typeof runningJobs = []
  if (isLocalDb) {
    queuedWorkerJobs = db
      .select()
      .from(projectJobs)
      .where(and(eq(projectJobs.type, 'worker_run'), eq(projectJobs.state, 'queued')))
      .all()
  } else {
    queuedWorkerJobs = db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.project_id, projectId),
          eq(jobs.type, 'worker_run'),
          eq(jobs.state, 'queued')
        )
      )
      .all()
  }

  // Cancel all worker jobs (running and queued)
  const allWorkerJobs = [...workerJobs, ...queuedWorkerJobs]
  for (const job of allWorkerJobs) {
    if (cancelJob(job.id, 'Worker state reset', projectId)) {
      canceledJobs++
    }
  }

  // Get all running slots and release them
  const allSlots = listWorkerSlots(projectId)
  const runningSlots = allSlots.filter((slot) => slot.status === 'running')
  for (const slot of runningSlots) {
    const released = releaseWorkerSlot(slot.id, projectId)
    if (released) {
      releasedSlots++
    }
  }

  // Delete all failed and canceled worker_run jobs to clear cooldowns
  // This allows cards to be immediately retried after reset
  let deletedFailedJobs = 0
  if (isLocalDb) {
    const result = db
      .delete(projectJobs)
      .where(
        and(
          eq(projectJobs.type, 'worker_run'),
          inArray(projectJobs.state, ['failed', 'canceled'])
        )
      )
      .run()
    deletedFailedJobs = result.changes
  } else {
    const result = db
      .delete(jobs)
      .where(
        and(
          eq(jobs.project_id, projectId),
          eq(jobs.type, 'worker_run'),
          inArray(jobs.state, ['failed', 'canceled'])
        )
      )
      .run()
    deletedFailedJobs = result.changes
  }

  return { canceledJobs, releasedSlots, deletedFailedJobs }
}
