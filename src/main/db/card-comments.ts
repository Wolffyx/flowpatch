/**
 * Card Comments Database Operations
 *
 * CRUD operations for card comments/feedback.
 * Supports both central database (legacy) and project-local database.
 * Used for bidirectional sync with GitHub/GitLab comments.
 */

import { and, asc, desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { cardComments } from './schema'
import { cardComments as projectCardComments } from './schema/project'
import { generateId } from '@shared/utils'
import type {
  CardComment,
  CardCommentCreate,
  CardCommentUpdate,
  CommentSource,
  CommentSyncState,
  CommentPriority,
  CommentResolution
} from '@shared/types'
import { resolveProjectDb } from './db-resolver'

export type {
  CardComment,
  CardCommentCreate,
  CardCommentUpdate,
  CommentSource,
  CommentSyncState,
  CommentPriority,
  CommentResolution
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize comment body for comparison.
 * Handles whitespace differences, line endings, etc.
 */
function normalizeBody(body: string): string {
  return body.trim().replace(/\r\n/g, '\n').replace(/\s+/g, ' ')
}

/**
 * Check if two timestamps are within a tolerance.
 * Used for deduplication when exact ID matching isn't possible.
 */
function isTimestampClose(
  ts1: string | null,
  ts2: string,
  toleranceMs: number = 120000 // 2 minutes default
): boolean {
  if (!ts1) return false
  const t1 = new Date(ts1).getTime()
  const t2 = new Date(ts2).getTime()
  return Math.abs(t1 - t2) <= toleranceMs
}

function rowToComment(
  row: {
    id: string
    card_id: string
    project_id?: string
    remote_comment_id: string | null
    author: string | null
    body: string
    source: string
    sync_state: string
    priority: string
    resolution: string
    resolved_at: string | null
    resolved_by_job_id: string | null
    include_in_next_run: boolean | number
    processed_for_job_id: string | null
    processed_at: string | null
    created_at: string
    remote_created_at: string | null
    updated_at: string
  },
  projectId?: string
): CardComment {
  return {
    id: row.id,
    card_id: row.card_id,
    project_id: row.project_id ?? projectId ?? '',
    remote_comment_id: row.remote_comment_id,
    author: row.author,
    body: row.body,
    source: row.source as CommentSource,
    sync_state: row.sync_state as CommentSyncState,
    priority: row.priority as CommentPriority,
    resolution: row.resolution as CommentResolution,
    resolved_at: row.resolved_at,
    resolved_by_job_id: row.resolved_by_job_id,
    include_in_next_run:
      typeof row.include_in_next_run === 'boolean'
        ? row.include_in_next_run
        : row.include_in_next_run === 1,
    processed_for_job_id: row.processed_for_job_id,
    processed_at: row.processed_at,
    created_at: row.created_at,
    remote_created_at: row.remote_created_at,
    updated_at: row.updated_at
  }
}

// ============================================================================
// Create Operations
// ============================================================================

/**
 * Create a new card comment.
 */
export function createCardComment(data: CardCommentCreate): CardComment {
  const { db, isLocalDb } = resolveProjectDb(data.project_id)
  const id = generateId()
  const now = new Date().toISOString()

  const commentData = {
    id,
    card_id: data.card_id,
    remote_comment_id: data.remote_comment_id ?? null,
    author: data.author ?? null,
    body: data.body,
    source: data.source ?? 'user',
    sync_state: data.remote_comment_id ? 'ok' : 'pending_push',
    priority: data.priority ?? 'normal',
    resolution: 'open' as const,
    resolved_at: null,
    resolved_by_job_id: null,
    include_in_next_run: true,
    processed_for_job_id: null,
    processed_at: null,
    created_at: now,
    remote_created_at: data.remote_created_at ?? null,
    updated_at: now
  }

  if (isLocalDb) {
    db.insert(projectCardComments)
      .values({
        ...commentData,
        include_in_next_run: true
      })
      .run()
  } else {
    db.insert(cardComments)
      .values({
        ...commentData,
        project_id: data.project_id,
        include_in_next_run: true
      })
      .run()
  }

  return {
    ...commentData,
    project_id: data.project_id,
    sync_state: commentData.sync_state as CommentSyncState
  }
}

/**
 * Upsert a comment from remote (GitHub/GitLab).
 * Uses multi-tier deduplication to avoid duplicates:
 * 1. Match by remote_comment_id (exact match)
 * 2. Match by normalized body + author + timestamp proximity
 *
 * This handles the case where GitHub GraphQL and REST APIs return different
 * comment IDs for the same comment.
 */
export function upsertCommentFromRemote(
  cardId: string,
  projectId: string,
  remoteCommentId: string,
  author: string,
  body: string,
  remoteCreatedAt: string,
  source: CommentSource = 'user'
): CardComment {
  // Tier 1: Check if we already have this comment by remote ID
  const existingByRemoteId = getCommentByRemoteId(cardId, remoteCommentId, projectId)

  if (existingByRemoteId) {
    // Update existing comment if body changed
    if (existingByRemoteId.body !== body) {
      updateCardComment(existingByRemoteId.id, { body }, projectId)
    }
    return { ...existingByRemoteId, body }
  }

  // Tier 2: Robust matching by normalized body + author + timestamp
  // This handles ID format mismatches between GraphQL and REST APIs
  const localComments = getCommentsByCard(cardId, projectId)
  const normalizedRemoteBody = normalizeBody(body)

  const matchingComment = localComments.find((c) => {
    // Body must match (normalized)
    if (normalizeBody(c.body) !== normalizedRemoteBody) return false

    // Author must match (allow null local author or 'unknown' remote author)
    const authorMatches =
      c.author === author ||
      c.author === null ||
      author === 'unknown'
    if (!authorMatches) return false

    // Timestamp must be close (within 2 minutes) - handles clock drift
    const timestampMatches = isTimestampClose(
      c.remote_created_at || c.created_at,
      remoteCreatedAt
    )
    if (!timestampMatches) return false

    return true
  })

  if (matchingComment) {
    // Link/update the comment with the new remote ID
    updateCardComment(
      matchingComment.id,
      {
        remote_comment_id: remoteCommentId,
        sync_state: 'ok',
        author: author // Update author if it was null
      },
      projectId
    )
    return {
      ...matchingComment,
      remote_comment_id: remoteCommentId,
      sync_state: 'ok',
      author
    }
  }

  // Create new comment
  return createCardComment({
    card_id: cardId,
    project_id: projectId,
    remote_comment_id: remoteCommentId,
    author,
    body,
    remote_created_at: remoteCreatedAt,
    source
  })
}

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Get a comment by ID.
 */
export function getCardComment(id: string, projectId?: string): CardComment | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db.select().from(projectCardComments).where(eq(projectCardComments.id, id)).get()
      return row ? rowToComment(row, projectId) : null
    }
  }

  const db = getDrizzle()
  const row = db.select().from(cardComments).where(eq(cardComments.id, id)).get()
  return row ? rowToComment(row) : null
}

/**
 * Get all comments for a card.
 */
export function getCommentsByCard(cardId: string, projectId?: string): CardComment[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectCardComments)
        .where(eq(projectCardComments.card_id, cardId))
        .orderBy(asc(projectCardComments.created_at))
        .all()
      return rows.map((r) => rowToComment(r, projectId))
    }
  }

  const db = getDrizzle()
  const rows = db
    .select()
    .from(cardComments)
    .where(eq(cardComments.card_id, cardId))
    .orderBy(asc(cardComments.created_at))
    .all()
  return rows.map((r) => rowToComment(r))
}

/**
 * Get comments for AI processing.
 * Returns open, user comments that are marked for inclusion, ordered by priority.
 */
export function getCommentsForAI(cardId: string, projectId?: string): CardComment[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectCardComments)
        .where(
          and(
            eq(projectCardComments.card_id, cardId),
            eq(projectCardComments.resolution, 'open'),
            eq(projectCardComments.source, 'user'),
            eq(projectCardComments.include_in_next_run, true)
          )
        )
        .orderBy(
          // Priority order: critical > important > normal
          desc(projectCardComments.priority),
          asc(projectCardComments.created_at)
        )
        .all()
      return rows.map((r) => rowToComment(r, projectId))
    }
  }

  const db = getDrizzle()
  const rows = db
    .select()
    .from(cardComments)
    .where(
      and(
        eq(cardComments.card_id, cardId),
        eq(cardComments.resolution, 'open'),
        eq(cardComments.source, 'user'),
        eq(cardComments.include_in_next_run, true)
      )
    )
    .orderBy(desc(cardComments.priority), asc(cardComments.created_at))
    .all()
  return rows.map((r) => rowToComment(r))
}

/**
 * Get unprocessed comments for a card.
 */
export function getUnprocessedComments(cardId: string, projectId?: string): CardComment[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectCardComments)
        .where(
          and(
            eq(projectCardComments.card_id, cardId),
            eq(projectCardComments.resolution, 'open'),
            eq(projectCardComments.source, 'user')
          )
        )
        .orderBy(asc(projectCardComments.created_at))
        .all()
      // Filter in JS for null check on processed_for_job_id
      return rows.filter((r) => r.processed_for_job_id === null).map((r) => rowToComment(r, projectId))
    }
  }

  const db = getDrizzle()
  const rows = db
    .select()
    .from(cardComments)
    .where(
      and(
        eq(cardComments.card_id, cardId),
        eq(cardComments.resolution, 'open'),
        eq(cardComments.source, 'user')
      )
    )
    .orderBy(asc(cardComments.created_at))
    .all()
  return rows.filter((r) => r.processed_for_job_id === null).map((r) => rowToComment(r))
}

/**
 * Get a comment by its remote ID.
 */
export function getCommentByRemoteId(
  cardId: string,
  remoteCommentId: string,
  projectId?: string
): CardComment | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectCardComments)
        .where(
          and(
            eq(projectCardComments.card_id, cardId),
            eq(projectCardComments.remote_comment_id, remoteCommentId)
          )
        )
        .get()
      return row ? rowToComment(row, projectId) : null
    }
  }

  const db = getDrizzle()
  const row = db
    .select()
    .from(cardComments)
    .where(
      and(eq(cardComments.card_id, cardId), eq(cardComments.remote_comment_id, remoteCommentId))
    )
    .get()
  return row ? rowToComment(row) : null
}

/**
 * Get comments with pending push sync state.
 */
export function getCommentsPendingPush(projectId: string): CardComment[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const rows = db
      .select()
      .from(projectCardComments)
      .where(eq(projectCardComments.sync_state, 'pending_push'))
      .all()
    return rows.map((r) => rowToComment(r, projectId))
  }

  const rows = db
    .select()
    .from(cardComments)
    .where(
      and(eq(cardComments.project_id, projectId), eq(cardComments.sync_state, 'pending_push'))
    )
    .all()
  return rows.map((r) => rowToComment(r))
}

// ============================================================================
// Update Operations
// ============================================================================

/**
 * Update a card comment.
 */
export function updateCardComment(
  id: string,
  data: CardCommentUpdate,
  projectId?: string
): CardComment | null {
  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { updated_at: now }

  if (data.body !== undefined) updateData.body = data.body
  if (data.author !== undefined) updateData.author = data.author
  if (data.priority !== undefined) updateData.priority = data.priority
  if (data.resolution !== undefined) updateData.resolution = data.resolution
  if (data.include_in_next_run !== undefined)
    updateData.include_in_next_run = data.include_in_next_run
  if (data.sync_state !== undefined) updateData.sync_state = data.sync_state
  if (data.remote_comment_id !== undefined) updateData.remote_comment_id = data.remote_comment_id

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectCardComments)
        .set(updateData)
        .where(eq(projectCardComments.id, id))
        .run()
      return getCardComment(id, projectId)
    }
  }

  const db = getDrizzle()
  db.update(cardComments).set(updateData).where(eq(cardComments.id, id)).run()
  return getCardComment(id, projectId)
}

/**
 * Update comment priority.
 */
export function updateCommentPriority(
  id: string,
  priority: CommentPriority,
  projectId?: string
): CardComment | null {
  return updateCardComment(id, { priority }, projectId)
}

/**
 * Update comment body text.
 * Marks the comment for re-sync if it has a remote_comment_id.
 */
export function editCommentBody(
  id: string,
  body: string,
  projectId?: string
): CardComment | null {
  const comment = getCardComment(id, projectId)
  if (!comment) return null

  // If the comment is synced to remote, mark it for re-push
  const syncState = comment.remote_comment_id ? 'pending_push' : comment.sync_state
  return updateCardComment(id, { body, sync_state: syncState }, projectId)
}

/**
 * Mark a comment as resolved.
 */
export function resolveComment(id: string, jobId?: string, projectId?: string): CardComment | null {
  const now = new Date().toISOString()
  const updateData = {
    resolution: 'resolved' as const,
    resolved_at: now,
    resolved_by_job_id: jobId ?? null,
    updated_at: now
  }

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectCardComments)
        .set(updateData)
        .where(eq(projectCardComments.id, id))
        .run()
      return getCardComment(id, projectId)
    }
  }

  const db = getDrizzle()
  db.update(cardComments).set(updateData).where(eq(cardComments.id, id)).run()
  return getCardComment(id, projectId)
}

/**
 * Reopen a resolved comment.
 */
export function reopenComment(id: string, projectId?: string): CardComment | null {
  const now = new Date().toISOString()
  const updateData = {
    resolution: 'open' as const,
    resolved_at: null,
    resolved_by_job_id: null,
    updated_at: now
  }

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectCardComments)
        .set(updateData)
        .where(eq(projectCardComments.id, id))
        .run()
      return getCardComment(id, projectId)
    }
  }

  const db = getDrizzle()
  db.update(cardComments).set(updateData).where(eq(cardComments.id, id)).run()
  return getCardComment(id, projectId)
}

/**
 * Toggle include_in_next_run for a comment.
 */
export function toggleCommentInclusion(
  id: string,
  include: boolean,
  projectId?: string
): CardComment | null {
  return updateCardComment(id, { include_in_next_run: include }, projectId)
}

/**
 * Mark comments as processed by a job.
 */
export function markCommentsProcessed(cardId: string, jobId: string, projectId?: string): number {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .update(projectCardComments)
        .set({
          processed_for_job_id: jobId,
          processed_at: now,
          updated_at: now
        })
        .where(
          and(
            eq(projectCardComments.card_id, cardId),
            eq(projectCardComments.resolution, 'open'),
            eq(projectCardComments.source, 'user'),
            eq(projectCardComments.include_in_next_run, true)
          )
        )
        .run()
      return result.changes
    }
  }

  const db = getDrizzle()
  const result = db
    .update(cardComments)
    .set({
      processed_for_job_id: jobId,
      processed_at: now,
      updated_at: now
    })
    .where(
      and(
        eq(cardComments.card_id, cardId),
        eq(cardComments.resolution, 'open'),
        eq(cardComments.source, 'user'),
        eq(cardComments.include_in_next_run, true)
      )
    )
    .run()
  return result.changes
}

/**
 * Update sync state for a comment.
 */
export function updateCommentSyncState(
  id: string,
  syncState: CommentSyncState,
  remoteCommentId?: string,
  projectId?: string
): CardComment | null {
  const updateData: CardCommentUpdate = { sync_state: syncState }
  if (remoteCommentId) updateData.remote_comment_id = remoteCommentId
  return updateCardComment(id, updateData, projectId)
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete a comment.
 */
export function deleteCardComment(id: string, projectId?: string): boolean {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .delete(projectCardComments)
        .where(eq(projectCardComments.id, id))
        .run()
      return result.changes > 0
    }
  }

  const db = getDrizzle()
  const result = db.delete(cardComments).where(eq(cardComments.id, id)).run()
  return result.changes > 0
}

/**
 * Delete all comments for a card.
 */
export function deleteCommentsByCard(cardId: string, projectId?: string): number {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .delete(projectCardComments)
        .where(eq(projectCardComments.card_id, cardId))
        .run()
      return result.changes
    }
  }

  const db = getDrizzle()
  const result = db.delete(cardComments).where(eq(cardComments.card_id, cardId)).run()
  return result.changes
}

// ============================================================================
// Deduplication Operations
// ============================================================================

/**
 * Find and remove duplicate comments for a card.
 * Duplicates are identified by matching normalized body only (case-insensitive).
 * This matches the UI detection logic which also uses body-only matching.
 * Keeps the comment with remote_comment_id set, or the earliest created.
 *
 * @returns Number of duplicate comments deleted
 */
export function deduplicateCommentsForCard(cardId: string, projectId: string): number {
  const comments = getCommentsByCard(cardId, projectId)
  const seen = new Map<string, CardComment>()
  let deleted = 0

  for (const comment of comments) {
    // Create a key from normalized body only (case-insensitive) to match UI detection
    const key = normalizeBody(comment.body).toLowerCase()
    const existing = seen.get(key)

    if (existing) {
      // Determine which comment to keep:
      // 1. Prefer comment with remote_comment_id set
      // 2. Otherwise, prefer earlier created_at
      let keep: CardComment
      let remove: CardComment

      if (existing.remote_comment_id && !comment.remote_comment_id) {
        keep = existing
        remove = comment
      } else if (!existing.remote_comment_id && comment.remote_comment_id) {
        keep = comment
        remove = existing
      } else {
        // Both have or both lack remote_comment_id, use creation time
        keep = new Date(existing.created_at) < new Date(comment.created_at)
          ? existing
          : comment
        remove = keep === existing ? comment : existing
      }

      // Delete the duplicate
      deleteCardComment(remove.id, projectId)
      seen.set(key, keep)
      deleted++
    } else {
      seen.set(key, comment)
    }
  }

  return deleted
}

/**
 * Deduplicate comments across all cards in a project.
 * This is useful for cleaning up existing duplicates that were created
 * before the improved deduplication logic was added.
 *
 * @returns Object with total deleted count and per-card breakdown
 */
export function deduplicateAllComments(projectId: string): {
  totalDeleted: number
  cardBreakdown: Array<{ cardId: string; deleted: number }>
} {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  // Get all unique card IDs that have comments
  let cardIds: string[]

  if (isLocalDb) {
    const rows = db
      .selectDistinct({ card_id: projectCardComments.card_id })
      .from(projectCardComments)
      .all()
    cardIds = rows.map((r) => r.card_id)
  } else {
    const rows = db
      .selectDistinct({ card_id: cardComments.card_id })
      .from(cardComments)
      .where(eq(cardComments.project_id, projectId))
      .all()
    cardIds = rows.map((r) => r.card_id)
  }

  let totalDeleted = 0
  const cardBreakdown: Array<{ cardId: string; deleted: number }> = []

  for (const cardId of cardIds) {
    const deleted = deduplicateCommentsForCard(cardId, projectId)
    if (deleted > 0) {
      totalDeleted += deleted
      cardBreakdown.push({ cardId, deleted })
    }
  }

  return { totalDeleted, cardBreakdown }
}
