export type SubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface Subtask {
  id: string
  parent_card_id: string
  project_id: string
  title: string
  description: string | null
  estimated_minutes: number | null
  sequence: number
  status: SubtaskStatus
  remote_issue_number: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}
