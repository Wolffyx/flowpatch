/**
 * Projects Table Schema
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { cards } from './cards'
import { jobs } from './jobs'
import { events } from './events'
import { worktrees } from './worktrees'
import { subtasks } from './subtasks'
import { workerSlots } from './worker-slots'
import { syncState } from './sync-state'
import { aiProfiles } from './ai-profiles'
import { featureSuggestions } from './feature-suggestions'
import { cardDependencies } from './card-dependencies'
import { usageRecords } from './usage'
import { planApprovals } from './plan-approvals'
import { followUpInstructions } from './follow-up-instructions'
import { agentChatMessages } from './agent-chat'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  local_path: text('local_path').notNull(),
  selected_remote_name: text('selected_remote_name'),
  remote_repo_key: text('remote_repo_key'),
  provider_hint: text('provider_hint').notNull().default('auto'),
  policy_json: text('policy_json'),
  worker_enabled: integer('worker_enabled').notNull().default(0),
  last_sync_at: text('last_sync_at'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull()
})

export const projectsRelations = relations(projects, ({ many }) => ({
  cards: many(cards),
  jobs: many(jobs),
  events: many(events),
  worktrees: many(worktrees),
  subtasks: many(subtasks),
  workerSlots: many(workerSlots),
  syncState: many(syncState),
  aiProfiles: many(aiProfiles),
  featureSuggestions: many(featureSuggestions),
  cardDependencies: many(cardDependencies),
  usageRecords: many(usageRecords),
  planApprovals: many(planApprovals),
  followUpInstructions: many(followUpInstructions),
  agentChatMessages: many(agentChatMessages)
}))

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
