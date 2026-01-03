/**
 * Agent Chat Database Operations
 *
 * CRUD operations for agent chat messages during worker execution.
 */

import { and, asc, count, desc, eq, lt, ne } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { agentChatMessages } from './schema'
import { generateId } from '@shared/utils'
import type {
  AgentChatMessage,
  AgentChatRole,
  AgentChatMessageStatus,
  AgentChatSummary
} from '@shared/types'

// ============================================================================
// Create Operations
// ============================================================================

/**
 * Create a new chat message.
 */
export function createChatMessage(data: {
  jobId: string
  cardId: string
  projectId: string
  role: AgentChatRole
  content: string
  metadata?: Record<string, unknown>
}): AgentChatMessage {
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

  db.insert(agentChatMessages)
    .values({
      id,
      job_id: data.jobId,
      card_id: data.cardId,
      project_id: data.projectId,
      role: data.role,
      content: data.content,
      status: 'sent',
      metadata_json: data.metadata ? JSON.stringify(data.metadata) : null,
      created_at: now
    })
    .run()

  return {
    id,
    job_id: data.jobId,
    card_id: data.cardId,
    project_id: data.projectId,
    role: data.role,
    content: data.content,
    status: 'sent',
    metadata_json: data.metadata ? JSON.stringify(data.metadata) : undefined,
    created_at: now
  }
}

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Get a chat message by ID.
 */
export function getChatMessage(messageId: string): AgentChatMessage | null {
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(agentChatMessages)
      .where(eq(agentChatMessages.id, messageId))
      .get() as AgentChatMessage) ?? null
  )
}

/**
 * Get all chat messages for a job.
 */
export function getChatMessagesByJob(jobId: string, limit?: number): AgentChatMessage[] {
  const db = getDrizzle()
  let query = db
    .select()
    .from(agentChatMessages)
    .where(eq(agentChatMessages.job_id, jobId))
    .orderBy(asc(agentChatMessages.created_at))

  if (limit) {
    query = query.limit(limit) as typeof query
  }

  return query.all() as AgentChatMessage[]
}

/**
 * Get all chat messages for a card (across all jobs).
 */
export function getChatMessagesByCard(cardId: string, limit?: number): AgentChatMessage[] {
  const db = getDrizzle()
  let query = db
    .select()
    .from(agentChatMessages)
    .where(eq(agentChatMessages.card_id, cardId))
    .orderBy(desc(agentChatMessages.created_at))

  if (limit) {
    query = query.limit(limit) as typeof query
  }

  return query.all() as AgentChatMessage[]
}

/**
 * Get all chat messages for a project.
 */
export function getChatMessagesByProject(projectId: string, limit?: number): AgentChatMessage[] {
  const db = getDrizzle()
  let query = db
    .select()
    .from(agentChatMessages)
    .where(eq(agentChatMessages.project_id, projectId))
    .orderBy(desc(agentChatMessages.created_at))

  if (limit) {
    query = query.limit(limit) as typeof query
  }

  return query.all() as AgentChatMessage[]
}

/**
 * Get recent messages for a job (for context building).
 */
export function getRecentChatContext(jobId: string, limit: number = 10): AgentChatMessage[] {
  const db = getDrizzle()
  const rows = db
    .select()
    .from(agentChatMessages)
    .where(eq(agentChatMessages.job_id, jobId))
    .orderBy(desc(agentChatMessages.created_at))
    .limit(limit)
    .all() as AgentChatMessage[]
  // Return in chronological order
  return rows.reverse()
}

/**
 * Get unread message count for a job.
 */
export function getUnreadCount(jobId: string): number {
  const db = getDrizzle()
  const result = db
    .select({ count: count() })
    .from(agentChatMessages)
    .where(
      and(
        eq(agentChatMessages.job_id, jobId),
        eq(agentChatMessages.role, 'agent'),
        ne(agentChatMessages.status, 'read')
      )
    )
    .get()
  return result?.count ?? 0
}

/**
 * Get chat summary for a job.
 */
export function getChatSummary(jobId: string): AgentChatSummary {
  const db = getDrizzle()

  const totalResult = db
    .select({ total: count() })
    .from(agentChatMessages)
    .where(eq(agentChatMessages.job_id, jobId))
    .get()

  const unreadResult = db
    .select({ unread: count() })
    .from(agentChatMessages)
    .where(
      and(
        eq(agentChatMessages.job_id, jobId),
        eq(agentChatMessages.role, 'agent'),
        ne(agentChatMessages.status, 'read')
      )
    )
    .get()

  const lastMsg = db
    .select({
      created_at: agentChatMessages.created_at,
      content: agentChatMessages.content
    })
    .from(agentChatMessages)
    .where(eq(agentChatMessages.job_id, jobId))
    .orderBy(desc(agentChatMessages.created_at))
    .limit(1)
    .get()

  const lastAgentMsg = db
    .select({ content: agentChatMessages.content })
    .from(agentChatMessages)
    .where(and(eq(agentChatMessages.job_id, jobId), eq(agentChatMessages.role, 'agent')))
    .orderBy(desc(agentChatMessages.created_at))
    .limit(1)
    .get()

  return {
    job_id: jobId,
    total_messages: totalResult?.total ?? 0,
    unread_count: unreadResult?.unread ?? 0,
    last_message_at: lastMsg?.created_at,
    last_agent_message: lastAgentMsg?.content
  }
}

// ============================================================================
// Update Operations
// ============================================================================

/**
 * Update message status.
 */
export function updateMessageStatus(messageId: string, status: AgentChatMessageStatus): boolean {
  const db = getDrizzle()
  const now = new Date().toISOString()
  const result = db
    .update(agentChatMessages)
    .set({ status, updated_at: now })
    .where(eq(agentChatMessages.id, messageId))
    .run()
  return result.changes > 0
}

/**
 * Mark all agent messages as read for a job.
 */
export function markAllAsRead(jobId: string): number {
  const db = getDrizzle()
  const now = new Date().toISOString()
  const result = db
    .update(agentChatMessages)
    .set({ status: 'read', updated_at: now })
    .where(
      and(
        eq(agentChatMessages.job_id, jobId),
        eq(agentChatMessages.role, 'agent'),
        ne(agentChatMessages.status, 'read')
      )
    )
    .run()
  return result.changes
}

/**
 * Update message content (for streaming updates).
 */
export function updateMessageContent(messageId: string, content: string): boolean {
  const db = getDrizzle()
  const now = new Date().toISOString()
  const result = db
    .update(agentChatMessages)
    .set({ content, updated_at: now })
    .where(eq(agentChatMessages.id, messageId))
    .run()
  return result.changes > 0
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete a chat message.
 */
export function deleteChatMessage(messageId: string): boolean {
  const db = getDrizzle()
  const result = db
    .delete(agentChatMessages)
    .where(eq(agentChatMessages.id, messageId))
    .run()
  return result.changes > 0
}

/**
 * Delete all chat messages for a job.
 */
export function deleteChatMessagesByJob(jobId: string): number {
  const db = getDrizzle()
  const result = db
    .delete(agentChatMessages)
    .where(eq(agentChatMessages.job_id, jobId))
    .run()
  return result.changes
}

/**
 * Delete old chat messages (cleanup).
 */
export function deleteOldChatMessages(daysOld: number = 30): number {
  const db = getDrizzle()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  const result = db
    .delete(agentChatMessages)
    .where(lt(agentChatMessages.created_at, cutoffDate.toISOString()))
    .run()
  return result.changes
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Build chat context string for AI prompt inclusion.
 */
export function buildChatContextForPrompt(jobId: string, maxMessages: number = 5): string {
  const messages = getRecentChatContext(jobId, maxMessages)
  if (messages.length === 0) return ''

  const lines = messages.map((msg) => {
    const role = msg.role === 'user' ? 'User' : msg.role === 'agent' ? 'Assistant' : 'System'
    return `${role}: ${msg.content}`
  })

  return `\n<recent_chat_context>\n${lines.join('\n')}\n</recent_chat_context>\n`
}
