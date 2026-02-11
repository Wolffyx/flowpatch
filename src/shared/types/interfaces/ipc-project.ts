/**
 * IPC Project Types
 *
 * Types for project operations: fetching, deleting, unlinking, and policy updates.
 */

import type { Project } from './project'
import type { PolicyConfig } from './policy-config'
import type { ProjectIdPayload } from './ipc-common'

// ============================================================================
// Project Retrieval
// ============================================================================

/**
 * Payload for getting a single project by ID.
 */
export type GetProjectPayload = ProjectIdPayload

// ============================================================================
// Project Deletion
// ============================================================================

/**
 * Payload for deleting a project.
 */
export type DeleteProjectPayload = ProjectIdPayload

export interface DeleteProjectResult {
  success: boolean
}

// ============================================================================
// Project Unlinking
// ============================================================================

/**
 * Payload for unlinking a project from remote.
 */
export type UnlinkProjectPayload = ProjectIdPayload

export interface UnlinkProjectResult {
  success?: boolean
  error?: string
}

// ============================================================================
// Project Policy Updates
// ============================================================================

export interface UpdateProjectPolicyPayload {
  projectId: string
  policy: Partial<PolicyConfig>
}

export interface UpdateProjectPolicyResult {
  success?: boolean
  project?: Project
  error?: string
}
