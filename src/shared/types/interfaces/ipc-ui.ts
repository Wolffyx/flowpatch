/**
 * IPC UI Types
 *
 * Types for UI-related settings and preferences.
 */

import type { Project } from './project'

// ============================================================================
// Pull Requests Section Visibility
// ============================================================================

export interface SetShowPullRequestsSectionPayload {
  projectId: string
  showPullRequestsSection: boolean
}

export interface SetShowPullRequestsSectionResult {
  success?: boolean
  project?: Project
  error?: string
}
