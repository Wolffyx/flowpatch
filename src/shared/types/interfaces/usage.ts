export type AIToolType = 'claude' | 'codex' | 'opencode' | 'cursor' | 'other'

export interface UsageRecord {
  id: string
  project_id: string
  job_id: string | null
  card_id: string | null
  tool_type: AIToolType
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number | null
  duration_ms: number
  model: string | null
  created_at: string
}

export interface UsageStats {
  tool_type: AIToolType
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost_usd: number
  invocation_count: number
  avg_duration_ms: number
}

export interface UsageSummary {
  total_tokens: number
  total_cost_usd: number
  by_tool: UsageStats[]
  period_start: string
  period_end: string
}

export interface AIToolLimits {
  tool_type: AIToolType
  hourly_token_limit: number | null
  daily_token_limit: number | null
  monthly_token_limit: number | null
  hourly_cost_limit_usd: number | null
  daily_cost_limit_usd: number | null
  monthly_cost_limit_usd: number | null
}

export interface UsageWithLimits extends UsageStats {
  limits: AIToolLimits | null
  hourly_tokens_used: number
  daily_tokens_used: number
  monthly_tokens_used: number
  hourly_cost_used: number
  daily_cost_used: number
  monthly_cost_used: number
}

export interface UsageResetTimes {
  hourly_resets_in: number
  daily_resets_in: number
  monthly_resets_in: number
}

export interface UsageWithLimitsResponse {
  usageWithLimits: UsageWithLimits[]
  resetTimes: UsageResetTimes
}
