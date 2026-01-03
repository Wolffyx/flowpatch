/**
 * Jobs Table Schema
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cards } from './cards'
import { worktrees } from './worktrees'
import { workerSlots } from './worker-slots'
import { workerProgress } from './worker-progress'
import { planApprovals } from './plan-approvals'
import { followUpInstructions } from './follow-up-instructions'
import { usageRecords } from './usage'
import { agentChatMessages } from './agent-chat'

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    card_id: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    state: text('state').notNull().default('queued'),
    lease_until: text('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    payload_json: text('payload_json'),
    result_json: text('result_json'),
    last_error: text('last_error'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    index('idx_jobs_project_id').on(table.project_id),
    index('idx_jobs_state').on(table.state),
    index('idx_jobs_type').on(table.type)
  ]
)

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  project: one(projects, {
    fields: [jobs.project_id],
    references: [projects.id]
  }),
  card: one(cards, {
    fields: [jobs.card_id],
    references: [cards.id]
  }),
  worktrees: many(worktrees),
  workerSlots: many(workerSlots),
  workerProgress: many(workerProgress),
  planApprovals: many(planApprovals),
  followUpInstructions: many(followUpInstructions),
  usageRecords: many(usageRecords),
  agentChatMessages: many(agentChatMessages)
}))

export type Job = typeof jobs.$inferSelect
export type NewJob = typeof jobs.$inferInsert
