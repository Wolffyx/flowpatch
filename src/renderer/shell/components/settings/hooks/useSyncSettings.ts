/**
 * Sync Settings Hook
 *
 * Manages sync interval and auto-sync settings
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project } from '@shared/types'
import { readSyncSettings } from '../utils/settings-readers'

interface UseSyncSettingsReturn {
  syncPollInterval: number // in minutes
  autoSyncOnAction: boolean
  loadSyncSettings: (project: Project) => void
  handleSyncPollIntervalChange: (project: Project, minutes: number) => void
  handleAutoSyncOnActionChange: (project: Project, enabled: boolean) => void
}

export function useSyncSettings(): UseSyncSettingsReturn {
  const [syncPollInterval, setSyncPollInterval] = useState(3) // 3 minutes default
  const [autoSyncOnAction, setAutoSyncOnAction] = useState(true)

  const loadSyncSettings = useCallback((project: Project) => {
    const settings = readSyncSettings(project)
    setSyncPollInterval(Math.round(settings.pollInterval / 60000))
    setAutoSyncOnAction(settings.autoSyncOnAction)
  }, [])

  const updateSyncSetting = useCallback(
    async (project: Project, update: { pollInterval?: number; autoSyncOnAction?: boolean }) => {
      try {
        await window.electron.ipcRenderer.invoke('updateSyncSettings', {
          projectId: project.id,
          ...update
        })
        toast.success('Sync settings updated')
      } catch (err) {
        // Rollback state on error
        const sync = readSyncSettings(project)
        setSyncPollInterval(Math.round(sync.pollInterval / 60000))
        setAutoSyncOnAction(sync.autoSyncOnAction)
        toast.error('Failed to update sync settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    []
  )

  const handleSyncPollIntervalChange = useCallback(
    (project: Project, minutes: number) => {
      const clamped = Math.max(1, Math.min(60, minutes))
      setSyncPollInterval(clamped)
      updateSyncSetting(project, { pollInterval: clamped * 60000 })
    },
    [updateSyncSetting]
  )

  const handleAutoSyncOnActionChange = useCallback(
    (project: Project, enabled: boolean) => {
      setAutoSyncOnAction(enabled)
      updateSyncSetting(project, { autoSyncOnAction: enabled })
    },
    [updateSyncSetting]
  )

  return {
    syncPollInterval,
    autoSyncOnAction,
    loadSyncSettings,
    handleSyncPollIntervalChange,
    handleAutoSyncOnActionChange
  }
}
