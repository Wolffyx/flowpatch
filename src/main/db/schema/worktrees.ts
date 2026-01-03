/**
 * Worktrees Table Schema
 */

import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cards } from './cards'
import { jobs } from './jobs'
import { workerSlots } from './worker-slots'

export const worktrees = sqliteTable(
  'worktrees',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    card_id: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    job_id: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    worktree_path: text('worktree_path').notNull(),
    branch_name: text('branch_name').notNull(),
    base_ref: text('base_ref').notNull(),
    status: text('status').notNull().default('creating'),
    last_error: text('last_error'),
    locked_by: text('locked_by'),
    lock_expires_at: text('lock_expires_at'),
    cleanup_requested_at: text('cleanup_requested_at'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    index('idx_worktrees_project').on(table.project_id),
    index('idx_worktrees_card').on(table.card_id),
    index('idx_worktrees_status').on(table.status),
    index('idx_worktrees_locked').on(table.locked_by, table.lock_expires_at),
    uniqueIndex('idx_worktrees_path').on(table.worktree_path),
    uniqueIndex('idx_worktrees_branch').on(table.project_id, table.branch_name)
  ]
)

export const worktreesRelations = relations(worktrees, ({ one, many }) => ({
  project: one(projects, {
    fields: [worktrees.project_id],
    references: [projects.id]
  }),
  card: one(cards, {
    fields: [worktrees.card_id],
    references: [cards.id]
  }),
  job: one(jobs, {
    fields: [worktrees.job_id],
    references: [jobs.id]
  }),
  workerSlots: many(workerSlots)
}))

export type Worktree = typeof worktrees.$inferSelect
export type NewWorktree = typeof worktrees.$inferInsert
