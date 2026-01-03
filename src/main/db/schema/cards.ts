/**
 * Cards Table Schema
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cardLinks } from './card-links'
import { cardDependencies } from './card-dependencies'
import { events } from './events'
import { jobs } from './jobs'
import { worktrees } from './worktrees'
import { subtasks } from './subtasks'
import { workerSlots } from './worker-slots'
import { workerProgress } from './worker-progress'
import { planApprovals } from './plan-approvals'
import { followUpInstructions } from './follow-up-instructions'
import { usageRecords } from './usage'
import { agentChatMessages } from './agent-chat'

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    status: text('status').notNull(),
    ready_eligible: integer('ready_eligible').notNull().default(0),
    assignees_json: text('assignees_json'),
    labels_json: text('labels_json'),
    remote_url: text('remote_url'),
    remote_repo_key: text('remote_repo_key'),
    remote_number_or_iid: text('remote_number_or_iid'),
    remote_node_id: text('remote_node_id'),
    updated_remote_at: text('updated_remote_at'),
    updated_local_at: text('updated_local_at').notNull(),
    sync_state: text('sync_state').notNull().default('ok'),
    last_error: text('last_error'),
    has_conflicts: integer('has_conflicts').notNull().default(0)
  },
  (table) => [
    index('idx_cards_project_id').on(table.project_id),
    index('idx_cards_status').on(table.status),
    index('idx_cards_remote').on(table.remote_repo_key, table.remote_number_or_iid)
  ]
)

export const cardsRelations = relations(cards, ({ one, many }) => ({
  project: one(projects, {
    fields: [cards.project_id],
    references: [projects.id]
  }),
  links: many(cardLinks),
  dependencies: many(cardDependencies, { relationName: 'cardDependencies' }),
  dependents: many(cardDependencies, { relationName: 'cardDependents' }),
  events: many(events),
  jobs: many(jobs),
  worktrees: many(worktrees),
  subtasks: many(subtasks),
  workerSlots: many(workerSlots),
  workerProgress: many(workerProgress),
  planApprovals: many(planApprovals),
  followUpInstructions: many(followUpInstructions),
  usageRecords: many(usageRecords),
  agentChatMessages: many(agentChatMessages)
}))

export type Card = typeof cards.$inferSelect
export type NewCard = typeof cards.$inferInsert
