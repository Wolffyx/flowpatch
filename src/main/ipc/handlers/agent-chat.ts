/**
 * IPC handlers for agent chat operations.
 * Handles: sendMessage, getMessages, getChatSummary, markAsRead
 */

import { ipcMain } from 'electron'
import {
  createChatMessage,
  getChatMessagesByJob,
  getChatMessagesByCard,
  getChatSummary,
  markAllAsRead,
  getUnreadCount,
  deleteChatMessagesByJob
} from '../../db'
import { broadcastToRenderers } from '../broadcast'
import { logAction } from '@shared/utils'
import type { AgentChatMessage, AgentChatSummary } from '@shared/types'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerAgentChatHandlers(notifyRenderer: () => void): void {
  // Send a user message
  ipcMain.handle(
    'chat:sendMessage',
    async (
      _e,
      params: {
        jobId: string
        cardId: string
        projectId: string
        content: string
        metadata?: Record<string, unknown>
      }
    ): Promise<{ message: AgentChatMessage; error?: string }> => {
      logAction('chat:sendMessage', { jobId: params.jobId, cardId: params.cardId })

      try {
        const message = createChatMessage({
          jobId: params.jobId,
          cardId: params.cardId,
          projectId: params.projectId,
          role: 'user',
          content: params.content,
          metadata: params.metadata
        })

        // Broadcast the new message to all renderers
        broadcastToRenderers('agentChatMessage', {
          type: 'new',
          message,
          jobId: params.jobId
        })

        notifyRenderer()
        return { message }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { message: {} as AgentChatMessage, error: errorMsg }
      }
    }
  )

  // Get messages for a job
  ipcMain.handle(
    'chat:getMessages',
    async (
      _e,
      params: { jobId: string; limit?: number }
    ): Promise<{ messages: AgentChatMessage[]; error?: string }> => {
      logAction('chat:getMessages', { jobId: params.jobId })

      try {
        const messages = getChatMessagesByJob(params.jobId, params.limit)
        return { messages }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { messages: [], error: errorMsg }
      }
    }
  )

  // Get messages for a card (across jobs)
  ipcMain.handle(
    'chat:getMessagesByCard',
    async (
      _e,
      params: { cardId: string; limit?: number }
    ): Promise<{ messages: AgentChatMessage[]; error?: string }> => {
      logAction('chat:getMessagesByCard', { cardId: params.cardId })

      try {
        const messages = getChatMessagesByCard(params.cardId, params.limit)
        return { messages }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { messages: [], error: errorMsg }
      }
    }
  )

  // Get chat summary for a job
  ipcMain.handle(
    'chat:getSummary',
    async (_e, jobId: string): Promise<{ summary: AgentChatSummary; error?: string }> => {
      logAction('chat:getSummary', { jobId })

      try {
        const summary = getChatSummary(jobId)
        return { summary }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return {
          summary: {
            job_id: jobId,
            total_messages: 0,
            unread_count: 0
          },
          error: errorMsg
        }
      }
    }
  )

  // Get unread count for a job
  ipcMain.handle(
    'chat:getUnreadCount',
    async (_e, jobId: string): Promise<{ count: number; error?: string }> => {
      logAction('chat:getUnreadCount', { jobId })

      try {
        const count = getUnreadCount(jobId)
        return { count }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { count: 0, error: errorMsg }
      }
    }
  )

  // Mark all messages as read for a job
  ipcMain.handle(
    'chat:markAsRead',
    async (_e, jobId: string): Promise<{ success: boolean; error?: string }> => {
      logAction('chat:markAsRead', { jobId })

      try {
        markAllAsRead(jobId)
        notifyRenderer()
        return { success: true }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { success: false, error: errorMsg }
      }
    }
  )

  // Clear chat history for a job
  ipcMain.handle(
    'chat:clearHistory',
    async (_e, jobId: string): Promise<{ success: boolean; count: number; error?: string }> => {
      logAction('chat:clearHistory', { jobId })

      try {
        const count = deleteChatMessagesByJob(jobId)
        notifyRenderer()
        return { success: true, count }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { success: false, count: 0, error: errorMsg }
      }
    }
  )
}

// ============================================================================
// Helper Functions for Pipeline Integration
// ============================================================================

/**
 * Send an agent message (called from pipeline).
 * This is used to send messages from the agent to the user.
 */
export function sendAgentMessage(params: {
  jobId: string
  cardId: string
  projectId: string
  content: string
  metadata?: Record<string, unknown>
}): AgentChatMessage {
  const message = createChatMessage({
    jobId: params.jobId,
    cardId: params.cardId,
    projectId: params.projectId,
    role: 'agent',
    content: params.content,
    metadata: params.metadata
  })

  // Broadcast the new message to all renderers
  broadcastToRenderers('agentChatMessage', {
    type: 'new',
    message,
    jobId: params.jobId
  })

  return message
}

/**
 * Send a system message (called from pipeline).
 * Used for status updates, phase changes, etc.
 */
export function sendSystemMessage(params: {
  jobId: string
  cardId: string
  projectId: string
  content: string
  metadata?: Record<string, unknown>
}): AgentChatMessage {
  const message = createChatMessage({
    jobId: params.jobId,
    cardId: params.cardId,
    projectId: params.projectId,
    role: 'system',
    content: params.content,
    metadata: params.metadata
  })

  // Broadcast the new message to all renderers
  broadcastToRenderers('agentChatMessage', {
    type: 'new',
    message,
    jobId: params.jobId
  })

  return message
}
