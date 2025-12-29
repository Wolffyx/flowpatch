/// <reference types="vite/client" />

// Declare the projectAPI for Settings and other components
declare global {
  interface Window {
    projectAPI: {
      updateFeatureConfig: (
        featureKey: string,
        config: Record<string, unknown>
      ) => Promise<{
        success: boolean
        policy?: unknown
        errors?: string[]
        warnings?: string[]
      }>

      // Usage tracking
      getTotalUsage: () => Promise<{ usage: { tokens: number; cost: number } }>
      getUsageWithLimits: () => Promise<{
        usageWithLimits: {
          tool_type: string
          total_input_tokens: number
          total_output_tokens: number
          total_tokens: number
          total_cost_usd: number
          invocation_count: number
          avg_duration_ms: number
          limits: {
            tool_type: string
            daily_token_limit: number | null
            monthly_token_limit: number | null
            daily_cost_limit_usd: number | null
            monthly_cost_limit_usd: number | null
          } | null
          daily_tokens_used: number
          monthly_tokens_used: number
          daily_cost_used: number
          monthly_cost_used: number
        }[]
      }>

      // State updates
      onStateUpdate: (callback: () => void) => () => void
    }
  }
}

export {}
