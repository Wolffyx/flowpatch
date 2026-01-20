export type EventType =
  | 'status_changed'
  | 'synced'
  | 'worker_plan'
  | 'worker_run'
  | 'worker_log'
  | 'pr_created'
  | 'error'
  | 'card_created'
  | 'card_linked'
  | 'card_split'
  | 'task_decomposed'
  | 'e2e_tests_run'
  | 'plan_approval_requested'
  | 'plan_approved'
  | 'plan_rejected'
  | 'plan_skipped'
  | 'follow_up_instruction_added'
  | 'follow_up_instruction_applied'
  | 'follow_up_instruction_rejected'
  | 'card_updated'
  | 'card_deleted'
  | 'card_pushed_to_remote'

export interface Event {
  id: string
  project_id: string
  card_id: string | null
  type: EventType
  payload_json: string | null
  created_at: string
}
