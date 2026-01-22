/**
 * IPC Worktree Types
 *
 * Types for git worktree operations: listing, removing, recreating, and cleanup.
 */

// ============================================================================
// Worktree Listing
// ============================================================================

/**
 * Payload for listing worktrees by project ID.
 * Using string directly as the payload is just the projectId.
 */
export type ListWorktreesPayload = string

// ============================================================================
// Worktree Retrieval
// ============================================================================

/**
 * Payload for getting a single worktree by ID.
 * Using string directly as the payload is just the worktreeId.
 */
export type GetWorktreePayload = string

// ============================================================================
// Worktree Removal
// ============================================================================

/**
 * Payload for removing a worktree.
 * Using string directly as the payload is just the worktreeId.
 */
export type RemoveWorktreePayload = string

export interface RemoveWorktreeResult {
  success?: boolean
  error?: string
}

// ============================================================================
// Worktree Recreation
// ============================================================================

/**
 * Payload for recreating a worktree.
 * Using string directly as the payload is just the worktreeId.
 */
export type RecreateWorktreePayload = string

export interface RecreateWorktreeResult {
  success?: boolean
  error?: string
}

// ============================================================================
// Worktree Folder Opening
// ============================================================================

/**
 * Payload for opening a worktree folder in file explorer.
 * Using string directly as the payload is just the worktree path.
 */
export type OpenWorktreeFolderPayload = string

export interface OpenWorktreeFolderResult {
  success: boolean
}

// ============================================================================
// Stale Worktree Cleanup
// ============================================================================

/**
 * Payload for cleaning up stale worktrees in a project.
 * Using string directly as the payload is just the projectId.
 */
export type CleanupStaleWorktreesPayload = string

export interface CleanupStaleWorktreesResult {
  success?: boolean
  result?: unknown
  error?: string
}
