/**
 * Card Comment Types
 *
 * Types for the bidirectional comment/feedback system that allows
 * users to provide feedback to the AI worker through comments on cards.
 */

/** Source of the comment */
export type CommentSource = 'user' | 'ai_worker' | 'system'

/** Sync state for bidirectional sync with remote (GitHub/GitLab) */
export type CommentSyncState = 'ok' | 'pending_push' | 'error'

/** Priority level for AI processing order */
export type CommentPriority = 'critical' | 'important' | 'normal'

/** Resolution status of the comment */
export type CommentResolution = 'open' | 'resolved' | 'wont_fix'

/**
 * Card comment interface for storing feedback on cards
 * that the AI worker should consider when processing.
 */
export interface CardComment {
  id: string
  card_id: string
  project_id: string

  /** Remote comment ID from GitHub/GitLab (null for local-only comments) */
  remote_comment_id: string | null

  /** Username of comment author */
  author: string | null

  /** Comment body/content */
  body: string

  /** Source of the comment (user, ai_worker, or system) */
  source: CommentSource

  /** Sync state with remote */
  sync_state: CommentSyncState

  /** Priority level for AI processing (critical first) */
  priority: CommentPriority

  /** Resolution status */
  resolution: CommentResolution

  /** When the comment was resolved */
  resolved_at: string | null

  /** Job ID that resolved this comment */
  resolved_by_job_id: string | null

  /** Whether to include this comment in the next AI run */
  include_in_next_run: boolean

  /** Job ID that processed this comment */
  processed_for_job_id: string | null

  /** When the comment was processed */
  processed_at: string | null

  /** When created locally */
  created_at: string

  /** When created on remote (GitHub/GitLab) */
  remote_created_at: string | null

  /** Last update timestamp */
  updated_at: string
}

/**
 * Data required to create a new comment
 */
export interface CardCommentCreate {
  card_id: string
  project_id: string
  body: string
  priority?: CommentPriority
  source?: CommentSource
  /** If syncing from remote */
  remote_comment_id?: string
  author?: string
  remote_created_at?: string
}

/**
 * Data for updating an existing comment
 */
export interface CardCommentUpdate {
  body?: string
  author?: string
  priority?: CommentPriority
  resolution?: CommentResolution
  include_in_next_run?: boolean
  sync_state?: CommentSyncState
  remote_comment_id?: string
}
