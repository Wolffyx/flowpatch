/**
 * IPC Card Types
 *
 * Types for card operations: creation, movement, splitting, and remote syncing.
 */

import type { Card, CardStatus } from './card'
import type { CardIdPayload } from './ipc-common'

// ============================================================================
// Test Card Creation
// ============================================================================

export interface CreateTestCardPayload {
  projectId: string
  title: string
}

export interface CreateTestCardResult {
  card: Card
}

// ============================================================================
// Card Creation
// ============================================================================

export interface CreateCardPayload {
  projectId: string
  title: string
  body?: string
  createType: 'local' | 'repo_issue' | 'github_issue' | 'gitlab_issue'
}

export interface CreateCardResult {
  card?: Card
  issueNumber?: number
  url?: string
  error?: string
}

// ============================================================================
// Card Movement
// ============================================================================

export interface MoveCardPayload {
  cardId: string
  status: CardStatus
}

export interface MoveCardResult {
  card: Card | null
}

// ============================================================================
// Card Splitting
// ============================================================================

export interface SplitCardPayload {
  cardId: string
  items: Array<{ title: string; body?: string }>
}

export interface SplitCardResult {
  cards?: Card[]
  error?: string
}

// ============================================================================
// Remote Card Push
// ============================================================================

/**
 * Payload for pushing a local card to remote (GitHub/GitLab).
 */
export type PushCardToRemotePayload = CardIdPayload

export interface PushCardToRemoteResult {
  card?: Card
  issueNumber?: number
  url?: string
  error?: string
}
