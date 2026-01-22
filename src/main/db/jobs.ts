/**
 * Job Database Operations
 *
 * Supports both central database (legacy) and project-local database.
 */

import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { jobs } from './schema'
import { jobs as projectJobs } from './schema/project'
import { generateId } from '@shared/utils'
import type { Job, JobState, JobType } from '@shared/types'
import { resolveProjectDb } from './db-resolver'

export type { Job, JobState, JobType }

/**
 * List jobs for a project.
 */
export function listJobs(projectId: string, limit = 50): Job[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - no project_id filter needed (implicit)
    const rows = db
      .select()
      .from(projectJobs)
      .orderBy(desc(projectJobs.created_at))
      .limit(limit)
      .all()
    return rows.map((r) => ({ ...r, project_id: projectId })) as Job[]
  }

  // Central DB - filter by project_id
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.project_id, projectId))
    .orderBy(desc(jobs.created_at))
    .limit(limit)
    .all() as Job[]
}

/**
 * List recent jobs across all projects.
 * Note: This only works with central DB as project DBs are isolated.
 */
export function listRecentJobs(limit = 200): Job[] {
  const db = getDrizzle()
  return db.select().from(jobs).orderBy(desc(jobs.created_at)).limit(limit).all() as Job[]
}

/**
 * Get a job by ID.
 * @param id - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getJob(id: string, projectId?: string): Job | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db.select().from(projectJobs).where(eq(projectJobs.id, id)).get()
      return row ? ({ ...row, project_id: projectId } as Job) : null
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  return (db.select().from(jobs).where(eq(jobs.id, id)).get() as Job) ?? null
}

/**
 * Create a new job.
 */
export function createJob(
  projectId: string,
  type: JobType,
  cardId?: string,
  payload?: unknown
): Job {
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const id = generateId()
  const now = new Date().toISOString()

  if (isLocalDb) {
    // Project DB - no project_id column
    db.insert(projectJobs)
      .values({
        id,
        card_id: cardId ?? null,
        type,
        state: 'queued',
        attempts: 0,
        payload_json: payload ? JSON.stringify(payload) : null,
        created_at: now,
        updated_at: now
      })
      .run()
    const row = db.select().from(projectJobs).where(eq(projectJobs.id, id)).get()
    return { ...row!, project_id: projectId } as Job
  }

  // Central DB - includes project_id
  db.insert(jobs)
    .values({
      id,
      project_id: projectId,
      card_id: cardId ?? null,
      type,
      state: 'queued',
      attempts: 0,
      payload_json: payload ? JSON.stringify(payload) : null,
      created_at: now,
      updated_at: now
    })
    .run()
  return db.select().from(jobs).where(eq(jobs.id, id)).get() as Job
}

/**
 * Update job state.
 * @param jobId - The job ID
 * @param state - The new state
 * @param result - Optional result data
 * @param error - Optional error message
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateJobState(
  jobId: string,
  state: JobState,
  result?: unknown,
  error?: string,
  projectId?: string
): Job | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectJobs)
        .set({
          state,
          result_json: result ? JSON.stringify(result) : null,
          last_error: error ?? null,
          updated_at: now
        })
        .where(eq(projectJobs.id, jobId))
        .run()
      return getJob(jobId, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(jobs)
    .set({
      state,
      result_json: result ? JSON.stringify(result) : null,
      last_error: error ?? null,
      updated_at: now
    })
    .where(eq(jobs.id, jobId))
    .run()
  return getJob(jobId)
}

/**
 * Update job result.
 * @param jobId - The job ID
 * @param result - The result data
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateJobResult(jobId: string, result?: unknown, projectId?: string): Job | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectJobs)
        .set({
          result_json: result ? JSON.stringify(result) : null,
          updated_at: now
        })
        .where(eq(projectJobs.id, jobId))
        .run()
      return getJob(jobId, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(jobs)
    .set({
      result_json: result ? JSON.stringify(result) : null,
      updated_at: now
    })
    .where(eq(jobs.id, jobId))
    .run()
  return getJob(jobId)
}

/**
 * Acquire a lease on a job.
 * @param jobId - The job ID
 * @param leaseSeconds - Lease duration in seconds
 * @param projectId - Optional project ID for direct DB resolution
 */
export function acquireJobLease(jobId: string, leaseSeconds = 300, projectId?: string): boolean {
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const nowIso = now.toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const job = db.select().from(projectJobs).where(eq(projectJobs.id, jobId)).get()
      if (!job) return false

      const canAcquire =
        job.state === 'queued' ||
        (job.state === 'running' && job.lease_until && job.lease_until < nowIso)

      if (!canAcquire) return false

      const result = db
        .update(projectJobs)
        .set({
          state: 'running',
          lease_until: leaseUntil,
          attempts: job.attempts + 1,
          updated_at: nowIso
        })
        .where(eq(projectJobs.id, jobId))
        .run()

      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get() as Job | undefined
  if (!job) return false

  const canAcquire =
    job.state === 'queued' ||
    (job.state === 'running' && job.lease_until && job.lease_until < nowIso)

  if (!canAcquire) return false

  const result = db
    .update(jobs)
    .set({
      state: 'running',
      lease_until: leaseUntil,
      attempts: job.attempts + 1,
      updated_at: nowIso
    })
    .where(eq(jobs.id, jobId))
    .run()

  return result.changes > 0
}

/**
 * Renew a job lease.
 * @param jobId - The job ID
 * @param leaseSeconds - Lease duration in seconds
 * @param projectId - Optional project ID for direct DB resolution
 */
export function renewJobLease(jobId: string, leaseSeconds = 300, projectId?: string): boolean {
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .update(projectJobs)
        .set({
          lease_until: leaseUntil,
          updated_at: now.toISOString()
        })
        .where(and(eq(projectJobs.id, jobId), eq(projectJobs.state, 'running')))
        .run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db
    .update(jobs)
    .set({
      lease_until: leaseUntil,
      updated_at: now.toISOString()
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.state, 'running')))
    .run()
  return result.changes > 0
}

/**
 * Get next queued job for a project.
 */
export function getNextQueuedJob(projectId: string, type?: JobType): Job | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - no project_id filter needed
    if (type) {
      const row = db
        .select()
        .from(projectJobs)
        .where(and(eq(projectJobs.type, type), eq(projectJobs.state, 'queued')))
        .orderBy(asc(projectJobs.created_at))
        .limit(1)
        .get()
      return row ? ({ ...row, project_id: projectId } as Job) : null
    }
    const row = db
      .select()
      .from(projectJobs)
      .where(eq(projectJobs.state, 'queued'))
      .orderBy(asc(projectJobs.created_at))
      .limit(1)
      .get()
    return row ? ({ ...row, project_id: projectId } as Job) : null
  }

  // Central DB - filter by project_id
  if (type) {
    return (
      (db
        .select()
        .from(jobs)
        .where(and(eq(jobs.project_id, projectId), eq(jobs.type, type), eq(jobs.state, 'queued')))
        .orderBy(asc(jobs.created_at))
        .limit(1)
        .get() as Job) ?? null
    )
  }
  return (
    (db
      .select()
      .from(jobs)
      .where(and(eq(jobs.project_id, projectId), eq(jobs.state, 'queued')))
      .orderBy(asc(jobs.created_at))
      .limit(1)
      .get() as Job) ?? null
  )
}

/**
 * Get running jobs for a project.
 */
export function getRunningJobs(projectId: string): Job[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - no project_id filter needed
    const rows = db.select().from(projectJobs).where(eq(projectJobs.state, 'running')).all()
    return rows.map((r) => ({ ...r, project_id: projectId })) as Job[]
  }

  // Central DB - filter by project_id
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.project_id, projectId), eq(jobs.state, 'running')))
    .all() as Job[]
}

/**
 * Check if a project has an active worker job.
 */
export function hasActiveWorkerJob(projectId: string): boolean {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - no project_id filter needed
    const result = db
      .select({ _: projectJobs.id })
      .from(projectJobs)
      .where(
        and(eq(projectJobs.type, 'worker_run'), inArray(projectJobs.state, ['queued', 'running']))
      )
      .limit(1)
      .get()
    return result !== undefined
  }

  // Central DB - filter by project_id
  const result = db
    .select({ _: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.project_id, projectId),
        eq(jobs.type, 'worker_run'),
        inArray(jobs.state, ['queued', 'running'])
      )
    )
    .limit(1)
    .get()
  return result !== undefined
}

/**
 * Get active worker job for a project.
 */
export function getActiveWorkerJob(projectId: string): Job | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - no project_id filter needed
    const row = db
      .select()
      .from(projectJobs)
      .where(
        and(eq(projectJobs.type, 'worker_run'), inArray(projectJobs.state, ['queued', 'running']))
      )
      .orderBy(desc(projectJobs.created_at))
      .limit(1)
      .get()
    return row ? ({ ...row, project_id: projectId } as Job) : null
  }

  // Central DB - filter by project_id
  return (
    (db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.project_id, projectId),
          eq(jobs.type, 'worker_run'),
          inArray(jobs.state, ['queued', 'running'])
        )
      )
      .orderBy(desc(jobs.created_at))
      .limit(1)
      .get() as Job) ?? null
  )
}

/**
 * Get active worker job for a card.
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getActiveWorkerJobForCard(cardId: string, projectId?: string): Job | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectJobs)
        .where(
          and(
            eq(projectJobs.card_id, cardId),
            eq(projectJobs.type, 'worker_run'),
            inArray(projectJobs.state, ['queued', 'running'])
          )
        )
        .orderBy(desc(projectJobs.created_at))
        .limit(1)
        .get()
      return row ? ({ ...row, project_id: projectId } as Job) : null
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.card_id, cardId),
          eq(jobs.type, 'worker_run'),
          inArray(jobs.state, ['queued', 'running'])
        )
      )
      .orderBy(desc(jobs.created_at))
      .limit(1)
      .get() as Job) ?? null
  )
}

/**
 * Cancel a job.
 * @param jobId - The job ID
 * @param error - Optional error message
 * @param projectId - Optional project ID for direct DB resolution
 */
export function cancelJob(jobId: string, error?: string, projectId?: string): boolean {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .update(projectJobs)
        .set({
          state: 'canceled',
          lease_until: null,
          last_error: error ?? 'Canceled',
          updated_at: now
        })
        .where(and(eq(projectJobs.id, jobId), inArray(projectJobs.state, ['queued', 'running'])))
        .run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db
    .update(jobs)
    .set({
      state: 'canceled',
      lease_until: null,
      last_error: error ?? 'Canceled',
      updated_at: now
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.state, ['queued', 'running'])))
    .run()
  return result.changes > 0
}

/**
 * Delete failed and canceled worker_run jobs for a card.
 * This allows the card to be immediately retried without waiting for cooldown.
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteFailedWorkerRunJobsForCard(
  cardId: string,
  projectId?: string
): void {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.delete(projectJobs)
        .where(
          and(
            eq(projectJobs.card_id, cardId),
            eq(projectJobs.type, 'worker_run'),
            inArray(projectJobs.state, ['failed', 'canceled'])
          )
        )
        .run()
      return
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.delete(jobs)
    .where(
      and(
        eq(jobs.card_id, cardId),
        eq(jobs.type, 'worker_run'),
        inArray(jobs.state, ['failed', 'canceled'])
      )
    )
    .run()
}

/**
 * Get count of active worker jobs for a project.
 */
export function getActiveWorkerJobCount(projectId: string): number {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - no project_id filter needed
    const result = db
      .select({ count: count() })
      .from(projectJobs)
      .where(
        and(eq(projectJobs.type, 'worker_run'), inArray(projectJobs.state, ['queued', 'running']))
      )
      .get()
    return result?.count ?? 0
  }

  // Central DB - filter by project_id
  const result = db
    .select({ count: count() })
    .from(jobs)
    .where(
      and(
        eq(jobs.project_id, projectId),
        eq(jobs.type, 'worker_run'),
        inArray(jobs.state, ['queued', 'running'])
      )
    )
    .get()
  return result?.count ?? 0
}
