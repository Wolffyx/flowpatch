export type AgentChatRole = 'user' | 'agent' | 'system'
export type AgentChatMessageStatus = 'sent' | 'delivered' | 'read' | 'error'

export interface AgentChatMessage {
  id: string
  job_id: string
  card_id: string
  project_id: string
  role: AgentChatRole
  content: string
  status: AgentChatMessageStatus
  metadata_json?: string
  created_at: string
  updated_at?: string
}

export interface AgentChatSummary {
  job_id: string
  total_messages: number
  unread_count: number
  last_message_at?: string
  last_agent_message?: string
}
