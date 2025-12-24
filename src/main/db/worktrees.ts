/**
 * Worktree Database Operations
 */

import { getDb } from './connection'
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
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at DESC')
  return stmt.all(projectId) as Worktree[]
}

/**
 * List worktrees by status.
 */
export function listWorktreesByStatus(projectId: string, status: WorktreeStatus): Worktree[] {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM worktrees WHERE project_id = ? AND status = ? ORDER BY created_at DESC'
  )
  return stmt.all(projectId, status) as Worktree[]
}

/**
 * Get a worktree by ID.
 */
export function getWorktree(id: string): Worktree | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worktrees WHERE id = ?')
  return (stmt.get(id) as Worktree) ?? null
}

/**
 * Get a worktree by path.
 */
export function getWorktreeByPath(worktreePath: string): Worktree | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worktrees WHERE worktree_path = ?')
  return (stmt.get(worktreePath) as Worktree) ?? null
}

/**
 * Get a worktree by branch.
 */
export function getWorktreeByBranch(projectId: string, branchName: string): Worktree | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worktrees WHERE project_id = ? AND branch_name = ?')
  return (stmt.get(projectId, branchName) as Worktree) ?? null
}

/**
 * Get a worktree by card.
 */
export function getWorktreeByCard(cardId: string): Worktree | null {
  const d = getDb()
  const stmt = d.prepare(
    "SELECT * FROM worktrees WHERE card_id = ? AND status NOT IN ('cleaned', 'error') ORDER BY created_at DESC LIMIT 1"
  )
  return (stmt.get(cardId) as Worktree) ?? null
}

/**
 * Get a worktree by job.
 */
export function getWorktreeByJob(jobId: string): Worktree | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worktrees WHERE job_id = ?')
  return (stmt.get(jobId) as Worktree) ?? null
}

/**
 * Create a worktree.
 */
export function createWorktree(data: WorktreeCreate): Worktree {
  const d = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  d.prepare(
    `
    INSERT INTO worktrees (
      id, project_id, card_id, job_id, worktree_path, branch_name, base_ref,
      status, locked_by, lock_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    data.projectId,
    data.cardId,
    data.jobId ?? null,
    data.worktreePath,
    data.branchName,
    data.baseRef,
    data.status ?? 'creating',
    data.lockedBy ?? null,
    data.lockExpiresAt ?? null,
    now,
    now
  )

  return d.prepare('SELECT * FROM worktrees WHERE id = ?').get(id) as Worktree
}

/**
 * Update worktree status.
 */
export function updateWorktreeStatus(
  id: string,
  status: WorktreeStatus,
  error?: string
): Worktree | null {
  const d = getDb()
  const now = new Date().toISOString()

  // Set cleanup_requested_at when transitioning to cleanup_pending
  if (status === 'cleanup_pending') {
    d.prepare(
      'UPDATE worktrees SET status = ?, last_error = ?, cleanup_requested_at = ?, updated_at = ? WHERE id = ?'
    ).run(status, error ?? null, now, now, id)
  } else {
    d.prepare('UPDATE worktrees SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(
      status,
      error ?? null,
      now,
      id
    )
  }
  return getWorktree(id)
}

/**
 * Update worktree job.
 */
export function updateWorktreeJob(id: string, jobId: string | null): Worktree | null {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE worktrees SET job_id = ?, updated_at = ? WHERE id = ?').run(jobId, now, id)
  return getWorktree(id)
}

/**
 * Delete a worktree.
 */
export function deleteWorktree(id: string): boolean {
  const d = getDb()
  const result = d.prepare('DELETE FROM worktrees WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Acquire a lock on a worktree.
 */
export function acquireWorktreeLock(
  id: string,
  lockedBy: string,
  ttlMinutes: number = 10
): boolean {
  const d = getDb()
  const now = new Date()
  const lockExpiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()

  const result = d
    .prepare(
      `
    UPDATE worktrees SET
      locked_by = ?,
      lock_expires_at = ?,
      updated_at = ?
    WHERE id = ? AND (locked_by IS NULL OR lock_expires_at < ?)
  `
    )
    .run(lockedBy, lockExpiresAt, now.toISOString(), id, now.toISOString())

  return result.changes > 0
}

/**
 * Renew a worktree lock.
 */
export function renewWorktreeLock(id: string, lockedBy: string, ttlMinutes: number = 10): boolean {
  const d = getDb()
  const now = new Date()
  const lockExpiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()

  const result = d
    .prepare(
      'UPDATE worktrees SET lock_expires_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?'
    )
    .run(lockExpiresAt, now.toISOString(), id, lockedBy)

  return result.changes > 0
}

/**
 * Release a worktree lock.
 */
export function releaseWorktreeLock(id: string, lockedBy?: string | null): boolean {
  const d = getDb()
  const now = new Date().toISOString()

  if (lockedBy) {
    const result = d
      .prepare(
        'UPDATE worktrees SET locked_by = NULL, lock_expires_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?'
      )
      .run(now, id, lockedBy)
    return result.changes > 0
  } else {
    const result = d
      .prepare(
        'UPDATE worktrees SET locked_by = NULL, lock_expires_at = NULL, updated_at = ? WHERE id = ?'
      )
      .run(now, id)
    return result.changes > 0
  }
}

/**
 * Get expired worktree locks.
 */
export function getExpiredWorktreeLocks(): Worktree[] {
  const d = getDb()
  const now = new Date().toISOString()
  const stmt = d.prepare(
    'SELECT * FROM worktrees WHERE locked_by IS NOT NULL AND lock_expires_at < ?'
  )
  return stmt.all(now) as Worktree[]
}

/**
 * Count active worktrees for a project.
 */
export function countActiveWorktrees(projectId: string): number {
  const d = getDb()
  const now = new Date().toISOString()
  const result = d
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM worktrees
      WHERE project_id = ?
        AND status IN ('creating', 'running')
        AND locked_by IS NOT NULL
        AND (lock_expires_at IS NULL OR lock_expires_at > ?)
    `
    )
    .get(projectId, now) as { count: number }
  return result.count
}
