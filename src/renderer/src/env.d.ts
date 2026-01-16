/// <reference types="vite/client" />

// Declare the projectAPI for Settings and other components
declare global {
  interface Window {
    projectAPI: {
      // Cards
      getCards: () => Promise<{
        id: string
        project_id: string
        provider: 'github' | 'gitlab' | 'local'
        type: 'issue' | 'pr' | 'mr' | 'draft'
        title: string
        body: string | null
        status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
        ready_eligible: number
        assignees_json: string | null
        labels_json: string | null
        remote_url: string | null
        remote_repo_key: string | null
        remote_number_or_iid: string | null
        remote_node_id: string | null
        updated_remote_at: string | null
        updated_local_at: string
        sync_state: 'ok' | 'pending' | 'error'
        last_error: string | null
        has_conflicts: number
      }[]>
      splitCard: (data: {
        cardId: string
        items: Array<{ title: string; body?: string }>
      }) => Promise<{
        cards?: { id: string }[]
        error?: string
      }>

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
            hourly_token_limit: number | null
            daily_token_limit: number | null
            monthly_token_limit: number | null
            hourly_cost_limit_usd: number | null
            daily_cost_limit_usd: number | null
            monthly_cost_limit_usd: number | null
          } | null
          hourly_tokens_used: number
          daily_tokens_used: number
          monthly_tokens_used: number
          hourly_cost_used: number
          daily_cost_used: number
          monthly_cost_used: number
        }[]
        resetTimes: {
          hourly_resets_in: number
          daily_resets_in: number
          monthly_resets_in: number
        }
      }>
      setToolLimits: (
        toolType: 'claude' | 'codex' | 'other',
        limits: {
          hourlyTokenLimit?: number | null
          dailyTokenLimit?: number | null
          monthlyTokenLimit?: number | null
          hourlyCostLimitUsd?: number | null
          dailyCostLimitUsd?: number | null
          monthlyCostLimitUsd?: number | null
        }
      ) => Promise<{
        success: boolean
        limits: {
          tool_type: string
          hourly_token_limit: number | null
          daily_token_limit: number | null
          monthly_token_limit: number | null
          hourly_cost_limit_usd: number | null
          daily_cost_limit_usd: number | null
          monthly_cost_limit_usd: number | null
        }
        error?: string
      }>

      // State updates
      onStateUpdate: (callback: () => void) => () => void

      // Jobs
      getJobs: () => Promise<{
        id: string
        project_id: string
        card_id: string | null
        type: string
        state: string
        lease_until: string | null
        attempts: number
        payload_json: string | null
        result_json: string | null
        last_error: string | null
        created_at: string
        updated_at: string
      }[]>

      // Diff viewer
      getDiffFiles: (worktreeId: string) => Promise<{
        files: {
          path: string
          status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
          additions: number
          deletions: number
          oldPath?: string
        }[]
        error?: string
      }>
      getDiffStats: (worktreeId: string) => Promise<{
        stats: {
          filesChanged: number
          additions: number
          deletions: number
        } | null
        error?: string
      }>
      getFileDiff: (worktreeId: string, filePath: string) => Promise<{
        diff: {
          filePath: string
          oldContent: string
          newContent: string
          status: 'added' | 'modified' | 'deleted' | 'renamed'
          additions: number
          deletions: number
        } | null
        error?: string
      }>
      getUnifiedDiff: (worktreeId: string, filePath?: string) => Promise<{
        patch: string
        error?: string
      }>

      // Agent Chat
      sendChatMessage: (params: {
        jobId: string
        cardId: string
        content: string
        metadata?: Record<string, unknown>
      }) => Promise<{
        message: {
          id: string
          job_id: string
          card_id: string
          project_id: string
          role: 'user' | 'agent' | 'system'
          content: string
          status: 'sent' | 'delivered' | 'read' | 'error'
          metadata_json?: string
          created_at: string
          updated_at?: string
        }
        error?: string
      }>
      getChatMessages: (jobId: string, limit?: number) => Promise<{
        messages: {
          id: string
          job_id: string
          card_id: string
          project_id: string
          role: 'user' | 'agent' | 'system'
          content: string
          status: 'sent' | 'delivered' | 'read' | 'error'
          metadata_json?: string
          created_at: string
          updated_at?: string
        }[]
        error?: string
      }>
      getChatMessagesByCard: (cardId: string, limit?: number) => Promise<{
        messages: {
          id: string
          job_id: string
          card_id: string
          project_id: string
          role: 'user' | 'agent' | 'system'
          content: string
          status: 'sent' | 'delivered' | 'read' | 'error'
          metadata_json?: string
          created_at: string
          updated_at?: string
        }[]
        error?: string
      }>
      getChatSummary: (jobId: string) => Promise<{
        summary: {
          job_id: string
          total_messages: number
          unread_count: number
          last_message_at?: string
          last_agent_message?: string
        }
        error?: string
      }>
      getChatUnreadCount: (jobId: string) => Promise<{
        count: number
        error?: string
      }>
      markChatAsRead: (jobId: string) => Promise<{
        success: boolean
        error?: string
      }>
      clearChatHistory: (jobId: string) => Promise<{
        success: boolean
        count: number
        error?: string
      }>
      onChatMessage: (callback: (data: {
        type: string
        message: {
          id: string
          job_id: string
          card_id: string
          project_id: string
          role: 'user' | 'agent' | 'system'
          content: string
          status: 'sent' | 'delivered' | 'read' | 'error'
          metadata_json?: string
          created_at: string
          updated_at?: string
        }
        jobId: string
      }) => void) => () => void

      // AI Profiles
      getAIProfiles: () => Promise<{
        profiles: {
          id: string
          project_id: string
          name: string
          description?: string
          is_default: boolean
          model_provider: 'anthropic' | 'openai' | 'auto'
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
        }[]
        error?: string
      }>
      getAIProfile: (profileId: string) => Promise<{
        profile: {
          id: string
          project_id: string
          name: string
          description?: string
          is_default: boolean
          model_provider: 'anthropic' | 'openai' | 'auto'
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
        } | null
        error?: string
      }>
      getDefaultAIProfile: () => Promise<{
        profile: {
          id: string
          project_id: string
          name: string
          description?: string
          is_default: boolean
          model_provider: 'anthropic' | 'openai' | 'auto'
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
        } | null
        error?: string
      }>
      createAIProfile: (data: {
        name: string
        description?: string
        isDefault?: boolean
        modelProvider?: 'anthropic' | 'openai' | 'auto'
        modelName?: string
        temperature?: number
        maxTokens?: number
        topP?: number
        systemPrompt?: string
        thinkingEnabled?: boolean
        thinkingMode?: 'none' | 'medium' | 'deep' | 'ultra'
        thinkingBudgetTokens?: number
        planningEnabled?: boolean
        planningMode?: 'skip' | 'lite' | 'spec' | 'full'
      }) => Promise<{
        profile: {
          id: string
          project_id: string
          name: string
          description?: string
          is_default: boolean
          model_provider: 'anthropic' | 'openai' | 'auto'
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
        } | null
        error?: string
      }>
      updateAIProfile: (profileId: string, data: {
        name?: string
        description?: string
        isDefault?: boolean
        modelProvider?: 'anthropic' | 'openai' | 'auto'
        modelName?: string | null
        temperature?: number | null
        maxTokens?: number | null
        topP?: number | null
        systemPrompt?: string | null
        thinkingEnabled?: boolean | null
        thinkingMode?: 'none' | 'medium' | 'deep' | 'ultra' | null
        thinkingBudgetTokens?: number | null
        planningEnabled?: boolean | null
        planningMode?: 'skip' | 'lite' | 'spec' | 'full' | null
      }) => Promise<{
        profile: {
          id: string
          project_id: string
          name: string
          description?: string
          is_default: boolean
          model_provider: 'anthropic' | 'openai' | 'auto'
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
        } | null
        error?: string
      }>
      deleteAIProfile: (profileId: string) => Promise<{
        success: boolean
        error?: string
      }>
      setDefaultAIProfile: (profileId: string) => Promise<{
        success: boolean
        error?: string
      }>
      duplicateAIProfile: (profileId: string, newName: string) => Promise<{
        profile: {
          id: string
          project_id: string
          name: string
          description?: string
          is_default: boolean
          model_provider: 'anthropic' | 'openai' | 'auto'
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
        } | null
        error?: string
      }>

      // Feature Suggestions
      getFeatureSuggestions: (options?: {
        status?: 'open' | 'in_progress' | 'completed' | 'rejected'
        category?: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
        sortBy?: 'vote_count' | 'created_at' | 'priority' | 'updated_at'
        sortOrder?: 'asc' | 'desc'
        limit?: number
        offset?: number
      }) => Promise<{
        suggestions: {
          id: string
          project_id: string
          title: string
          description: string
          category: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
          priority: number
          vote_count: number
          status: 'open' | 'in_progress' | 'completed' | 'rejected'
          created_by?: string
          created_at: string
          updated_at: string
        }[]
        error?: string
      }>
      getFeatureSuggestion: (suggestionId: string) => Promise<{
        suggestion: {
          id: string
          project_id: string
          title: string
          description: string
          category: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
          priority: number
          vote_count: number
          status: 'open' | 'in_progress' | 'completed' | 'rejected'
          created_by?: string
          created_at: string
          updated_at: string
        } | null
        error?: string
      }>
      createFeatureSuggestion: (data: {
        title: string
        description: string
        category?: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
        priority?: number
        createdBy?: string
      }) => Promise<{
        suggestion: {
          id: string
          project_id: string
          title: string
          description: string
          category: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
          priority: number
          vote_count: number
          status: 'open' | 'in_progress' | 'completed' | 'rejected'
          created_by?: string
          created_at: string
          updated_at: string
        } | null
        error?: string
      }>
      updateFeatureSuggestion: (suggestionId: string, data: {
        title?: string
        description?: string
        category?: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
        priority?: number
        status?: 'open' | 'in_progress' | 'completed' | 'rejected'
      }) => Promise<{
        suggestion: {
          id: string
          project_id: string
          title: string
          description: string
          category: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
          priority: number
          vote_count: number
          status: 'open' | 'in_progress' | 'completed' | 'rejected'
          created_by?: string
          created_at: string
          updated_at: string
        } | null
        error?: string
      }>
      updateFeatureSuggestionStatus: (suggestionId: string, status: 'open' | 'in_progress' | 'completed' | 'rejected') => Promise<{
        success: boolean
        error?: string
      }>
      deleteFeatureSuggestion: (suggestionId: string) => Promise<{
        success: boolean
        error?: string
      }>
      voteOnSuggestion: (suggestionId: string, voteType: 'up' | 'down', voterId?: string) => Promise<{
        voteCount: number
        userVote: 'up' | 'down' | null
        error?: string
      }>
      getUserVote: (suggestionId: string, voterId?: string) => Promise<{
        voteType: 'up' | 'down' | null
        error?: string
      }>

      // Card Dependencies
      createDependency: (data: {
        cardId: string
        dependsOnCardId: string
        blockingStatuses?: ('draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done')[]
        requiredStatus?: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
      }) => Promise<{
        dependency: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: ('draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done')[]
          required_status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          is_active: number
          created_at: string
          updated_at: string
        } | null
        error?: string
      }>
      getDependency: (dependencyId: string) => Promise<{
        dependency: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: ('draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done')[]
          required_status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          is_active: number
          created_at: string
          updated_at: string
        } | null
        error?: string
      }>
      getDependenciesForCard: (cardId: string) => Promise<{
        dependencies: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: ('draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done')[]
          required_status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          is_active: number
          created_at: string
          updated_at: string
        }[]
        error?: string
      }>
      getDependenciesForCardWithCards: (cardId: string) => Promise<{
        dependencies: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: ('draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done')[]
          required_status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          is_active: number
          created_at: string
          updated_at: string
          depends_on_card?: {
            id: string
            project_id: string
            title: string
            status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          }
        }[]
        error?: string
      }>
      getDependentsOfCard: (cardId: string) => Promise<{
        dependencies: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: ('draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done')[]
          required_status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          is_active: number
          created_at: string
          updated_at: string
          card?: {
            id: string
            project_id: string
            title: string
            status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          }
        }[]
        error?: string
      }>
      getDependenciesByProject: () => Promise<{
        dependencies: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: ('draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done')[]
          required_status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          is_active: number
          created_at: string
          updated_at: string
        }[]
        error?: string
      }>
      countDependenciesForCard: (cardId: string) => Promise<{
        count: number
        dependentsCount: number
        error?: string
      }>
      checkCanMoveToStatus: (cardId: string, targetStatus: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done') => Promise<{
        canMove: boolean
        blockedBy: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: ('draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done')[]
          required_status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          is_active: number
          created_at: string
          updated_at: string
          depends_on_card?: {
            id: string
            project_id: string
            title: string
            status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          }
        }[]
        reason?: string
      }>
      checkWouldCreateCycle: (cardId: string, dependsOnCardId: string) => Promise<{
        wouldCreateCycle: boolean
        error?: string
      }>
      updateDependency: (dependencyId: string, data: {
        blockingStatuses?: ('draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done')[]
        requiredStatus?: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
        isActive?: boolean
      }) => Promise<{
        dependency: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: ('draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done')[]
          required_status: 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
          is_active: number
          created_at: string
          updated_at: string
        } | null
        error?: string
      }>
      toggleDependency: (dependencyId: string, isActive: boolean) => Promise<{
        success: boolean
        error?: string
      }>
      deleteDependency: (dependencyId: string) => Promise<{
        success: boolean
        error?: string
      }>
      deleteDependencyBetween: (cardId: string, dependsOnCardId: string) => Promise<{
        success: boolean
        error?: string
      }>

      // FlowPatch workspace
      createPlanFile: () => Promise<{
        success: boolean
        created?: boolean
        path?: string
        error?: string
        message?: string
      }>
    }

    electron: {
      ipcRenderer: {
        invoke: <T = any>(channel: string, ...args: unknown[]) => Promise<T>
        send: (channel: string, ...args: unknown[]) => void
        on: (channel: string, callback: (...args: any[]) => void) => void
        removeListener: (channel: string, callback: (...args: any[]) => void) => void
      }
    }
  }
}

export {}
