/**
 * Sync State Table Schema
 */

import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'

export const syncState = sqliteTable(
  'sync_state',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    cursor_type: text('cursor_type').notNull(),
    cursor_value: text('cursor_value'),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    uniqueIndex('idx_sync_state_unique').on(table.project_id, table.provider, table.cursor_type)
  ]
)

export const syncStateRelations = relations(syncState, ({ one }) => ({
  project: one(projects, {
    fields: [syncState.project_id],
    references: [projects.id]
  })
}))

export type SyncState = typeof syncState.$inferSelect
export type NewSyncState = typeof syncState.$inferInsert
