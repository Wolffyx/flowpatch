/**
 * App Settings Table Schema (Central DB)
 *
 * Stores global app-wide settings like theme, API keys, window state.
 * Project-specific settings should go in .flowpatch/config.yml instead.
 */

import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: text('updated_at').notNull()
})

export type AppSetting = typeof appSettings.$inferSelect
export type NewAppSetting = typeof appSettings.$inferInsert
