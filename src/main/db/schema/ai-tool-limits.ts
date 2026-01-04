/**
 * AI Tool Limits Table Schema
 */

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const aiToolLimits = sqliteTable('ai_tool_limits', {
  id: text('id').primaryKey(),
  tool_type: text('tool_type').notNull().unique(),
  hourly_token_limit: integer('hourly_token_limit'),
  daily_token_limit: integer('daily_token_limit'),
  monthly_token_limit: integer('monthly_token_limit'),
  hourly_cost_limit_usd: real('hourly_cost_limit_usd'),
  daily_cost_limit_usd: real('daily_cost_limit_usd'),
  monthly_cost_limit_usd: real('monthly_cost_limit_usd'),
  updated_at: text('updated_at').notNull()
})

export type AIToolLimit = typeof aiToolLimits.$inferSelect
export type NewAIToolLimit = typeof aiToolLimits.$inferInsert
