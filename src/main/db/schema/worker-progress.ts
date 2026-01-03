/**
 * Worker Progress Table Schema
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { cards } from './cards'
import { jobs } from './jobs'

export const workerProgress = sqliteTable(
  'worker_progress',
  {
    id: text('id').primaryKey(),
    card_id: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    job_id: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    iteration: integer('iteration').notNull().default(1),
    total_iterations: integer('total_iterations').notNull().default(1),
    subtask_index: integer('subtask_index').notNull().default(0),
    subtasks_completed: integer('subtasks_completed').notNull().default(0),
    files_modified_json: text('files_modified_json'),
    context_summary: text('context_summary'),
    progress_file_path: text('progress_file_path'),
    last_checkpoint: text('last_checkpoint').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    index('idx_progress_card').on(table.card_id),
    index('idx_progress_job').on(table.job_id)
  ]
)

export const workerProgressRelations = relations(workerProgress, ({ one }) => ({
  card: one(cards, {
    fields: [workerProgress.card_id],
    references: [cards.id]
  }),
  job: one(jobs, {
    fields: [workerProgress.job_id],
    references: [jobs.id]
  })
}))

export type WorkerProgress = typeof workerProgress.$inferSelect
export type NewWorkerProgress = typeof workerProgress.$inferInsert
