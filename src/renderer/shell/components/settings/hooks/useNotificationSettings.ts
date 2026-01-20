/**
 * Notification Settings Hook
 *
 * Manages audio notification settings
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project } from '@shared/types'
import type { NotificationsSettings } from '../types'
import { readNotificationsSettings } from '../utils/settings-readers'

interface UseNotificationSettingsReturn {
  audioEnabled: boolean
  soundOnComplete: boolean
  soundOnError: boolean
  soundOnApproval: boolean
  loadNotificationSettings: (project: Project | null) => void
  handleAudioEnabledChange: (project: Project | null, enabled: boolean) => void
  handleSoundOnCompleteChange: (project: Project | null, enabled: boolean) => void
  handleSoundOnErrorChange: (project: Project | null, enabled: boolean) => void
  handleSoundOnApprovalChange: (project: Project | null, enabled: boolean) => void
}

export function useNotificationSettings(): UseNotificationSettingsReturn {
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [soundOnComplete, setSoundOnComplete] = useState(true)
  const [soundOnError, setSoundOnError] = useState(true)
  const [soundOnApproval, setSoundOnApproval] = useState(true)

  const loadNotificationSettings = useCallback((project: Project | null) => {
    const settings = readNotificationsSettings(project)
    setAudioEnabled(settings.audioEnabled)
    setSoundOnComplete(settings.soundOnComplete)
    setSoundOnError(settings.soundOnError)
    setSoundOnApproval(settings.soundOnApproval)
  }, [])

  const updateNotificationSetting = useCallback(
    async (project: Project | null, update: Partial<NotificationsSettings>) => {
      try {
        await window.electron.ipcRenderer.invoke('updateFeatureConfig', {
          projectId: project?.id,
          feature: 'notifications',
          config: update
        })
        toast.success('Notification settings updated')
      } catch (err) {
        toast.error('Failed to update notification settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        const notifications = readNotificationsSettings(project)
        setAudioEnabled(notifications.audioEnabled)
        setSoundOnComplete(notifications.soundOnComplete)
        setSoundOnError(notifications.soundOnError)
        setSoundOnApproval(notifications.soundOnApproval)
      }
    },
    []
  )

  const handleAudioEnabledChange = useCallback(
    (project: Project | null, enabled: boolean) => {
      setAudioEnabled(enabled)
      updateNotificationSetting(project, { audioEnabled: enabled })
    },
    [updateNotificationSetting]
  )

  const handleSoundOnCompleteChange = useCallback(
    (project: Project | null, enabled: boolean) => {
      setSoundOnComplete(enabled)
      updateNotificationSetting(project, { soundOnComplete: enabled })
    },
    [updateNotificationSetting]
  )

  const handleSoundOnErrorChange = useCallback(
    (project: Project | null, enabled: boolean) => {
      setSoundOnError(enabled)
      updateNotificationSetting(project, { soundOnError: enabled })
    },
    [updateNotificationSetting]
  )

  const handleSoundOnApprovalChange = useCallback(
    (project: Project | null, enabled: boolean) => {
      setSoundOnApproval(enabled)
      updateNotificationSetting(project, { soundOnApproval: enabled })
    },
    [updateNotificationSetting]
  )

  return {
    audioEnabled,
    soundOnComplete,
    soundOnError,
    soundOnApproval,
    loadNotificationSettings,
    handleAudioEnabledChange,
    handleSoundOnCompleteChange,
    handleSoundOnErrorChange,
    handleSoundOnApprovalChange
  }
}
