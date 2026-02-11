/**
 * IPC Worker Types
 *
 * Types for worker operations: toggle, tool preference, rollback settings, and execution.
 */

import type { Project } from './project'
import type { Job } from './job'

// ============================================================================
// AI Tool Preference
// ============================================================================

/**
 * AI tool preference for worker operations.
 */
export type AIToolPreference = 'auto' | 'claude' | 'codex' | 'opencode'

// ============================================================================
// Worker Toggle
// ============================================================================

export interface ToggleWorkerPayload {
  projectId: string
  enabled: boolean
}

export interface ToggleWorkerResult {
  project: Project | null
}

// ============================================================================
// Worker Tool Preference
// ============================================================================

export interface SetWorkerToolPreferencePayload {
  projectId: string
  toolPreference: AIToolPreference
}

export interface SetWorkerToolPreferenceResult {
  success?: boolean
  project?: Project
  error?: string
}

// ============================================================================
// Worker Rollback on Cancel
// ============================================================================

export interface SetWorkerRollbackOnCancelPayload {
  projectId: string
  rollbackOnCancel: boolean
}

export interface SetWorkerRollbackOnCancelResult {
  success?: boolean
  project?: Project
  error?: string
}

// ============================================================================
// Worker Execution
// ============================================================================

export interface RunWorkerPayload {
  projectId: string
  cardId?: string
}

export interface RunWorkerResult {
  success?: boolean
  job?: Job
  error?: string
}

// ============================================================================
// Reset Worker State
// ============================================================================

export interface ResetWorkerStateResult {
  success: boolean
  canceledJobs: number
  releasedSlots: number
  deletedFailedJobs?: number
  error?: string
}
