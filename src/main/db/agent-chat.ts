/**
 * Agent Chat Database Operations
 *
 * CRUD operations for agent chat messages during worker execution.
 */

import { generateId } from '@shared/utils'
import { getDb } from './connection'
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
  const db = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO agent_chat_messages (id, job_id, card_id, project_id, role, content, status, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    data.jobId,
    data.cardId,
    data.projectId,
    data.role,
    data.content,
    'sent',
    data.metadata ? JSON.stringify(data.metadata) : null,
    now
  )

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
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM agent_chat_messages WHERE id = ?')
  const row = stmt.get(messageId) as AgentChatMessage | undefined
  return row ?? null
}

/**
 * Get all chat messages for a job.
 */
export function getChatMessagesByJob(jobId: string, limit?: number): AgentChatMessage[] {
  const db = getDb()
  const sql = limit
    ? 'SELECT * FROM agent_chat_messages WHERE job_id = ? ORDER BY created_at ASC LIMIT ?'
    : 'SELECT * FROM agent_chat_messages WHERE job_id = ? ORDER BY created_at ASC'

  const stmt = db.prepare(sql)
  const rows = limit ? stmt.all(jobId, limit) : stmt.all(jobId)
  return rows as AgentChatMessage[]
}

/**
 * Get all chat messages for a card (across all jobs).
 */
export function getChatMessagesByCard(cardId: string, limit?: number): AgentChatMessage[] {
  const db = getDb()
  const sql = limit
    ? 'SELECT * FROM agent_chat_messages WHERE card_id = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM agent_chat_messages WHERE card_id = ? ORDER BY created_at DESC'

  const stmt = db.prepare(sql)
  const rows = limit ? stmt.all(cardId, limit) : stmt.all(cardId)
  return rows as AgentChatMessage[]
}

/**
 * Get all chat messages for a project.
 */
export function getChatMessagesByProject(projectId: string, limit?: number): AgentChatMessage[] {
  const db = getDb()
  const sql = limit
    ? 'SELECT * FROM agent_chat_messages WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM agent_chat_messages WHERE project_id = ? ORDER BY created_at DESC'

  const stmt = db.prepare(sql)
  const rows = limit ? stmt.all(projectId, limit) : stmt.all(projectId)
  return rows as AgentChatMessage[]
}

/**
 * Get recent messages for a job (for context building).
 */
export function getRecentChatContext(jobId: string, limit: number = 10): AgentChatMessage[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT * FROM agent_chat_messages
    WHERE job_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `)
  const rows = stmt.all(jobId, limit) as AgentChatMessage[]
  // Return in chronological order
  return rows.reverse()
}

/**
 * Get unread message count for a job.
 */
export function getUnreadCount(jobId: string): number {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM agent_chat_messages
    WHERE job_id = ? AND role = 'agent' AND status != 'read'
  `)
  const row = stmt.get(jobId) as { count: number }
  return row.count
}

/**
 * Get chat summary for a job.
 */
export function getChatSummary(jobId: string): AgentChatSummary {
  const db = getDb()

  const countStmt = db.prepare(`
    SELECT COUNT(*) as total FROM agent_chat_messages WHERE job_id = ?
  `)
  const countRow = countStmt.get(jobId) as { total: number }

  const unreadStmt = db.prepare(`
    SELECT COUNT(*) as unread
    FROM agent_chat_messages
    WHERE job_id = ? AND role = 'agent' AND status != 'read'
  `)
  const unreadRow = unreadStmt.get(jobId) as { unread: number }

  const lastMsgStmt = db.prepare(`
    SELECT created_at, content FROM agent_chat_messages
    WHERE job_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `)
  const lastMsg = lastMsgStmt.get(jobId) as { created_at: string; content: string } | undefined

  const lastAgentMsgStmt = db.prepare(`
    SELECT content FROM agent_chat_messages
    WHERE job_id = ? AND role = 'agent'
    ORDER BY created_at DESC
    LIMIT 1
  `)
  const lastAgentMsg = lastAgentMsgStmt.get(jobId) as { content: string } | undefined

  return {
    job_id: jobId,
    total_messages: countRow.total,
    unread_count: unreadRow.unread,
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
  const db = getDb()
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    UPDATE agent_chat_messages
    SET status = ?, updated_at = ?
    WHERE id = ?
  `)
  const result = stmt.run(status, now, messageId)
  return result.changes > 0
}

/**
 * Mark all agent messages as read for a job.
 */
export function markAllAsRead(jobId: string): number {
  const db = getDb()
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    UPDATE agent_chat_messages
    SET status = 'read', updated_at = ?
    WHERE job_id = ? AND role = 'agent' AND status != 'read'
  `)
  const result = stmt.run(now, jobId)
  return result.changes
}

/**
 * Update message content (for streaming updates).
 */
export function updateMessageContent(messageId: string, content: string): boolean {
  const db = getDb()
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    UPDATE agent_chat_messages
    SET content = ?, updated_at = ?
    WHERE id = ?
  `)
  const result = stmt.run(content, now, messageId)
  return result.changes > 0
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete a chat message.
 */
export function deleteChatMessage(messageId: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM agent_chat_messages WHERE id = ?')
  const result = stmt.run(messageId)
  return result.changes > 0
}

/**
 * Delete all chat messages for a job.
 */
export function deleteChatMessagesByJob(jobId: string): number {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM agent_chat_messages WHERE job_id = ?')
  const result = stmt.run(jobId)
  return result.changes
}

/**
 * Delete old chat messages (cleanup).
 */
export function deleteOldChatMessages(daysOld: number = 30): number {
  const db = getDb()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  const stmt = db.prepare(`
    DELETE FROM agent_chat_messages
    WHERE created_at < ?
  `)
  const result = stmt.run(cutoffDate.toISOString())
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
