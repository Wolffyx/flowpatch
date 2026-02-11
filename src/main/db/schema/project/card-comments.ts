/**
 * Card Comments Table Schema (Project DB)
 *
 * Stores comments/feedback on cards that the AI worker should consider.
 * Supports bidirectional sync with GitHub/GitLab.
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { cards } from './cards'

export const cardComments = sqliteTable(
  'card_comments',
  {
    id: text('id').primaryKey(),
    card_id: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),

    /** Remote comment ID from GitHub/GitLab */
    remote_comment_id: text('remote_comment_id'),

    /** Username of comment author */
    author: text('author'),

    /** Comment body/content */
    body: text('body').notNull(),

    /** Source: 'user' | 'ai_worker' | 'system' */
    source: text('source').notNull().default('user'),

    /** Sync state: 'ok' | 'pending_push' | 'error' */
    sync_state: text('sync_state').notNull().default('ok'),

    /** Priority: 'critical' | 'important' | 'normal' */
    priority: text('priority').notNull().default('normal'),

    /** Resolution: 'open' | 'resolved' | 'wont_fix' */
    resolution: text('resolution').notNull().default('open'),

    /** When resolved */
    resolved_at: text('resolved_at'),

    /** Job ID that resolved this comment */
    resolved_by_job_id: text('resolved_by_job_id'),

    /** Whether to include in next AI run (1 = true, 0 = false) */
    include_in_next_run: integer('include_in_next_run', { mode: 'boolean' })
      .notNull()
      .default(true),

    /** Job ID that processed this comment */
    processed_for_job_id: text('processed_for_job_id'),

    /** When processed */
    processed_at: text('processed_at'),

    /** When created locally */
    created_at: text('created_at').notNull(),

    /** When created on remote */
    remote_created_at: text('remote_created_at'),

    /** Last update timestamp */
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    index('idx_comment_card').on(table.card_id),
    index('idx_comment_remote').on(table.remote_comment_id),
    index('idx_comment_resolution').on(table.resolution),
    index('idx_comment_sync_state').on(table.sync_state)
  ]
)

export const cardCommentsRelations = relations(cardComments, ({ one }) => ({
  card: one(cards, {
    fields: [cardComments.card_id],
    references: [cards.id]
  })
}))

export type CardCommentRow = typeof cardComments.$inferSelect
export type NewCardCommentRow = typeof cardComments.$inferInsert
