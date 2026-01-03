/**
 * Job Database Operations
 */

import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { jobs } from './schema'
import { generateId } from '@shared/utils'
import type { Job, JobState, JobType } from '@shared/types'

export type { Job, JobState, JobType }

/**
 * List jobs for a project.
 */
export function listJobs(projectId: string, limit = 50): Job[] {
  const db = getDrizzle()
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
 */
export function listRecentJobs(limit = 200): Job[] {
  const db = getDrizzle()
  return db.select().from(jobs).orderBy(desc(jobs.created_at)).limit(limit).all() as Job[]
}

/**
 * Get a job by ID.
 */
export function getJob(id: string): Job | null {
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
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()
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
 */
export function updateJobState(
  jobId: string,
  state: JobState,
  result?: unknown,
  error?: string
): Job | null {
  const db = getDrizzle()
  const now = new Date().toISOString()
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
 */
export function updateJobResult(jobId: string, result?: unknown): Job | null {
  const db = getDrizzle()
  const now = new Date().toISOString()
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
 */
export function acquireJobLease(jobId: string, leaseSeconds = 300): boolean {
  const db = getDrizzle()
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const nowIso = now.toISOString()

  // Check if can acquire the job
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get() as Job | undefined
  if (!job) return false

  // Job must be queued, or running with expired lease
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
 */
export function renewJobLease(jobId: string, leaseSeconds = 300): boolean {
  const db = getDrizzle()
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
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
  const db = getDrizzle()
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
  const db = getDrizzle()
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
  const db = getDrizzle()
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
  const db = getDrizzle()
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
 */
export function getActiveWorkerJobForCard(cardId: string): Job | null {
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
 */
export function cancelJob(jobId: string, error?: string): boolean {
  const db = getDrizzle()
  const now = new Date().toISOString()
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
 * Get count of active worker jobs for a project.
 */
export function getActiveWorkerJobCount(projectId: string): number {
  const db = getDrizzle()
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
