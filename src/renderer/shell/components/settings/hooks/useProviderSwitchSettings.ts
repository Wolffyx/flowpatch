/**
 * Provider Switch Settings Hook
 *
 * Manages AI provider switching configuration settings
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project } from '@shared/types'
import type { ProviderSwitchSettings, ProviderSwitchMode, ExhaustedBehavior } from '../types'
import { readProviderSwitchSettings } from '../utils/settings-readers'

interface UseProviderSwitchSettingsReturn {
  mode: ProviderSwitchMode
  exhaustedBehavior: ExhaustedBehavior
  retryIntervalMinutes: number
  maxWaitMinutes: number
  notifyOnSwitch: boolean
  loadProviderSwitchSettings: (project: Project | null) => void
  handleModeChange: (project: Project | null, mode: ProviderSwitchMode) => void
  handleExhaustedBehaviorChange: (project: Project | null, behavior: ExhaustedBehavior) => void
  handleRetryIntervalChange: (project: Project | null, minutes: number) => void
  handleMaxWaitChange: (project: Project | null, minutes: number) => void
  handleNotifyOnSwitchChange: (project: Project | null, notify: boolean) => void
}

export function useProviderSwitchSettings(): UseProviderSwitchSettingsReturn {
  const [mode, setMode] = useState<ProviderSwitchMode>('automatic')
  const [exhaustedBehavior, setExhaustedBehavior] = useState<ExhaustedBehavior>('pause_and_wait')
  const [retryIntervalMinutes, setRetryIntervalMinutes] = useState(5)
  const [maxWaitMinutes, setMaxWaitMinutes] = useState(60)
  const [notifyOnSwitch, setNotifyOnSwitch] = useState(true)

  const loadProviderSwitchSettings = useCallback((project: Project | null) => {
    const settings = readProviderSwitchSettings(project)
    setMode(settings.mode)
    setExhaustedBehavior(settings.exhaustedBehavior)
    setRetryIntervalMinutes(settings.retryIntervalMinutes)
    setMaxWaitMinutes(settings.maxWaitMinutes)
    setNotifyOnSwitch(settings.notifyOnSwitch)
  }, [])

  const updateProviderSwitchSetting = useCallback(
    async (project: Project | null, update: Partial<ProviderSwitchSettings>) => {
      try {
        await window.electron.ipcRenderer.invoke('updateProviderSwitchSettings', {
          projectId: project?.id,
          providerSwitchConfig: update
        })
        toast.success('Provider switch settings updated')
      } catch (err) {
        toast.error('Failed to update provider switch settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        // Revert to saved settings on error
        const settings = readProviderSwitchSettings(project)
        setMode(settings.mode)
        setExhaustedBehavior(settings.exhaustedBehavior)
        setRetryIntervalMinutes(settings.retryIntervalMinutes)
        setMaxWaitMinutes(settings.maxWaitMinutes)
        setNotifyOnSwitch(settings.notifyOnSwitch)
      }
    },
    []
  )

  const handleModeChange = useCallback(
    (project: Project | null, newMode: ProviderSwitchMode) => {
      setMode(newMode)
      updateProviderSwitchSetting(project, { mode: newMode })
    },
    [updateProviderSwitchSetting]
  )

  const handleExhaustedBehaviorChange = useCallback(
    (project: Project | null, behavior: ExhaustedBehavior) => {
      setExhaustedBehavior(behavior)
      updateProviderSwitchSetting(project, { exhaustedBehavior: behavior })
    },
    [updateProviderSwitchSetting]
  )

  const handleRetryIntervalChange = useCallback(
    (project: Project | null, minutes: number) => {
      const clamped = Math.max(1, Math.min(30, minutes))
      setRetryIntervalMinutes(clamped)
      updateProviderSwitchSetting(project, { retryIntervalMinutes: clamped })
    },
    [updateProviderSwitchSetting]
  )

  const handleMaxWaitChange = useCallback(
    (project: Project | null, minutes: number) => {
      const clamped = Math.max(5, Math.min(240, minutes))
      setMaxWaitMinutes(clamped)
      updateProviderSwitchSetting(project, { maxWaitMinutes: clamped })
    },
    [updateProviderSwitchSetting]
  )

  const handleNotifyOnSwitchChange = useCallback(
    (project: Project | null, notify: boolean) => {
      setNotifyOnSwitch(notify)
      updateProviderSwitchSetting(project, { notifyOnSwitch: notify })
    },
    [updateProviderSwitchSetting]
  )

  return {
    mode,
    exhaustedBehavior,
    retryIntervalMinutes,
    maxWaitMinutes,
    notifyOnSwitch,
    loadProviderSwitchSettings,
    handleModeChange,
    handleExhaustedBehaviorChange,
    handleRetryIntervalChange,
    handleMaxWaitChange,
    handleNotifyOnSwitchChange
  }
}
