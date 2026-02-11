/**
 * Sync State Table Schema (Project DB)
 */

import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const syncState = sqliteTable(
  'sync_state',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    cursor_type: text('cursor_type').notNull(),
    cursor_value: text('cursor_value'),
    updated_at: text('updated_at').notNull()
  },
  (table) => [uniqueIndex('idx_sync_state_unique').on(table.provider, table.cursor_type)]
)

export type SyncState = typeof syncState.$inferSelect
export type NewSyncState = typeof syncState.$inferInsert
