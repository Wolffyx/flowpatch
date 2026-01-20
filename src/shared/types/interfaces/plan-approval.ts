export type PlanApprovalStatus = 'pending' | 'approved' | 'rejected' | 'skipped'

export interface PlanApproval {
  id: string
  job_id: string
  card_id: string
  project_id: string
  plan: string
  planning_mode: 'skip' | 'lite' | 'spec' | 'full'
  status: PlanApprovalStatus
  reviewer_notes?: string
  created_at: string
  reviewed_at?: string
}
