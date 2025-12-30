/**
 * IPC handlers for feature suggestion operations.
 * Handles: create, read, update, delete, vote
 */

import { ipcMain } from 'electron'
import {
  createFeatureSuggestion,
  getFeatureSuggestion,
  getFeatureSuggestionsByProject,
  updateFeatureSuggestion,
  updateFeatureSuggestionStatus,
  deleteFeatureSuggestion,
  voteOnSuggestion,
  getUserVote,
  type CreateFeatureSuggestionData,
  type UpdateFeatureSuggestionData,
  type GetFeatureSuggestionsOptions
} from '../../db'
import { logAction } from '@shared/utils'
import type {
  FeatureSuggestion,
  FeatureSuggestionStatus,
  FeatureSuggestionCategory
} from '@shared/types'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerFeatureSuggestionHandlers(notifyRenderer: () => void): void {
  // Create a new feature suggestion
  ipcMain.handle(
    'featureSuggestions:create',
    async (
      _e,
      params: CreateFeatureSuggestionData
    ): Promise<{ suggestion: FeatureSuggestion | null; error?: string }> => {
      logAction('featureSuggestions:create', { projectId: params.projectId, title: params.title })

      try {
        const suggestion = createFeatureSuggestion(params)
        notifyRenderer()
        return { suggestion }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { suggestion: null, error: errorMsg }
      }
    }
  )

  // Get a single feature suggestion by ID
  ipcMain.handle(
    'featureSuggestions:get',
    async (
      _e,
      suggestionId: string
    ): Promise<{ suggestion: FeatureSuggestion | null; error?: string }> => {
      logAction('featureSuggestions:get', { suggestionId })

      try {
        const suggestion = getFeatureSuggestion(suggestionId)
        return { suggestion }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { suggestion: null, error: errorMsg }
      }
    }
  )

  // Get all feature suggestions for a project
  ipcMain.handle(
    'featureSuggestions:list',
    async (
      _e,
      params: {
        projectId: string
        status?: FeatureSuggestionStatus
        category?: FeatureSuggestionCategory
        sortBy?: 'vote_count' | 'created_at' | 'priority' | 'updated_at'
        sortOrder?: 'asc' | 'desc'
        limit?: number
        offset?: number
      }
    ): Promise<{ suggestions: FeatureSuggestion[]; error?: string }> => {
      logAction('featureSuggestions:list', { projectId: params.projectId })

      try {
        const options: GetFeatureSuggestionsOptions = {
          status: params.status,
          category: params.category,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
          limit: params.limit,
          offset: params.offset
        }
        const suggestions = getFeatureSuggestionsByProject(params.projectId, options)
        return { suggestions }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { suggestions: [], error: errorMsg }
      }
    }
  )

  // Update a feature suggestion
  ipcMain.handle(
    'featureSuggestions:update',
    async (
      _e,
      params: { suggestionId: string; data: UpdateFeatureSuggestionData }
    ): Promise<{ suggestion: FeatureSuggestion | null; error?: string }> => {
      logAction('featureSuggestions:update', { suggestionId: params.suggestionId })

      try {
        const suggestion = updateFeatureSuggestion(params.suggestionId, params.data)
        if (suggestion) {
          notifyRenderer()
        }
        return { suggestion }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { suggestion: null, error: errorMsg }
      }
    }
  )

  // Update the status of a feature suggestion
  ipcMain.handle(
    'featureSuggestions:updateStatus',
    async (
      _e,
      params: { suggestionId: string; status: FeatureSuggestionStatus }
    ): Promise<{ success: boolean; error?: string }> => {
      logAction('featureSuggestions:updateStatus', {
        suggestionId: params.suggestionId,
        status: params.status
      })

      try {
        const success = updateFeatureSuggestionStatus(params.suggestionId, params.status)
        if (success) {
          notifyRenderer()
        }
        return { success }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { success: false, error: errorMsg }
      }
    }
  )

  // Delete a feature suggestion
  ipcMain.handle(
    'featureSuggestions:delete',
    async (_e, suggestionId: string): Promise<{ success: boolean; error?: string }> => {
      logAction('featureSuggestions:delete', { suggestionId })

      try {
        const success = deleteFeatureSuggestion(suggestionId)
        if (success) {
          notifyRenderer()
        }
        return { success }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { success: false, error: errorMsg }
      }
    }
  )

  // Vote on a feature suggestion
  ipcMain.handle(
    'featureSuggestions:vote',
    async (
      _e,
      params: { suggestionId: string; voteType: 'up' | 'down'; voterId?: string }
    ): Promise<{ voteCount: number; userVote: 'up' | 'down' | null; error?: string }> => {
      logAction('featureSuggestions:vote', {
        suggestionId: params.suggestionId,
        voteType: params.voteType
      })

      try {
        const result = voteOnSuggestion(params.suggestionId, params.voteType, params.voterId)
        if (!result) {
          return { voteCount: 0, userVote: null, error: 'Suggestion not found' }
        }
        notifyRenderer()
        return { voteCount: result.voteCount, userVote: result.userVote }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { voteCount: 0, userVote: null, error: errorMsg }
      }
    }
  )

  // Get user's vote on a suggestion
  ipcMain.handle(
    'featureSuggestions:getUserVote',
    async (
      _e,
      params: { suggestionId: string; voterId?: string }
    ): Promise<{ voteType: 'up' | 'down' | null; error?: string }> => {
      logAction('featureSuggestions:getUserVote', { suggestionId: params.suggestionId })

      try {
        const vote = getUserVote(params.suggestionId, params.voterId)
        return { voteType: vote ? (vote.vote_type as 'up' | 'down') : null }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { voteType: null, error: errorMsg }
      }
    }
  )
}
