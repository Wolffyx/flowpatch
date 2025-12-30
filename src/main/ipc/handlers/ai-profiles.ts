/**
 * IPC handlers for AI profile operations.
 * Handles: create, read, update, delete, setDefault, duplicate
 */

import { ipcMain } from 'electron'
import {
  createAIProfile,
  getAIProfile,
  getAIProfilesByProject,
  getDefaultAIProfile,
  updateAIProfile,
  setDefaultAIProfile,
  deleteAIProfile,
  duplicateAIProfile,
  type CreateAIProfileData,
  type UpdateAIProfileData
} from '../../db'
import { logAction } from '@shared/utils'
import type { AIProfile } from '@shared/types'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerAIProfileHandlers(notifyRenderer: () => void): void {
  // Create a new AI profile
  ipcMain.handle(
    'aiProfiles:create',
    async (
      _e,
      params: CreateAIProfileData
    ): Promise<{ profile: AIProfile | null; error?: string }> => {
      logAction('aiProfiles:create', { projectId: params.projectId, name: params.name })

      try {
        const profile = createAIProfile(params)
        notifyRenderer()
        return { profile }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { profile: null, error: errorMsg }
      }
    }
  )

  // Get a single AI profile by ID
  ipcMain.handle(
    'aiProfiles:get',
    async (_e, profileId: string): Promise<{ profile: AIProfile | null; error?: string }> => {
      logAction('aiProfiles:get', { profileId })

      try {
        const profile = getAIProfile(profileId)
        return { profile }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { profile: null, error: errorMsg }
      }
    }
  )

  // Get all AI profiles for a project
  ipcMain.handle(
    'aiProfiles:list',
    async (_e, projectId: string): Promise<{ profiles: AIProfile[]; error?: string }> => {
      logAction('aiProfiles:list', { projectId })

      try {
        const profiles = getAIProfilesByProject(projectId)
        return { profiles }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { profiles: [], error: errorMsg }
      }
    }
  )

  // Get the default AI profile for a project
  ipcMain.handle(
    'aiProfiles:getDefault',
    async (_e, projectId: string): Promise<{ profile: AIProfile | null; error?: string }> => {
      logAction('aiProfiles:getDefault', { projectId })

      try {
        const profile = getDefaultAIProfile(projectId)
        return { profile }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { profile: null, error: errorMsg }
      }
    }
  )

  // Update an AI profile
  ipcMain.handle(
    'aiProfiles:update',
    async (
      _e,
      params: { profileId: string; data: UpdateAIProfileData }
    ): Promise<{ profile: AIProfile | null; error?: string }> => {
      logAction('aiProfiles:update', { profileId: params.profileId })

      try {
        const profile = updateAIProfile(params.profileId, params.data)
        if (profile) {
          notifyRenderer()
        }
        return { profile }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { profile: null, error: errorMsg }
      }
    }
  )

  // Set a profile as the default
  ipcMain.handle(
    'aiProfiles:setDefault',
    async (_e, profileId: string): Promise<{ success: boolean; error?: string }> => {
      logAction('aiProfiles:setDefault', { profileId })

      try {
        const success = setDefaultAIProfile(profileId)
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

  // Delete an AI profile
  ipcMain.handle(
    'aiProfiles:delete',
    async (_e, profileId: string): Promise<{ success: boolean; error?: string }> => {
      logAction('aiProfiles:delete', { profileId })

      try {
        const success = deleteAIProfile(profileId)
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

  // Duplicate an AI profile
  ipcMain.handle(
    'aiProfiles:duplicate',
    async (
      _e,
      params: { profileId: string; newName: string }
    ): Promise<{ profile: AIProfile | null; error?: string }> => {
      logAction('aiProfiles:duplicate', { profileId: params.profileId, newName: params.newName })

      try {
        const profile = duplicateAIProfile(params.profileId, params.newName)
        if (profile) {
          notifyRenderer()
        }
        return { profile }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { profile: null, error: errorMsg }
      }
    }
  )
}
