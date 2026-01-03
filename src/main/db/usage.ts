/**
 * Usage Tracking Database Module
 *
 * Handles CRUD operations for AI tool usage tracking.
 */

import { and, asc, desc, eq, gte, lt, sql, sum } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { usageRecords, aiToolLimits } from './schema'
import { generateId } from '@shared/utils'
import type {
  UsageRecord,
  UsageStats,
  UsageSummary,
  AIToolType,
  AIToolLimits,
  UsageWithLimits
} from '@shared/types'

export type { UsageRecord, UsageStats, UsageSummary, AIToolLimits, UsageWithLimits }

export interface UsageRecordCreate {
  projectId: string
  jobId?: string
  cardId?: string
  toolType: AIToolType
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd?: number
  durationMs: number
  model?: string
}

/**
 * Create a new usage record.
 */
export function createUsageRecord(data: UsageRecordCreate): UsageRecord {
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

  db.insert(usageRecords)
    .values({
      id,
      project_id: data.projectId,
      job_id: data.jobId ?? null,
      card_id: data.cardId ?? null,
      tool_type: data.toolType,
      input_tokens: data.inputTokens,
      output_tokens: data.outputTokens,
      total_tokens: data.totalTokens,
      cost_usd: data.costUsd ?? null,
      duration_ms: data.durationMs,
      model: data.model ?? null,
      created_at: now
    })
    .run()

  return {
    id,
    project_id: data.projectId,
    job_id: data.jobId ?? null,
    card_id: data.cardId ?? null,
    tool_type: data.toolType,
    input_tokens: data.inputTokens,
    output_tokens: data.outputTokens,
    total_tokens: data.totalTokens,
    cost_usd: data.costUsd ?? null,
    duration_ms: data.durationMs,
    model: data.model ?? null,
    created_at: now
  }
}

/**
 * Get usage records for a project.
 */
export function getUsageRecords(projectId: string, limit = 100, offset = 0): UsageRecord[] {
  const db = getDrizzle()
  return db
    .select()
    .from(usageRecords)
    .where(eq(usageRecords.project_id, projectId))
    .orderBy(desc(usageRecords.created_at))
    .limit(limit)
    .offset(offset)
    .all() as UsageRecord[]
}

/**
 * Get usage records for a job.
 */
export function getUsageRecordsByJob(jobId: string): UsageRecord[] {
  const db = getDrizzle()
  return db
    .select()
    .from(usageRecords)
    .where(eq(usageRecords.job_id, jobId))
    .orderBy(asc(usageRecords.created_at))
    .all() as UsageRecord[]
}

/**
 * Get aggregated usage stats by tool type for a time period.
 */
export function getUsageStatsByTool(
  projectId: string | null,
  startDate: string,
  endDate: string
): UsageStats[] {
  const db = getDrizzle()

  const conditions = [gte(usageRecords.created_at, startDate), lt(usageRecords.created_at, endDate)]

  if (projectId) {
    conditions.push(eq(usageRecords.project_id, projectId))
  }

  const rows = db
    .select({
      tool_type: usageRecords.tool_type,
      total_input_tokens: sum(usageRecords.input_tokens),
      total_output_tokens: sum(usageRecords.output_tokens),
      total_tokens: sum(usageRecords.total_tokens),
      total_cost_usd: sql<number>`SUM(COALESCE(${usageRecords.cost_usd}, 0))`,
      invocation_count: sql<number>`COUNT(*)`,
      avg_duration_ms: sql<number>`AVG(${usageRecords.duration_ms})`
    })
    .from(usageRecords)
    .where(and(...conditions))
    .groupBy(usageRecords.tool_type)
    .all()

  return rows.map((row) => ({
    tool_type: row.tool_type as AIToolType,
    total_input_tokens: Number(row.total_input_tokens) || 0,
    total_output_tokens: Number(row.total_output_tokens) || 0,
    total_tokens: Number(row.total_tokens) || 0,
    total_cost_usd: Number(row.total_cost_usd) || 0,
    invocation_count: Number(row.invocation_count),
    avg_duration_ms: Math.round(Number(row.avg_duration_ms) || 0)
  }))
}

/**
 * Get usage summary for all tools.
 */
export function getUsageSummary(
  projectId: string | null,
  startDate: string,
  endDate: string
): UsageSummary {
  const byTool = getUsageStatsByTool(projectId, startDate, endDate)

  return {
    total_tokens: byTool.reduce((sum, t) => sum + t.total_tokens, 0),
    total_cost_usd: byTool.reduce((sum, t) => sum + t.total_cost_usd, 0),
    by_tool: byTool,
    period_start: startDate,
    period_end: endDate
  }
}

/**
 * Get daily usage for a tool type.
 */
export function getDailyUsage(toolType: AIToolType): { tokens: number; cost: number } {
  const db = getDrizzle()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startOfDay = today.toISOString()

  const result = db
    .select({
      tokens: sum(usageRecords.total_tokens),
      cost: sql<number>`SUM(COALESCE(${usageRecords.cost_usd}, 0))`
    })
    .from(usageRecords)
    .where(and(eq(usageRecords.tool_type, toolType), gte(usageRecords.created_at, startOfDay)))
    .get()

  return {
    tokens: Number(result?.tokens) || 0,
    cost: Number(result?.cost) || 0
  }
}

/**
 * Get monthly usage for a tool type.
 */
export function getMonthlyUsage(toolType: AIToolType): { tokens: number; cost: number } {
  const db = getDrizzle()
  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()

  const result = db
    .select({
      tokens: sum(usageRecords.total_tokens),
      cost: sql<number>`SUM(COALESCE(${usageRecords.cost_usd}, 0))`
    })
    .from(usageRecords)
    .where(and(eq(usageRecords.tool_type, toolType), gte(usageRecords.created_at, startOfMonth)))
    .get()

  return {
    tokens: Number(result?.tokens) || 0,
    cost: Number(result?.cost) || 0
  }
}

/**
 * Get total usage across all tools (for the header display).
 */
export function getTotalUsage(): { tokens: number; cost: number } {
  const db = getDrizzle()
  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()

  const result = db
    .select({
      tokens: sum(usageRecords.total_tokens),
      cost: sql<number>`SUM(COALESCE(${usageRecords.cost_usd}, 0))`
    })
    .from(usageRecords)
    .where(gte(usageRecords.created_at, startOfMonth))
    .get()

  return {
    tokens: Number(result?.tokens) || 0,
    cost: Number(result?.cost) || 0
  }
}

// ============================================================================
// AI Tool Limits
// ============================================================================

/**
 * Get limits for a specific tool.
 */
export function getToolLimits(toolType: AIToolType): AIToolLimits | null {
  const db = getDrizzle()
  const row = db
    .select()
    .from(aiToolLimits)
    .where(eq(aiToolLimits.tool_type, toolType))
    .get()

  if (!row) return null

  return {
    tool_type: row.tool_type as AIToolType,
    daily_token_limit: row.daily_token_limit,
    monthly_token_limit: row.monthly_token_limit,
    daily_cost_limit_usd: row.daily_cost_limit_usd,
    monthly_cost_limit_usd: row.monthly_cost_limit_usd
  }
}

/**
 * Get limits for all tools.
 */
export function getAllToolLimits(): AIToolLimits[] {
  const db = getDrizzle()
  const rows = db.select().from(aiToolLimits).all()

  return rows.map((row) => ({
    tool_type: row.tool_type as AIToolType,
    daily_token_limit: row.daily_token_limit,
    monthly_token_limit: row.monthly_token_limit,
    daily_cost_limit_usd: row.daily_cost_limit_usd,
    monthly_cost_limit_usd: row.monthly_cost_limit_usd
  }))
}

/**
 * Set limits for a tool.
 */
export function setToolLimits(
  toolType: AIToolType,
  limits: Partial<Omit<AIToolLimits, 'tool_type'>>
): AIToolLimits {
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

  // Check if limits exist for this tool
  const existing = getToolLimits(toolType)

  if (existing) {
    db.update(aiToolLimits)
      .set({
        daily_token_limit:
          limits.daily_token_limit !== undefined
            ? limits.daily_token_limit
            : existing.daily_token_limit,
        monthly_token_limit:
          limits.monthly_token_limit !== undefined
            ? limits.monthly_token_limit
            : existing.monthly_token_limit,
        daily_cost_limit_usd:
          limits.daily_cost_limit_usd !== undefined
            ? limits.daily_cost_limit_usd
            : existing.daily_cost_limit_usd,
        monthly_cost_limit_usd:
          limits.monthly_cost_limit_usd !== undefined
            ? limits.monthly_cost_limit_usd
            : existing.monthly_cost_limit_usd,
        updated_at: now
      })
      .where(eq(aiToolLimits.tool_type, toolType))
      .run()
  } else {
    db.insert(aiToolLimits)
      .values({
        id,
        tool_type: toolType,
        daily_token_limit: limits.daily_token_limit ?? null,
        monthly_token_limit: limits.monthly_token_limit ?? null,
        daily_cost_limit_usd: limits.daily_cost_limit_usd ?? null,
        monthly_cost_limit_usd: limits.monthly_cost_limit_usd ?? null,
        updated_at: now
      })
      .run()
  }

  return (
    getToolLimits(toolType) || {
      tool_type: toolType,
      daily_token_limit: limits.daily_token_limit ?? null,
      monthly_token_limit: limits.monthly_token_limit ?? null,
      daily_cost_limit_usd: limits.daily_cost_limit_usd ?? null,
      monthly_cost_limit_usd: limits.monthly_cost_limit_usd ?? null
    }
  )
}

/**
 * Get usage with limits for all tools (for display in dropdown).
 */
export function getUsageWithLimits(): UsageWithLimits[] {
  const db = getDrizzle()

  // Get all tool types that have either usage or limits
  const toolTypes: AIToolType[] = ['claude', 'codex', 'other']
  const results: UsageWithLimits[] = []

  for (const toolType of toolTypes) {
    const daily = getDailyUsage(toolType)
    const monthly = getMonthlyUsage(toolType)
    const limits = getToolLimits(toolType)

    // Get all-time stats for this tool
    const stats = db
      .select({
        total_input_tokens: sum(usageRecords.input_tokens),
        total_output_tokens: sum(usageRecords.output_tokens),
        total_tokens: sum(usageRecords.total_tokens),
        total_cost_usd: sql<number>`SUM(COALESCE(${usageRecords.cost_usd}, 0))`,
        invocation_count: sql<number>`COUNT(*)`,
        avg_duration_ms: sql<number>`AVG(${usageRecords.duration_ms})`
      })
      .from(usageRecords)
      .where(eq(usageRecords.tool_type, toolType))
      .get()

    const invocationCount = Number(stats?.invocation_count) || 0

    // Only include tools that have usage or configured limits
    if (invocationCount > 0 || limits) {
      results.push({
        tool_type: toolType,
        total_input_tokens: Number(stats?.total_input_tokens) || 0,
        total_output_tokens: Number(stats?.total_output_tokens) || 0,
        total_tokens: Number(stats?.total_tokens) || 0,
        total_cost_usd: Number(stats?.total_cost_usd) || 0,
        invocation_count: invocationCount,
        avg_duration_ms: Math.round(Number(stats?.avg_duration_ms) || 0),
        limits,
        daily_tokens_used: daily.tokens,
        monthly_tokens_used: monthly.tokens,
        daily_cost_used: daily.cost,
        monthly_cost_used: monthly.cost
      })
    }
  }

  return results
}

/**
 * Delete usage records older than a certain date.
 */
export function deleteOldUsageRecords(beforeDate: string): number {
  const db = getDrizzle()
  const result = db
    .delete(usageRecords)
    .where(lt(usageRecords.created_at, beforeDate))
    .run()
  return result.changes
}
