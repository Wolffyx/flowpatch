/**
 * Worktree Database Operations
 *
 * Supports both central database (legacy) and project-local database.
 */

import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or
} from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { worktrees } from './schema'
import { worktrees as projectWorktrees } from './schema/project'
import { generateId } from '@shared/utils'
import type { Worktree, WorktreeStatus } from '@shared/types'
import { resolveProjectDb } from './db-resolver'

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
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const rows = db.select().from(projectWorktrees).orderBy(desc(projectWorktrees.created_at)).all()
    return rows.map((r) => ({ ...r, project_id: projectId })) as Worktree[]
  }

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
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const rows = db
      .select()
      .from(projectWorktrees)
      .where(eq(projectWorktrees.status, status))
      .orderBy(desc(projectWorktrees.created_at))
      .all()
    return rows.map((r) => ({ ...r, project_id: projectId })) as Worktree[]
  }

  return db
    .select()
    .from(worktrees)
    .where(and(eq(worktrees.project_id, projectId), eq(worktrees.status, status)))
    .orderBy(desc(worktrees.created_at))
    .all() as Worktree[]
}

/**
 * Get a worktree by ID.
 * @param id - The worktree ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getWorktree(id: string, projectId?: string): Worktree | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db.select().from(projectWorktrees).where(eq(projectWorktrees.id, id)).get()
      return row ? ({ ...row, project_id: projectId } as Worktree) : null
    }
    return (db.select().from(worktrees).where(eq(worktrees.id, id)).get() as Worktree) ?? null
  }

  // Without projectId, check central DB (backward compatibility)
  const db = getDrizzle()
  return (db.select().from(worktrees).where(eq(worktrees.id, id)).get() as Worktree) ?? null
}

/**
 * Get a worktree by path.
 * @param worktreePath - The worktree path
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getWorktreeByPath(worktreePath: string, projectId?: string): Worktree | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectWorktrees)
        .where(eq(projectWorktrees.worktree_path, worktreePath))
        .get()
      return row ? ({ ...row, project_id: projectId } as Worktree) : null
    }
    return (
      (db
        .select()
        .from(worktrees)
        .where(eq(worktrees.worktree_path, worktreePath))
        .get() as Worktree) ?? null
    )
  }

  // Without projectId, check central DB (backward compatibility)
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(worktrees)
      .where(eq(worktrees.worktree_path, worktreePath))
      .get() as Worktree) ?? null
  )
}

/**
 * Get a worktree by branch.
 */
export function getWorktreeByBranch(projectId: string, branchName: string): Worktree | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const row = db
      .select()
      .from(projectWorktrees)
      .where(eq(projectWorktrees.branch_name, branchName))
      .get()
    return row ? ({ ...row, project_id: projectId } as Worktree) : null
  }

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
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getWorktreeByCard(cardId: string, projectId?: string): Worktree | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectWorktrees)
        .where(
          and(
            eq(projectWorktrees.card_id, cardId),
            notInArray(projectWorktrees.status, ['cleaned', 'error'])
          )
        )
        .orderBy(desc(projectWorktrees.created_at))
        .limit(1)
        .get()
      return row ? ({ ...row, project_id: projectId } as Worktree) : null
    }
  }

  // Central DB fallback
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
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getWorktreeByJob(jobId: string, projectId?: string): Worktree | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db.select().from(projectWorktrees).where(eq(projectWorktrees.job_id, jobId)).get()
      return row ? ({ ...row, project_id: projectId } as Worktree) : null
    }
    return (
      (db.select().from(worktrees).where(eq(worktrees.job_id, jobId)).get() as Worktree) ?? null
    )
  }

  // Central DB fallback
  const db = getDrizzle()
  return (db.select().from(worktrees).where(eq(worktrees.job_id, jobId)).get() as Worktree) ?? null
}

/**
 * Create a worktree.
 */
export function createWorktree(data: WorktreeCreate): Worktree {
  const { db, isLocalDb } = resolveProjectDb(data.projectId)
  const id = generateId()
  const now = new Date().toISOString()

  if (isLocalDb) {
    db.insert(projectWorktrees)
      .values({
        id,
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

    const row = db.select().from(projectWorktrees).where(eq(projectWorktrees.id, id)).get()
    return { ...row, project_id: data.projectId } as Worktree
  }

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
 * @param id - The worktree ID
 * @param status - The new status
 * @param error - Optional error message
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateWorktreeStatus(
  id: string,
  status: WorktreeStatus,
  error?: string,
  projectId?: string
): Worktree | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      if (status === 'cleanup_pending') {
        db.update(projectWorktrees)
          .set({
            status,
            last_error: error ?? null,
            cleanup_requested_at: now,
            updated_at: now
          })
          .where(eq(projectWorktrees.id, id))
          .run()
      } else {
        db.update(projectWorktrees)
          .set({
            status,
            last_error: error ?? null,
            updated_at: now
          })
          .where(eq(projectWorktrees.id, id))
          .run()
      }
      return getWorktree(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
  return getWorktree(id, projectId)
}

/**
 * Update worktree job.
 * @param id - The worktree ID
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateWorktreeJob(
  id: string,
  jobId: string | null,
  projectId?: string
): Worktree | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectWorktrees)
        .set({ job_id: jobId, updated_at: now })
        .where(eq(projectWorktrees.id, id))
        .run()
      return getWorktree(id, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(worktrees).set({ job_id: jobId, updated_at: now }).where(eq(worktrees.id, id)).run()
  return getWorktree(id, projectId)
}

/**
 * Delete a worktree.
 * @param id - The worktree ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteWorktree(id: string, projectId?: string): boolean {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db.delete(projectWorktrees).where(eq(projectWorktrees.id, id)).run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db.delete(worktrees).where(eq(worktrees.id, id)).run()
  return result.changes > 0
}

/**
 * Acquire a lock on a worktree.
 * @param id - The worktree ID
 * @param lockedBy - The lock owner identifier
 * @param ttlMinutes - Time-to-live for the lock in minutes
 * @param projectId - Optional project ID for direct DB resolution
 */
export function acquireWorktreeLock(
  id: string,
  lockedBy: string,
  ttlMinutes: number = 10,
  projectId?: string
): boolean {
  const now = new Date()
  const lockExpiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()
  const nowIso = now.toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .update(projectWorktrees)
        .set({
          locked_by: lockedBy,
          lock_expires_at: lockExpiresAt,
          updated_at: nowIso
        })
        .where(
          and(
            eq(projectWorktrees.id, id),
            or(isNull(projectWorktrees.locked_by), lt(projectWorktrees.lock_expires_at, nowIso))
          )
        )
        .run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * @param id - The worktree ID
 * @param lockedBy - The lock owner identifier
 * @param ttlMinutes - Time-to-live for the lock in minutes
 * @param projectId - Optional project ID for direct DB resolution
 */
export function renewWorktreeLock(
  id: string,
  lockedBy: string,
  ttlMinutes: number = 10,
  projectId?: string
): boolean {
  const now = new Date()
  const lockExpiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .update(projectWorktrees)
        .set({
          lock_expires_at: lockExpiresAt,
          updated_at: now.toISOString()
        })
        .where(and(eq(projectWorktrees.id, id), eq(projectWorktrees.locked_by, lockedBy)))
        .run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * @param id - The worktree ID
 * @param lockedBy - Optional lock owner identifier
 * @param projectId - Optional project ID for direct DB resolution
 */
export function releaseWorktreeLock(
  id: string,
  lockedBy?: string | null,
  projectId?: string
): boolean {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      if (lockedBy) {
        const result = db
          .update(projectWorktrees)
          .set({
            locked_by: null,
            lock_expires_at: null,
            updated_at: now
          })
          .where(and(eq(projectWorktrees.id, id), eq(projectWorktrees.locked_by, lockedBy)))
          .run()
        return result.changes > 0
      } else {
        const result = db
          .update(projectWorktrees)
          .set({
            locked_by: null,
            lock_expires_at: null,
            updated_at: now
          })
          .where(eq(projectWorktrees.id, id))
          .run()
        return result.changes > 0
      }
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getExpiredWorktreeLocks(projectId?: string): Worktree[] {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectWorktrees)
        .where(
          and(isNotNull(projectWorktrees.locked_by), lt(projectWorktrees.lock_expires_at, now))
        )
        .all()
      return rows.map((r) => ({ ...r, project_id: projectId })) as Worktree[]
    }
  }

  // Central DB - returns all expired locks across projects
  const db = getDrizzle()
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
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const now = new Date().toISOString()

  if (isLocalDb) {
    const result = db
      .select({ count: count() })
      .from(projectWorktrees)
      .where(
        and(
          inArray(projectWorktrees.status, ['creating', 'running']),
          isNotNull(projectWorktrees.locked_by),
          or(isNull(projectWorktrees.lock_expires_at), gt(projectWorktrees.lock_expires_at, now))
        )
      )
      .get()
    return result?.count ?? 0
  }

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
