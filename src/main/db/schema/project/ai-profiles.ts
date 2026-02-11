/**
 * AI Profiles Table Schema (Project DB)
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const aiProfiles = sqliteTable(
  'ai_profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    is_default: integer('is_default').notNull().default(0),

    // Model configuration
    model_provider: text('model_provider').notNull().default('auto'),
    model_name: text('model_name'),

    // Model parameters
    temperature: real('temperature'),
    max_tokens: integer('max_tokens'),
    top_p: real('top_p'),

    // Custom instructions
    system_prompt: text('system_prompt'),

    // AI Features
    thinking_enabled: integer('thinking_enabled'),
    thinking_mode: text('thinking_mode'),
    thinking_budget_tokens: integer('thinking_budget_tokens'),
    planning_enabled: integer('planning_enabled'),
    planning_mode: text('planning_mode'),

    // Timestamps
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    index('idx_ai_profiles_default').on(table.is_default),
    uniqueIndex('idx_ai_profiles_name').on(table.name)
  ]
)

export type AIProfile = typeof aiProfiles.$inferSelect
export type NewAIProfile = typeof aiProfiles.$inferInsert
