/**
 * Thinking Settings Hook
 *
 * Manages extended thinking mode state and updates
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project, ThinkingMode } from '@shared/types'
import type { ThinkingSettings } from '../types'
import { readThinkingSettings } from '../utils/settings-readers'

interface UseThinkingSettingsReturn {
  thinkingEnabled: boolean
  thinkingMode: ThinkingMode
  thinkingBudgetTokens: string
  loadThinkingSettings: (project: Project) => void
  handleThinkingEnabledChange: (project: Project, enabled: boolean) => void
  handleThinkingModeChange: (project: Project, mode: ThinkingMode) => void
  handleThinkingBudgetChange: (value: string) => void
  handleThinkingBudgetBlur: (project: Project) => void
}

export function useThinkingSettings(): UseThinkingSettingsReturn {
  const [thinkingEnabled, setThinkingEnabled] = useState(true)
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('medium')
  const [thinkingBudgetTokens, setThinkingBudgetTokens] = useState('')

  const loadThinkingSettings = useCallback((project: Project) => {
    const settings = readThinkingSettings(project)
    setThinkingEnabled(settings.enabled)
    setThinkingMode(settings.mode)
    setThinkingBudgetTokens(settings.budgetTokens?.toString() || '')
  }, [])

  const updateThinkingSetting = useCallback(
    async (project: Project, update: Partial<ThinkingSettings>) => {
      try {
        await window.electron.ipcRenderer.invoke('updateFeatureConfig', {
          projectId: project.id,
          featureKey: 'thinking',
          config: update
        })
        toast.success('Thinking settings updated')
      } catch (err) {
        console.error('Failed to update thinking settings:', err)
        toast.error('Failed to update thinking settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        // Reload settings on error
        const thinking = readThinkingSettings(project)
        setThinkingEnabled(thinking.enabled)
        setThinkingMode(thinking.mode)
        setThinkingBudgetTokens(thinking.budgetTokens?.toString() || '')
      }
    },
    []
  )

  const handleThinkingEnabledChange = useCallback(
    (project: Project, enabled: boolean) => {
      setThinkingEnabled(enabled)
      updateThinkingSetting(project, { enabled })
    },
    [updateThinkingSetting]
  )

  const handleThinkingModeChange = useCallback(
    (project: Project, mode: ThinkingMode) => {
      setThinkingMode(mode)
      updateThinkingSetting(project, { mode })
    },
    [updateThinkingSetting]
  )

  const handleThinkingBudgetChange = useCallback((value: string) => {
    setThinkingBudgetTokens(value)
  }, [])

  const handleThinkingBudgetBlur = useCallback(
    (project: Project) => {
      const num = parseInt(thinkingBudgetTokens, 10)
      if (num > 0) {
        updateThinkingSetting(project, { budgetTokens: num })
      } else if (thinkingBudgetTokens === '') {
        updateThinkingSetting(project, { budgetTokens: undefined })
      }
    },
    [thinkingBudgetTokens, updateThinkingSetting]
  )

  return {
    thinkingEnabled,
    thinkingMode,
    thinkingBudgetTokens,
    loadThinkingSettings,
    handleThinkingEnabledChange,
    handleThinkingModeChange,
    handleThinkingBudgetChange,
    handleThinkingBudgetBlur
  }
}
