/**
 * IPC Common Types
 *
 * Shared result types and generic payload patterns used across IPC operations.
 */

import type { Project } from './project'
import type { Card, CardLink } from './card'
import type { Event } from './event'
import type { Job } from './job'

// ============================================================================
// Result Types
// ============================================================================

/**
 * Successful operation result.
 */
export interface SuccessResult {
  success: true
}

/**
 * Failed operation result with error message.
 */
export interface ErrorResult {
  error: string
}

/**
 * Generic result wrapper for IPC operations.
 * Returns either success with optional data or error with message.
 */
export type Result<T = void> = (T extends void ? SuccessResult : SuccessResult & T) | ErrorResult

// ============================================================================
// App State Types
// ============================================================================

/**
 * Project data bundle including all related entities.
 */
export interface ProjectData {
  project: Project
  cards: Card[]
  cardLinks: CardLink[]
  events: Event[]
  jobs: Job[]
}

/**
 * Complete application state with all projects.
 */
export interface AppState {
  projects: ProjectData[]
}

// ============================================================================
// Generic Payload Types
// ============================================================================

/**
 * Generic payload with project ID.
 * Used by operations that only need a projectId parameter.
 */
export interface ProjectIdPayload {
  projectId: string
}

/**
 * Generic payload with card ID.
 * Used by operations that only need a cardId parameter.
 */
export interface CardIdPayload {
  cardId: string
}

/**
 * Generic payload with worktree ID.
 * Used by operations that only need a worktreeId parameter.
 */
export interface WorktreeIdPayload {
  worktreeId: string
}
