/**
 * IPC handlers for card comments.
 * Handles: getCardComments, createCardComment, updateCommentPriority, etc.
 */

import { ipcMain } from 'electron'
import {
  getCommentsByCard,
  createCardComment,
  updateCommentPriority as dbUpdateCommentPriority,
  editCommentBody as dbEditCommentBody,
  resolveComment as dbResolveComment,
  reopenComment as dbReopenComment,
  toggleCommentInclusion as dbToggleCommentInclusion,
  deleteCardComment as dbDeleteCardComment,
  deduplicateCommentsForCard,
  deduplicateAllComments
} from '../../db'
import { triggerProjectSync } from '../../sync/scheduler'
import { logAction } from '@shared/utils'
import type { CommentPriority } from '@shared/types'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerCommentHandlers(notifyRenderer: () => void): void {
  // Get all comments for a card
  ipcMain.handle(
    'getCardComments',
    (_e, payload: { cardId: string; projectId: string }) => {
      logAction('getCardComments', payload)
      const comments = getCommentsByCard(payload.cardId, payload.projectId)
      return { comments }
    }
  )

  // Create a new comment
  ipcMain.handle(
    'createCardComment',
    async (
      _e,
      payload: {
        cardId: string
        projectId: string
        body: string
        priority?: CommentPriority
      }
    ) => {
      logAction('createCardComment', {
        cardId: payload.cardId,
        projectId: payload.projectId,
        priority: payload.priority
      })

      const comment = createCardComment({
        card_id: payload.cardId,
        project_id: payload.projectId,
        body: payload.body,
        priority: payload.priority || 'normal',
        source: 'user'
      })

      logAction('createCardComment:success', { commentId: comment.id })
      notifyRenderer()

      // Trigger sync to push to remote (fire-and-forget)
      setImmediate(() => {
        triggerProjectSync(payload.projectId)
      })

      return { comment }
    }
  )

  // Update comment priority
  ipcMain.handle(
    'updateCommentPriority',
    (_e, payload: { commentId: string; priority: CommentPriority; projectId: string }) => {
      logAction('updateCommentPriority', payload)
      const comment = dbUpdateCommentPriority(payload.commentId, payload.priority, payload.projectId)
      notifyRenderer()
      return { comment }
    }
  )

  // Edit comment body
  ipcMain.handle(
    'editCardComment',
    async (_e, payload: { commentId: string; body: string; projectId: string }) => {
      logAction('editCardComment', { commentId: payload.commentId, projectId: payload.projectId })
      const comment = dbEditCommentBody(payload.commentId, payload.body, payload.projectId)
      if (!comment) {
        return { error: 'Comment not found' }
      }
      notifyRenderer()

      // Trigger sync if the comment needs to be pushed to remote
      if (comment.sync_state === 'pending_push') {
        setImmediate(() => {
          triggerProjectSync(payload.projectId)
        })
      }

      return { comment }
    }
  )

  // Resolve a comment
  ipcMain.handle(
    'resolveComment',
    (_e, payload: { commentId: string; projectId: string; jobId?: string }) => {
      logAction('resolveComment', payload)
      const comment = dbResolveComment(payload.commentId, payload.jobId, payload.projectId)
      notifyRenderer()
      return { comment }
    }
  )

  // Reopen a resolved comment
  ipcMain.handle(
    'reopenComment',
    (_e, payload: { commentId: string; projectId: string }) => {
      logAction('reopenComment', payload)
      const comment = dbReopenComment(payload.commentId, payload.projectId)
      notifyRenderer()
      return { comment }
    }
  )

  // Toggle include_in_next_run
  ipcMain.handle(
    'toggleCommentInclusion',
    (_e, payload: { commentId: string; include: boolean; projectId: string }) => {
      logAction('toggleCommentInclusion', payload)
      const comment = dbToggleCommentInclusion(payload.commentId, payload.include, payload.projectId)
      notifyRenderer()
      return { comment }
    }
  )

  // Delete a comment
  ipcMain.handle(
    'deleteCardComment',
    (_e, payload: { commentId: string; projectId: string }) => {
      logAction('deleteCardComment', payload)
      const success = dbDeleteCardComment(payload.commentId, payload.projectId)
      notifyRenderer()
      return { success }
    }
  )

  // Deduplicate comments for a specific card
  ipcMain.handle(
    'deduplicateCardComments',
    (_e, payload: { cardId: string; projectId: string }) => {
      logAction('deduplicateCardComments', payload)
      const deleted = deduplicateCommentsForCard(payload.cardId, payload.projectId)
      if (deleted > 0) {
        notifyRenderer()
      }
      return { deleted }
    }
  )

  // Deduplicate all comments in the project
  ipcMain.handle(
    'deduplicateAllComments',
    (_e, payload: { projectId: string }) => {
      logAction('deduplicateAllComments', payload)
      const result = deduplicateAllComments(payload.projectId)
      if (result.totalDeleted > 0) {
        notifyRenderer()
      }
      return result
    }
  )
}
