export type FollowUpInstructionStatus = 'pending' | 'processing' | 'applied' | 'rejected'
export type FollowUpInstructionType = 'revision' | 'clarification' | 'additional' | 'abort'

export interface FollowUpInstruction {
  id: string
  job_id: string
  card_id: string
  project_id: string
  instruction_type: FollowUpInstructionType
  content: string
  status: FollowUpInstructionStatus
  priority: number
  created_at: string
  processed_at?: string
}
