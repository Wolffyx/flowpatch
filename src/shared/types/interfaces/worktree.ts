export type WorktreeStatus =
  | 'creating'
  | 'ready'
  | 'running'
  | 'cleanup_pending'
  | 'cleaned'
  | 'error'

export type WorktreeRoot = 'repo' | 'sibling' | 'custom'

export type WorktreeCleanupTiming = 'immediate' | 'delay' | 'never'

export interface Worktree {
  id: string
  project_id: string
  card_id: string
  job_id: string | null
  worktree_path: string
  branch_name: string
  base_ref: string
  status: WorktreeStatus
  last_error: string | null
  locked_by: string | null
  lock_expires_at: string | null
  cleanup_requested_at: string | null
  created_at: string
  updated_at: string
}
