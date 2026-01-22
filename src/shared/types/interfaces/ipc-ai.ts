/**
 * IPC AI Types
 *
 * Types for AI-powered operations: card description generation, card list generation, and card splitting.
 */

import type { AIToolPreference } from './ipc-worker'

// ============================================================================
// Card Description Generation
// ============================================================================

export interface GenerateCardDescriptionPayload {
  projectId: string
  title: string
  toolPreference?: AIToolPreference
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface GenerateCardDescriptionResult {
  success?: boolean
  toolUsed?: 'claude' | 'codex'
  response?: string
  error?: string
}

// ============================================================================
// Card List Generation
// ============================================================================

export interface GenerateCardListPayload {
  projectId: string
  description: string
  count: number
  toolPreference?: AIToolPreference
}

export interface GenerateCardListResult {
  success?: boolean
  toolUsed?: 'claude' | 'codex'
  cards?: Array<{ title: string; body: string }>
  error?: string
}

// ============================================================================
// Card Split Generation
// ============================================================================

export interface GenerateSplitCardsPayload {
  projectId: string
  cardId: string
  count: number
  toolPreference?: AIToolPreference
  guidance?: string
}

export interface GenerateSplitCardsResult {
  success?: boolean
  toolUsed?: 'claude' | 'codex'
  cards?: Array<{ title: string; body: string }>
  error?: string
}
