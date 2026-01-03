/**
 * Agent Chat Messages Table Schema
 */

import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cards } from './cards'
import { jobs } from './jobs'

export const agentChatMessages = sqliteTable(
  'agent_chat_messages',
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
    role: text('role').notNull(),
    content: text('content').notNull(),
    status: text('status').notNull().default('sent'),
    metadata_json: text('metadata_json'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at')
  },
  (table) => [
    index('idx_agent_chat_job').on(table.job_id),
    index('idx_agent_chat_card').on(table.card_id),
    index('idx_agent_chat_project').on(table.project_id),
    index('idx_agent_chat_role').on(table.role),
    index('idx_agent_chat_created').on(table.created_at)
  ]
)

export const agentChatMessagesRelations = relations(agentChatMessages, ({ one }) => ({
  job: one(jobs, {
    fields: [agentChatMessages.job_id],
    references: [jobs.id]
  }),
  card: one(cards, {
    fields: [agentChatMessages.card_id],
    references: [cards.id]
  }),
  project: one(projects, {
    fields: [agentChatMessages.project_id],
    references: [projects.id]
  })
}))

export type AgentChatMessage = typeof agentChatMessages.$inferSelect
export type NewAgentChatMessage = typeof agentChatMessages.$inferInsert
