export type AIModelProvider = 'anthropic' | 'openai' | 'auto'

export interface AIProfile {
  id: string
  project_id: string
  name: string
  description?: string
  is_default: boolean
  model_provider: AIModelProvider
  model_name?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  system_prompt?: string
  thinking_enabled?: boolean
  thinking_mode?: 'none' | 'medium' | 'deep' | 'ultra'
  thinking_budget_tokens?: number
  planning_enabled?: boolean
  planning_mode?: 'skip' | 'lite' | 'spec' | 'full'
  created_at: string
  updated_at: string
}
