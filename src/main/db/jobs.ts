/**
 * Job Database Operations
 */

import { getDb } from './connection'
import { generateId } from '@shared/utils'
import type { Job, JobState, JobType } from '@shared/types'

export type { Job, JobState, JobType }

/**
 * List jobs for a project.
 */
export function listJobs(projectId: string, limit = 50): Job[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
  return stmt.all(projectId, limit) as Job[]
}

/**
 * List recent jobs across all projects.
 */
export function listRecentJobs(limit = 200): Job[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?')
  return stmt.all(limit) as Job[]
}

/**
 * Get a job by ID.
 */
export function getJob(id: string): Job | null {
  const d = getDb()
  return (d.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job) ?? null
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
  const d = getDb()
  const id = generateId()
  const now = new Date().toISOString()
  d.prepare(
    `
    INSERT INTO jobs (id, project_id, card_id, type, state, attempts, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)
  `
  ).run(id, projectId, cardId ?? null, type, payload ? JSON.stringify(payload) : null, now, now)
  return d.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job
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
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare(
    `
    UPDATE jobs SET
      state = ?,
      result_json = ?,
      last_error = ?,
      updated_at = ?
    WHERE id = ?
  `
  ).run(state, result ? JSON.stringify(result) : null, error ?? null, now, jobId)
  return getJob(jobId)
}

/**
 * Update job result.
 */
export function updateJobResult(jobId: string, result?: unknown): Job | null {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare(
    `
    UPDATE jobs SET
      result_json = ?,
      updated_at = ?
    WHERE id = ?
  `
  ).run(result ? JSON.stringify(result) : null, now, jobId)
  return getJob(jobId)
}

/**
 * Acquire a lease on a job.
 */
export function acquireJobLease(jobId: string, leaseSeconds = 300): boolean {
  const d = getDb()
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const result = d
    .prepare(
      `
    UPDATE jobs SET
      state = 'running',
      lease_until = ?,
      attempts = attempts + 1,
      updated_at = ?
    WHERE id = ? AND (state = 'queued' OR (state = 'running' AND lease_until < ?))
  `
    )
    .run(leaseUntil, now.toISOString(), jobId, now.toISOString())
  return result.changes > 0
}

/**
 * Renew a job lease.
 */
export function renewJobLease(jobId: string, leaseSeconds = 300): boolean {
  const d = getDb()
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const result = d
    .prepare('UPDATE jobs SET lease_until = ?, updated_at = ? WHERE id = ? AND state = ?')
    .run(leaseUntil, now.toISOString(), jobId, 'running')
  return result.changes > 0
}

/**
 * Get next queued job for a project.
 */
export function getNextQueuedJob(projectId: string, type?: JobType): Job | null {
  const d = getDb()
  if (type) {
    return (
      (d
        .prepare(
          'SELECT * FROM jobs WHERE project_id = ? AND type = ? AND state = ? ORDER BY created_at ASC LIMIT 1'
        )
        .get(projectId, type, 'queued') as Job) ?? null
    )
  }
  return (
    (d
      .prepare(
        'SELECT * FROM jobs WHERE project_id = ? AND state = ? ORDER BY created_at ASC LIMIT 1'
      )
      .get(projectId, 'queued') as Job) ?? null
  )
}

/**
 * Get running jobs for a project.
 */
export function getRunningJobs(projectId: string): Job[] {
  const d = getDb()
  return d
    .prepare('SELECT * FROM jobs WHERE project_id = ? AND state = ?')
    .all(projectId, 'running') as Job[]
}

/**
 * Check if a project has an active worker job.
 */
export function hasActiveWorkerJob(projectId: string): boolean {
  const d = getDb()
  const stmt = d.prepare(`
    SELECT 1 FROM jobs
    WHERE project_id = ?
      AND type = 'worker_run'
      AND state IN ('queued', 'running')
    LIMIT 1
  `)
  return stmt.get(projectId) !== undefined
}

/**
 * Get active worker job for a project.
 */
export function getActiveWorkerJob(projectId: string): Job | null {
  const d = getDb()
  const stmt = d.prepare(`
    SELECT * FROM jobs
    WHERE project_id = ?
      AND type = 'worker_run'
      AND state IN ('queued', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `)
  return (stmt.get(projectId) as Job) ?? null
}

/**
 * Get active worker job for a card.
 */
export function getActiveWorkerJobForCard(cardId: string): Job | null {
  const d = getDb()
  const stmt = d.prepare(`
    SELECT * FROM jobs
    WHERE card_id = ?
      AND type = 'worker_run'
      AND state IN ('queued', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `)
  return (stmt.get(cardId) as Job) ?? null
}

/**
 * Cancel a job.
 */
export function cancelJob(jobId: string, error?: string): boolean {
  const d = getDb()
  const now = new Date().toISOString()
  const res = d
    .prepare(
      `
      UPDATE jobs SET
        state = 'canceled',
        lease_until = NULL,
        last_error = ?,
        updated_at = ?
      WHERE id = ? AND state IN ('queued', 'running')
    `
    )
    .run(error ?? 'Canceled', now, jobId)
  return res.changes > 0
}

/**
 * Get count of active worker jobs for a project.
 */
export function getActiveWorkerJobCount(projectId: string): number {
  const d = getDb()
  const result = d
    .prepare(
      `SELECT COUNT(*) as count FROM jobs
       WHERE project_id = ?
         AND type = 'worker_run'
         AND state IN ('queued', 'running')`
    )
    .get(projectId) as { count: number }
  return result.count
}
