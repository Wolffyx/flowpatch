export type WorkerSlotStatus = 'idle' | 'running' | 'cleanup'

export interface WorkerPoolConfig {
  maxWorkers: number
  queueStrategy: 'fifo' | 'priority'
  priorityField?: string
}

export interface WorkerSlot {
  id: string
  project_id: string
  slot_number: number
  card_id: string | null
  job_id: string | null
  worktree_id: string | null
  status: WorkerSlotStatus
  started_at: string | null
  updated_at: string
}

export interface WorkerProgress {
  id: string
  card_id: string
  job_id: string | null
  iteration: number
  total_iterations: number
  subtask_index: number
  subtasks_completed: number
  files_modified_json: string | null
  context_summary: string | null
  progress_file_path: string | null
  last_checkpoint: string
  created_at: string
  updated_at: string
}
