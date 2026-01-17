/**
 * AI Profiles Hook
 *
 * Manages AI profiles CRUD operations
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { AIProfile } from '@shared/types'
import type { AIProfileFormData } from '../types'
import { DEFAULT_PROFILE_FORM_DATA } from '../constants'

interface UseAIProfilesReturn {
  aiProfiles: AIProfile[]
  aiProfilesLoading: boolean
  editingProfile: AIProfile | null
  isCreatingProfile: boolean
  profileFormData: AIProfileFormData
  savingProfile: boolean
  setProfileFormData: React.Dispatch<React.SetStateAction<AIProfileFormData>>
  loadAIProfiles: (projectId: string) => Promise<void>
  handleCreateProfile: () => void
  handleEditProfile: (profile: AIProfile) => void
  handleCancelProfileEdit: () => void
  handleSaveProfile: (projectId: string | undefined) => Promise<void>
  handleDeleteProfile: (profileId: string) => Promise<void>
  handleSetDefaultProfile: (profileId: string) => Promise<void>
  handleDuplicateProfile: (profileId: string, currentName: string) => Promise<void>
}

export function useAIProfiles(): UseAIProfilesReturn {
  const [aiProfiles, setAiProfiles] = useState<AIProfile[]>([])
  const [aiProfilesLoading, setAiProfilesLoading] = useState(false)
  const [editingProfile, setEditingProfile] = useState<AIProfile | null>(null)
  const [isCreatingProfile, setIsCreatingProfile] = useState(false)
  const [profileFormData, setProfileFormData] =
    useState<AIProfileFormData>(DEFAULT_PROFILE_FORM_DATA)
  const [savingProfile, setSavingProfile] = useState(false)

  const resetProfileForm = useCallback(() => {
    setProfileFormData(DEFAULT_PROFILE_FORM_DATA)
  }, [])

  const loadAIProfiles = useCallback(async (projectId: string) => {
    setAiProfilesLoading(true)
    try {
      const result = (await window.electron.ipcRenderer.invoke('aiProfiles:list', projectId)) as {
        profiles?: AIProfile[]
        error?: string
      }
      if (result.error) {
        toast.error('Failed to load AI profiles', { description: result.error })
      } else {
        setAiProfiles(result.profiles || [])
      }
    } catch (err) {
      toast.error('Failed to load AI profiles', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setAiProfilesLoading(false)
    }
  }, [])

  const handleCreateProfile = useCallback(() => {
    resetProfileForm()
    setEditingProfile(null)
    setIsCreatingProfile(true)
  }, [resetProfileForm])

  const handleEditProfile = useCallback((profile: AIProfile) => {
    setProfileFormData({
      name: profile.name,
      description: profile.description || '',
      modelProvider: profile.model_provider,
      modelName: profile.model_name || '',
      temperature: profile.temperature?.toString() || '',
      maxTokens: profile.max_tokens?.toString() || '',
      topP: profile.top_p?.toString() || '',
      systemPrompt: profile.system_prompt || '',
      thinkingEnabled: profile.thinking_enabled ?? false,
      thinkingMode: profile.thinking_mode || 'medium',
      thinkingBudgetTokens: profile.thinking_budget_tokens?.toString() || '',
      planningEnabled: profile.planning_enabled ?? false,
      planningMode: profile.planning_mode || 'lite'
    })
    setEditingProfile(profile)
    setIsCreatingProfile(true)
  }, [])

  const handleCancelProfileEdit = useCallback(() => {
    setIsCreatingProfile(false)
    setEditingProfile(null)
    resetProfileForm()
  }, [resetProfileForm])

  const handleSaveProfile = useCallback(
    async (projectId: string | undefined) => {
      if (!profileFormData.name.trim()) {
        toast.error('Profile name is required')
        return
      }

      setSavingProfile(true)
      try {
        const data = {
          name: profileFormData.name.trim(),
          description: profileFormData.description.trim() || undefined,
          modelProvider: profileFormData.modelProvider,
          modelName: profileFormData.modelName.trim() || undefined,
          temperature: profileFormData.temperature
            ? parseFloat(profileFormData.temperature)
            : undefined,
          maxTokens: profileFormData.maxTokens
            ? parseInt(profileFormData.maxTokens, 10)
            : undefined,
          topP: profileFormData.topP ? parseFloat(profileFormData.topP) : undefined,
          systemPrompt: profileFormData.systemPrompt.trim() || undefined,
          thinkingEnabled: profileFormData.thinkingEnabled,
          thinkingMode: profileFormData.thinkingMode,
          thinkingBudgetTokens: profileFormData.thinkingBudgetTokens
            ? parseInt(profileFormData.thinkingBudgetTokens, 10)
            : undefined,
          planningEnabled: profileFormData.planningEnabled,
          planningMode: profileFormData.planningMode
        }

        if (editingProfile) {
          const result = (await window.electron.ipcRenderer.invoke('aiProfiles:update', {
            profileId: editingProfile.id,
            data
          })) as { error?: string }
          if (result.error) {
            toast.error('Failed to update profile', { description: result.error })
          } else {
            toast.success('Profile updated')
            setIsCreatingProfile(false)
            setEditingProfile(null)
            resetProfileForm()
            if (projectId) {
              loadAIProfiles(projectId)
            }
          }
        } else {
          const result = (await window.electron.ipcRenderer.invoke('aiProfiles:create', {
            projectId,
            ...data
          })) as { error?: string }
          if (result.error) {
            toast.error('Failed to create profile', { description: result.error })
          } else {
            toast.success('Profile created')
            setIsCreatingProfile(false)
            resetProfileForm()
            if (projectId) {
              loadAIProfiles(projectId)
            }
          }
        }
      } catch (err) {
        toast.error('Failed to save profile', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      } finally {
        setSavingProfile(false)
      }
    },
    [profileFormData, editingProfile, resetProfileForm, loadAIProfiles]
  )

  const handleDeleteProfile = useCallback(async (profileId: string) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'aiProfiles:delete',
        profileId
      )) as { error?: string }
      if (result.error) {
        toast.error('Failed to delete profile', { description: result.error })
      } else {
        toast.success('Profile deleted')
        // Reload profiles - caller should pass projectId
      }
    } catch (err) {
      toast.error('Failed to delete profile', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }, [])

  const handleSetDefaultProfile = useCallback(async (profileId: string) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'aiProfiles:setDefault',
        profileId
      )) as { error?: string }
      if (result.error) {
        toast.error('Failed to set default profile', { description: result.error })
      } else {
        toast.success('Default profile set')
      }
    } catch (err) {
      toast.error('Failed to set default profile', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }, [])

  const handleDuplicateProfile = useCallback(async (profileId: string, currentName: string) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('aiProfiles:duplicate', {
        profileId,
        newName: `${currentName} (Copy)`
      })) as { error?: string }
      if (result.error) {
        toast.error('Failed to duplicate profile', { description: result.error })
      } else {
        toast.success('Profile duplicated')
      }
    } catch (err) {
      toast.error('Failed to duplicate profile', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }, [])

  return {
    aiProfiles,
    aiProfilesLoading,
    editingProfile,
    isCreatingProfile,
    profileFormData,
    savingProfile,
    setProfileFormData,
    loadAIProfiles,
    handleCreateProfile,
    handleEditProfile,
    handleCancelProfileEdit,
    handleSaveProfile,
    handleDeleteProfile,
    handleSetDefaultProfile,
    handleDuplicateProfile
  }
}
