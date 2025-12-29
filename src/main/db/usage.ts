/**
 * Usage Tracking Database Module
 *
 * Handles CRUD operations for AI tool usage tracking.
 */

import { getDb } from './connection'
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

interface DbRow {
  id: string
  project_id: string
  job_id: string | null
  card_id: string | null
  tool_type: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number | null
  duration_ms: number
  model: string | null
  created_at: string
}

function rowToRecord(row: DbRow): UsageRecord {
  return {
    id: row.id,
    project_id: row.project_id,
    job_id: row.job_id,
    card_id: row.card_id,
    tool_type: row.tool_type as AIToolType,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    total_tokens: row.total_tokens,
    cost_usd: row.cost_usd,
    duration_ms: row.duration_ms,
    model: row.model,
    created_at: row.created_at
  }
}

/**
 * Create a new usage record.
 */
export function createUsageRecord(data: UsageRecordCreate): UsageRecord {
  const db = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO usage_records (id, project_id, job_id, card_id, tool_type, input_tokens, output_tokens, total_tokens, cost_usd, duration_ms, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.projectId,
    data.jobId ?? null,
    data.cardId ?? null,
    data.toolType,
    data.inputTokens,
    data.outputTokens,
    data.totalTokens,
    data.costUsd ?? null,
    data.durationMs,
    data.model ?? null,
    now
  )

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
export function getUsageRecords(
  projectId: string,
  limit = 100,
  offset = 0
): UsageRecord[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT * FROM usage_records WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(projectId, limit, offset) as DbRow[]
  return rows.map(rowToRecord)
}

/**
 * Get usage records for a job.
 */
export function getUsageRecordsByJob(jobId: string): UsageRecord[] {
  const db = getDb()
  const rows = db
    .prepare(`SELECT * FROM usage_records WHERE job_id = ? ORDER BY created_at ASC`)
    .all(jobId) as DbRow[]
  return rows.map(rowToRecord)
}

/**
 * Get aggregated usage stats by tool type for a time period.
 */
export function getUsageStatsByTool(
  projectId: string | null,
  startDate: string,
  endDate: string
): UsageStats[] {
  const db = getDb()

  const query = projectId
    ? `SELECT
         tool_type,
         SUM(input_tokens) as total_input_tokens,
         SUM(output_tokens) as total_output_tokens,
         SUM(total_tokens) as total_tokens,
         SUM(COALESCE(cost_usd, 0)) as total_cost_usd,
         COUNT(*) as invocation_count,
         AVG(duration_ms) as avg_duration_ms
       FROM usage_records
       WHERE project_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY tool_type`
    : `SELECT
         tool_type,
         SUM(input_tokens) as total_input_tokens,
         SUM(output_tokens) as total_output_tokens,
         SUM(total_tokens) as total_tokens,
         SUM(COALESCE(cost_usd, 0)) as total_cost_usd,
         COUNT(*) as invocation_count,
         AVG(duration_ms) as avg_duration_ms
       FROM usage_records
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY tool_type`

  const params = projectId ? [projectId, startDate, endDate] : [startDate, endDate]
  const rows = db.prepare(query).all(...params) as {
    tool_type: string
    total_input_tokens: number
    total_output_tokens: number
    total_tokens: number
    total_cost_usd: number
    invocation_count: number
    avg_duration_ms: number
  }[]

  return rows.map((row) => ({
    tool_type: row.tool_type as AIToolType,
    total_input_tokens: row.total_input_tokens || 0,
    total_output_tokens: row.total_output_tokens || 0,
    total_tokens: row.total_tokens || 0,
    total_cost_usd: row.total_cost_usd || 0,
    invocation_count: row.invocation_count,
    avg_duration_ms: Math.round(row.avg_duration_ms || 0)
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
  const db = getDb()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startOfDay = today.toISOString()

  const result = db
    .prepare(
      `SELECT
         SUM(total_tokens) as tokens,
         SUM(COALESCE(cost_usd, 0)) as cost
       FROM usage_records
       WHERE tool_type = ? AND created_at >= ?`
    )
    .get(toolType, startOfDay) as { tokens: number | null; cost: number | null }

  return {
    tokens: result.tokens || 0,
    cost: result.cost || 0
  }
}

/**
 * Get monthly usage for a tool type.
 */
export function getMonthlyUsage(toolType: AIToolType): { tokens: number; cost: number } {
  const db = getDb()
  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()

  const result = db
    .prepare(
      `SELECT
         SUM(total_tokens) as tokens,
         SUM(COALESCE(cost_usd, 0)) as cost
       FROM usage_records
       WHERE tool_type = ? AND created_at >= ?`
    )
    .get(toolType, startOfMonth) as { tokens: number | null; cost: number | null }

  return {
    tokens: result.tokens || 0,
    cost: result.cost || 0
  }
}

/**
 * Get total usage across all tools (for the header display).
 */
export function getTotalUsage(): { tokens: number; cost: number } {
  const db = getDb()
  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()

  const result = db
    .prepare(
      `SELECT
         SUM(total_tokens) as tokens,
         SUM(COALESCE(cost_usd, 0)) as cost
       FROM usage_records
       WHERE created_at >= ?`
    )
    .get(startOfMonth) as { tokens: number | null; cost: number | null }

  return {
    tokens: result.tokens || 0,
    cost: result.cost || 0
  }
}

// ============================================================================
// AI Tool Limits
// ============================================================================

interface LimitsDbRow {
  id: string
  tool_type: string
  daily_token_limit: number | null
  monthly_token_limit: number | null
  daily_cost_limit_usd: number | null
  monthly_cost_limit_usd: number | null
  updated_at: string
}

function rowToLimits(row: LimitsDbRow): AIToolLimits {
  return {
    tool_type: row.tool_type as AIToolType,
    daily_token_limit: row.daily_token_limit,
    monthly_token_limit: row.monthly_token_limit,
    daily_cost_limit_usd: row.daily_cost_limit_usd,
    monthly_cost_limit_usd: row.monthly_cost_limit_usd
  }
}

/**
 * Get limits for a specific tool.
 */
export function getToolLimits(toolType: AIToolType): AIToolLimits | null {
  const db = getDb()
  const row = db
    .prepare(`SELECT * FROM ai_tool_limits WHERE tool_type = ?`)
    .get(toolType) as LimitsDbRow | undefined

  if (!row) return null
  return rowToLimits(row)
}

/**
 * Get limits for all tools.
 */
export function getAllToolLimits(): AIToolLimits[] {
  const db = getDb()
  const rows = db.prepare(`SELECT * FROM ai_tool_limits`).all() as LimitsDbRow[]
  return rows.map(rowToLimits)
}

/**
 * Set limits for a tool.
 */
export function setToolLimits(
  toolType: AIToolType,
  limits: Partial<Omit<AIToolLimits, 'tool_type'>>
): AIToolLimits {
  const db = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO ai_tool_limits (id, tool_type, daily_token_limit, monthly_token_limit, daily_cost_limit_usd, monthly_cost_limit_usd, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tool_type) DO UPDATE SET
       daily_token_limit = COALESCE(excluded.daily_token_limit, daily_token_limit),
       monthly_token_limit = COALESCE(excluded.monthly_token_limit, monthly_token_limit),
       daily_cost_limit_usd = COALESCE(excluded.daily_cost_limit_usd, daily_cost_limit_usd),
       monthly_cost_limit_usd = COALESCE(excluded.monthly_cost_limit_usd, monthly_cost_limit_usd),
       updated_at = excluded.updated_at`
  ).run(
    id,
    toolType,
    limits.daily_token_limit ?? null,
    limits.monthly_token_limit ?? null,
    limits.daily_cost_limit_usd ?? null,
    limits.monthly_cost_limit_usd ?? null,
    now
  )

  return getToolLimits(toolType) || {
    tool_type: toolType,
    daily_token_limit: limits.daily_token_limit ?? null,
    monthly_token_limit: limits.monthly_token_limit ?? null,
    daily_cost_limit_usd: limits.daily_cost_limit_usd ?? null,
    monthly_cost_limit_usd: limits.monthly_cost_limit_usd ?? null
  }
}

/**
 * Get usage with limits for all tools (for display in dropdown).
 */
export function getUsageWithLimits(): UsageWithLimits[] {
  const db = getDb()

  // Get all tool types that have either usage or limits
  const toolTypes: AIToolType[] = ['claude', 'codex', 'other']
  const results: UsageWithLimits[] = []

  for (const toolType of toolTypes) {
    const daily = getDailyUsage(toolType)
    const monthly = getMonthlyUsage(toolType)
    const limits = getToolLimits(toolType)

    // Get all-time stats for this tool
    const stats = db
      .prepare(
        `SELECT
           SUM(input_tokens) as total_input_tokens,
           SUM(output_tokens) as total_output_tokens,
           SUM(total_tokens) as total_tokens,
           SUM(COALESCE(cost_usd, 0)) as total_cost_usd,
           COUNT(*) as invocation_count,
           AVG(duration_ms) as avg_duration_ms
         FROM usage_records
         WHERE tool_type = ?`
      )
      .get(toolType) as {
      total_input_tokens: number | null
      total_output_tokens: number | null
      total_tokens: number | null
      total_cost_usd: number | null
      invocation_count: number
      avg_duration_ms: number | null
    }

    // Only include tools that have usage or configured limits
    if (stats.invocation_count > 0 || limits) {
      results.push({
        tool_type: toolType,
        total_input_tokens: stats.total_input_tokens || 0,
        total_output_tokens: stats.total_output_tokens || 0,
        total_tokens: stats.total_tokens || 0,
        total_cost_usd: stats.total_cost_usd || 0,
        invocation_count: stats.invocation_count,
        avg_duration_ms: Math.round(stats.avg_duration_ms || 0),
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
  const db = getDb()
  const result = db
    .prepare(`DELETE FROM usage_records WHERE created_at < ?`)
    .run(beforeDate)
  return result.changes
}
