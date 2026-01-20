/**
 * Agent Chat Database Operations
 *
 * Supports both central database (legacy) and project-local database.
 * CRUD operations for agent chat messages during worker execution.
 */

import { and, asc, count, desc, eq, lt, ne } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { agentChatMessages } from './schema'
import { agentChatMessages as projectAgentChatMessages } from './schema/project'
import { generateId } from '@shared/utils'
import type {
  AgentChatMessage,
  AgentChatRole,
  AgentChatMessageStatus,
  AgentChatSummary
} from '@shared/types'
import { resolveProjectDb } from './db-resolver'

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
  const { db, isLocalDb } = resolveProjectDb(data.projectId)
  const id = generateId()
  const now = new Date().toISOString()

  if (isLocalDb) {
    db.insert(projectAgentChatMessages)
      .values({
        id,
        job_id: data.jobId,
        card_id: data.cardId,
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
 * @param messageId - The message ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getChatMessage(messageId: string, projectId?: string): AgentChatMessage | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectAgentChatMessages)
        .where(eq(projectAgentChatMessages.id, messageId))
        .get()
      return row ? ({ ...row, project_id: projectId } as AgentChatMessage) : null
    }
  }

  // Central DB fallback
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
 * @param jobId - The job ID
 * @param limit - Optional limit
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getChatMessagesByJob(
  jobId: string,
  limit?: number,
  projectId?: string
): AgentChatMessage[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      let query = db
        .select()
        .from(projectAgentChatMessages)
        .where(eq(projectAgentChatMessages.job_id, jobId))
        .orderBy(asc(projectAgentChatMessages.created_at))

      if (limit) {
        query = query.limit(limit) as typeof query
      }

      const rows = query.all()
      return rows.map((r) => ({ ...r, project_id: projectId })) as AgentChatMessage[]
    }
  }

  // Central DB fallback
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
 * @param cardId - The card ID
 * @param limit - Optional limit
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getChatMessagesByCard(
  cardId: string,
  limit?: number,
  projectId?: string
): AgentChatMessage[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      let query = db
        .select()
        .from(projectAgentChatMessages)
        .where(eq(projectAgentChatMessages.card_id, cardId))
        .orderBy(desc(projectAgentChatMessages.created_at))

      if (limit) {
        query = query.limit(limit) as typeof query
      }

      const rows = query.all()
      return rows.map((r) => ({ ...r, project_id: projectId })) as AgentChatMessage[]
    }
  }

  // Central DB fallback
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
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    let query = db
      .select()
      .from(projectAgentChatMessages)
      .orderBy(desc(projectAgentChatMessages.created_at))

    if (limit) {
      query = query.limit(limit) as typeof query
    }

    const rows = query.all()
    return rows.map((r) => ({ ...r, project_id: projectId })) as AgentChatMessage[]
  }

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
 * @param jobId - The job ID
 * @param limit - Number of messages to retrieve
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getRecentChatContext(
  jobId: string,
  limit: number = 10,
  projectId?: string
): AgentChatMessage[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectAgentChatMessages)
        .where(eq(projectAgentChatMessages.job_id, jobId))
        .orderBy(desc(projectAgentChatMessages.created_at))
        .limit(limit)
        .all()
      // Return in chronological order
      return rows.reverse().map((r) => ({ ...r, project_id: projectId })) as AgentChatMessage[]
    }
  }

  // Central DB fallback
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
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getUnreadCount(jobId: string, projectId?: string): number {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .select({ count: count() })
        .from(projectAgentChatMessages)
        .where(
          and(
            eq(projectAgentChatMessages.job_id, jobId),
            eq(projectAgentChatMessages.role, 'agent'),
            ne(projectAgentChatMessages.status, 'read')
          )
        )
        .get()
      return result?.count ?? 0
    }
  }

  // Central DB fallback
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
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getChatSummary(jobId: string, projectId?: string): AgentChatSummary {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const totalResult = db
        .select({ total: count() })
        .from(projectAgentChatMessages)
        .where(eq(projectAgentChatMessages.job_id, jobId))
        .get()

      const unreadResult = db
        .select({ unread: count() })
        .from(projectAgentChatMessages)
        .where(
          and(
            eq(projectAgentChatMessages.job_id, jobId),
            eq(projectAgentChatMessages.role, 'agent'),
            ne(projectAgentChatMessages.status, 'read')
          )
        )
        .get()

      const lastMsg = db
        .select({
          created_at: projectAgentChatMessages.created_at,
          content: projectAgentChatMessages.content
        })
        .from(projectAgentChatMessages)
        .where(eq(projectAgentChatMessages.job_id, jobId))
        .orderBy(desc(projectAgentChatMessages.created_at))
        .limit(1)
        .get()

      const lastAgentMsg = db
        .select({ content: projectAgentChatMessages.content })
        .from(projectAgentChatMessages)
        .where(
          and(
            eq(projectAgentChatMessages.job_id, jobId),
            eq(projectAgentChatMessages.role, 'agent')
          )
        )
        .orderBy(desc(projectAgentChatMessages.created_at))
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
  }

  // Central DB fallback
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
 * @param messageId - The message ID
 * @param status - The new status
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateMessageStatus(
  messageId: string,
  status: AgentChatMessageStatus,
  projectId?: string
): boolean {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .update(projectAgentChatMessages)
        .set({ status, updated_at: now })
        .where(eq(projectAgentChatMessages.id, messageId))
        .run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db
    .update(agentChatMessages)
    .set({ status, updated_at: now })
    .where(eq(agentChatMessages.id, messageId))
    .run()
  return result.changes > 0
}

/**
 * Mark all agent messages as read for a job.
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function markAllAsRead(jobId: string, projectId?: string): number {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .update(projectAgentChatMessages)
        .set({ status: 'read', updated_at: now })
        .where(
          and(
            eq(projectAgentChatMessages.job_id, jobId),
            eq(projectAgentChatMessages.role, 'agent'),
            ne(projectAgentChatMessages.status, 'read')
          )
        )
        .run()
      return result.changes
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * @param messageId - The message ID
 * @param content - The new content
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateMessageContent(
  messageId: string,
  content: string,
  projectId?: string
): boolean {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .update(projectAgentChatMessages)
        .set({ content, updated_at: now })
        .where(eq(projectAgentChatMessages.id, messageId))
        .run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * @param messageId - The message ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteChatMessage(messageId: string, projectId?: string): boolean {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .delete(projectAgentChatMessages)
        .where(eq(projectAgentChatMessages.id, messageId))
        .run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db.delete(agentChatMessages).where(eq(agentChatMessages.id, messageId)).run()
  return result.changes > 0
}

/**
 * Delete all chat messages for a job.
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteChatMessagesByJob(jobId: string, projectId?: string): number {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .delete(projectAgentChatMessages)
        .where(eq(projectAgentChatMessages.job_id, jobId))
        .run()
      return result.changes
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db.delete(agentChatMessages).where(eq(agentChatMessages.job_id, jobId)).run()
  return result.changes
}

/**
 * Delete old chat messages (cleanup).
 * @param daysOld - Number of days old to consider for deletion
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteOldChatMessages(daysOld: number = 30, projectId?: string): number {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .delete(projectAgentChatMessages)
        .where(lt(projectAgentChatMessages.created_at, cutoffDate.toISOString()))
        .run()
      return result.changes
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * @param jobId - The job ID
 * @param maxMessages - Maximum number of messages to include
 * @param projectId - Optional project ID for direct DB resolution
 */
export function buildChatContextForPrompt(
  jobId: string,
  maxMessages: number = 5,
  projectId?: string
): string {
  const messages = getRecentChatContext(jobId, maxMessages, projectId)
  if (messages.length === 0) return ''

  const lines = messages.map((msg) => {
    const role = msg.role === 'user' ? 'User' : msg.role === 'agent' ? 'Assistant' : 'System'
    return `${role}: ${msg.content}`
  })

  return `\n<recent_chat_context>\n${lines.join('\n')}\n</recent_chat_context>\n`
}
