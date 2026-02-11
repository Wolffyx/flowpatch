/**
 * Projects Table Schema (Central DB)
 *
 * This table stays in the central database as a registry of all projects.
 * Project-specific data (cards, jobs, etc.) is stored in each project's
 * local .flowpatch/project.db file.
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

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
  local_db_migrated: integer('local_db_migrated').notNull().default(0),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull()
})

// No relations defined here - project-specific tables are in project DB

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
