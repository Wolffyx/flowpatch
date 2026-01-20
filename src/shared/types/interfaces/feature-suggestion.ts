export type FeatureSuggestionStatus = 'open' | 'in_progress' | 'completed' | 'rejected'
export type FeatureSuggestionCategory =
  | 'ui'
  | 'performance'
  | 'feature'
  | 'bug'
  | 'documentation'
  | 'other'

export interface FeatureSuggestion {
  id: string
  project_id: string
  title: string
  description: string
  category: FeatureSuggestionCategory
  priority: number
  vote_count: number
  status: FeatureSuggestionStatus
  created_by?: string
  created_at: string
  updated_at: string
}

export interface FeatureSuggestionVote {
  id: string
  suggestion_id: string
  voter_id?: string
  vote_type: 'up' | 'down'
  created_at: string
}
