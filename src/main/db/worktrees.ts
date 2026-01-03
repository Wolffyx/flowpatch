/**
 * Worktree Database Operations
 */

import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { worktrees } from './schema'
import { generateId } from '@shared/utils'
import type { Worktree, WorktreeStatus } from '@shared/types'

export type { Worktree, WorktreeStatus }

export interface WorktreeCreate {
  projectId: string
  cardId: string
  jobId?: string
  worktreePath: string
  branchName: string
  baseRef: string
  status?: WorktreeStatus
  lockedBy?: string
  lockExpiresAt?: string
}

/**
 * List worktrees for a project.
 */
export function listWorktrees(projectId: string): Worktree[] {
  const db = getDrizzle()
  return db
    .select()
    .from(worktrees)
    .where(eq(worktrees.project_id, projectId))
    .orderBy(desc(worktrees.created_at))
    .all() as Worktree[]
}

/**
 * List worktrees by status.
 */
export function listWorktreesByStatus(projectId: string, status: WorktreeStatus): Worktree[] {
  const db = getDrizzle()
  return db
    .select()
    .from(worktrees)
    .where(and(eq(worktrees.project_id, projectId), eq(worktrees.status, status)))
    .orderBy(desc(worktrees.created_at))
    .all() as Worktree[]
}

/**
 * Get a worktree by ID.
 */
export function getWorktree(id: string): Worktree | null {
  const db = getDrizzle()
  return (db.select().from(worktrees).where(eq(worktrees.id, id)).get() as Worktree) ?? null
}

/**
 * Get a worktree by path.
 */
export function getWorktreeByPath(worktreePath: string): Worktree | null {
  const db = getDrizzle()
  return (
    (db.select().from(worktrees).where(eq(worktrees.worktree_path, worktreePath)).get() as Worktree) ?? null
  )
}

/**
 * Get a worktree by branch.
 */
export function getWorktreeByBranch(projectId: string, branchName: string): Worktree | null {
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(worktrees)
      .where(and(eq(worktrees.project_id, projectId), eq(worktrees.branch_name, branchName)))
      .get() as Worktree) ?? null
  )
}

/**
 * Get a worktree by card.
 */
export function getWorktreeByCard(cardId: string): Worktree | null {
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(worktrees)
      .where(and(eq(worktrees.card_id, cardId), notInArray(worktrees.status, ['cleaned', 'error'])))
      .orderBy(desc(worktrees.created_at))
      .limit(1)
      .get() as Worktree) ?? null
  )
}

/**
 * Get a worktree by job.
 */
export function getWorktreeByJob(jobId: string): Worktree | null {
  const db = getDrizzle()
  return (db.select().from(worktrees).where(eq(worktrees.job_id, jobId)).get() as Worktree) ?? null
}

/**
 * Create a worktree.
 */
export function createWorktree(data: WorktreeCreate): Worktree {
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

  db.insert(worktrees)
    .values({
      id,
      project_id: data.projectId,
      card_id: data.cardId,
      job_id: data.jobId ?? null,
      worktree_path: data.worktreePath,
      branch_name: data.branchName,
      base_ref: data.baseRef,
      status: data.status ?? 'creating',
      locked_by: data.lockedBy ?? null,
      lock_expires_at: data.lockExpiresAt ?? null,
      created_at: now,
      updated_at: now
    })
    .run()

  return db.select().from(worktrees).where(eq(worktrees.id, id)).get() as Worktree
}

/**
 * Update worktree status.
 */
export function updateWorktreeStatus(
  id: string,
  status: WorktreeStatus,
  error?: string
): Worktree | null {
  const db = getDrizzle()
  const now = new Date().toISOString()

  // Set cleanup_requested_at when transitioning to cleanup_pending
  if (status === 'cleanup_pending') {
    db.update(worktrees)
      .set({
        status,
        last_error: error ?? null,
        cleanup_requested_at: now,
        updated_at: now
      })
      .where(eq(worktrees.id, id))
      .run()
  } else {
    db.update(worktrees)
      .set({
        status,
        last_error: error ?? null,
        updated_at: now
      })
      .where(eq(worktrees.id, id))
      .run()
  }
  return getWorktree(id)
}

/**
 * Update worktree job.
 */
export function updateWorktreeJob(id: string, jobId: string | null): Worktree | null {
  const db = getDrizzle()
  const now = new Date().toISOString()
  db.update(worktrees)
    .set({ job_id: jobId, updated_at: now })
    .where(eq(worktrees.id, id))
    .run()
  return getWorktree(id)
}

/**
 * Delete a worktree.
 */
export function deleteWorktree(id: string): boolean {
  const db = getDrizzle()
  const result = db.delete(worktrees).where(eq(worktrees.id, id)).run()
  return result.changes > 0
}

/**
 * Acquire a lock on a worktree.
 */
export function acquireWorktreeLock(id: string, lockedBy: string, ttlMinutes: number = 10): boolean {
  const db = getDrizzle()
  const now = new Date()
  const lockExpiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()
  const nowIso = now.toISOString()

  const result = db
    .update(worktrees)
    .set({
      locked_by: lockedBy,
      lock_expires_at: lockExpiresAt,
      updated_at: nowIso
    })
    .where(
      and(
        eq(worktrees.id, id),
        or(isNull(worktrees.locked_by), lt(worktrees.lock_expires_at, nowIso))
      )
    )
    .run()

  return result.changes > 0
}

/**
 * Renew a worktree lock.
 */
export function renewWorktreeLock(id: string, lockedBy: string, ttlMinutes: number = 10): boolean {
  const db = getDrizzle()
  const now = new Date()
  const lockExpiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()

  const result = db
    .update(worktrees)
    .set({
      lock_expires_at: lockExpiresAt,
      updated_at: now.toISOString()
    })
    .where(and(eq(worktrees.id, id), eq(worktrees.locked_by, lockedBy)))
    .run()

  return result.changes > 0
}

/**
 * Release a worktree lock.
 */
export function releaseWorktreeLock(id: string, lockedBy?: string | null): boolean {
  const db = getDrizzle()
  const now = new Date().toISOString()

  if (lockedBy) {
    const result = db
      .update(worktrees)
      .set({
        locked_by: null,
        lock_expires_at: null,
        updated_at: now
      })
      .where(and(eq(worktrees.id, id), eq(worktrees.locked_by, lockedBy)))
      .run()
    return result.changes > 0
  } else {
    const result = db
      .update(worktrees)
      .set({
        locked_by: null,
        lock_expires_at: null,
        updated_at: now
      })
      .where(eq(worktrees.id, id))
      .run()
    return result.changes > 0
  }
}

/**
 * Get expired worktree locks.
 */
export function getExpiredWorktreeLocks(): Worktree[] {
  const db = getDrizzle()
  const now = new Date().toISOString()
  return db
    .select()
    .from(worktrees)
    .where(and(isNotNull(worktrees.locked_by), lt(worktrees.lock_expires_at, now)))
    .all() as Worktree[]
}

/**
 * Count active worktrees for a project.
 */
export function countActiveWorktrees(projectId: string): number {
  const db = getDrizzle()
  const now = new Date().toISOString()
  const result = db
    .select({ count: count() })
    .from(worktrees)
    .where(
      and(
        eq(worktrees.project_id, projectId),
        inArray(worktrees.status, ['creating', 'running']),
        isNotNull(worktrees.locked_by),
        or(isNull(worktrees.lock_expires_at), gt(worktrees.lock_expires_at, now))
      )
    )
    .get()
  return result?.count ?? 0
}
