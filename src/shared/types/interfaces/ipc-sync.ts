/**
 * IPC Sync Types
 *
 * Types for project synchronization operations.
 */

import type { Job } from './job'
import type { ProjectIdPayload } from './ipc-common'

// ============================================================================
// Project Sync
// ============================================================================

/**
 * Payload for syncing a project with remote.
 */
export type SyncProjectPayload = ProjectIdPayload

export interface SyncProjectResult {
  success: boolean
  error?: string
  job?: Job
}
