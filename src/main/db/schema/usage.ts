/**
 * Usage Records Table Schema
 */

import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cards } from './cards'
import { jobs } from './jobs'

export const usageRecords = sqliteTable(
  'usage_records',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    job_id: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    card_id: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    tool_type: text('tool_type').notNull(),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    total_tokens: integer('total_tokens').notNull().default(0),
    cost_usd: real('cost_usd'),
    duration_ms: integer('duration_ms').notNull().default(0),
    model: text('model'),
    created_at: text('created_at').notNull()
  },
  (table) => [
    index('idx_usage_project').on(table.project_id),
    index('idx_usage_job').on(table.job_id),
    index('idx_usage_tool').on(table.tool_type),
    index('idx_usage_created').on(table.created_at)
  ]
)

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  project: one(projects, {
    fields: [usageRecords.project_id],
    references: [projects.id]
  }),
  job: one(jobs, {
    fields: [usageRecords.job_id],
    references: [jobs.id]
  }),
  card: one(cards, {
    fields: [usageRecords.card_id],
    references: [cards.id]
  })
}))

export type UsageRecord = typeof usageRecords.$inferSelect
export type NewUsageRecord = typeof usageRecords.$inferInsert
