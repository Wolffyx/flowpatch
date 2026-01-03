/**
 * Follow-up Instructions Table Schema
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cards } from './cards'
import { jobs } from './jobs'

export const followUpInstructions = sqliteTable(
  'follow_up_instructions',
  {
    id: text('id').primaryKey(),
    job_id: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    card_id: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    instruction_type: text('instruction_type').notNull(),
    content: text('content').notNull(),
    status: text('status').notNull().default('pending'),
    priority: integer('priority').notNull().default(0),
    created_at: text('created_at').notNull(),
    processed_at: text('processed_at')
  },
  (table) => [
    index('idx_follow_up_job').on(table.job_id),
    index('idx_follow_up_card').on(table.card_id),
    index('idx_follow_up_project').on(table.project_id),
    index('idx_follow_up_status').on(table.status)
  ]
)

export const followUpInstructionsRelations = relations(followUpInstructions, ({ one }) => ({
  job: one(jobs, {
    fields: [followUpInstructions.job_id],
    references: [jobs.id]
  }),
  card: one(cards, {
    fields: [followUpInstructions.card_id],
    references: [cards.id]
  }),
  project: one(projects, {
    fields: [followUpInstructions.project_id],
    references: [projects.id]
  })
}))

export type FollowUpInstruction = typeof followUpInstructions.$inferSelect
export type NewFollowUpInstruction = typeof followUpInstructions.$inferInsert
