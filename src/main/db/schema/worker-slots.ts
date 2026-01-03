/**
 * Worker Slots Table Schema
 */

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cards } from './cards'
import { jobs } from './jobs'
import { worktrees } from './worktrees'

export const workerSlots = sqliteTable(
  'worker_slots',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    slot_number: integer('slot_number').notNull(),
    card_id: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    job_id: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    worktree_id: text('worktree_id').references(() => worktrees.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('idle'),
    started_at: text('started_at'),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    index('idx_slots_project').on(table.project_id),
    index('idx_slots_status').on(table.status),
    uniqueIndex('idx_slots_unique').on(table.project_id, table.slot_number)
  ]
)

export const workerSlotsRelations = relations(workerSlots, ({ one }) => ({
  project: one(projects, {
    fields: [workerSlots.project_id],
    references: [projects.id]
  }),
  card: one(cards, {
    fields: [workerSlots.card_id],
    references: [cards.id]
  }),
  job: one(jobs, {
    fields: [workerSlots.job_id],
    references: [jobs.id]
  }),
  worktree: one(worktrees, {
    fields: [workerSlots.worktree_id],
    references: [worktrees.id]
  })
}))

export type WorkerSlot = typeof workerSlots.$inferSelect
export type NewWorkerSlot = typeof workerSlots.$inferInsert
