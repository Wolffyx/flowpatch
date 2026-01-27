import type { AppType } from './e2e-test'

export type CardStatus = 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'
export type Provider = 'github' | 'gitlab' | 'local' | 'auto'
export type CardType = 'issue' | 'pr' | 'draft' | 'mr' | 'local'

/**
 * Card-level E2E testing override configuration.
 * Allows individual cards to override project-wide E2E settings.
 */
export interface CardE2EOverride {
  /** Override project E2E enabled state for this card */
  enabled?: boolean
  /** Override app type for this card */
  appType?: AppType
  /** Override base URL for this card */
  baseUrl?: string
  /** Card-specific test command override */
  testCommand?: string
}

export interface Card {
  id: string
  project_id: string
  provider: Provider
  type: CardType
  title: string
  body: string | null
  status: CardStatus
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
  /** Card-specific metadata including E2E overrides (JSON stringified) */
  metadata_json?: string | null
}

export interface CardLink {
  id: string
  card_id: string
  linked_type: 'pr' | 'mr'
  linked_url: string
  linked_remote_repo_key: string | null
  linked_number_or_iid: string | null
  created_at: string
}
