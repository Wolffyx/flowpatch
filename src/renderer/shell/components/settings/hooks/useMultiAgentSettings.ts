/**
 * Multi-Agent Settings Hook
 *
 * Manages multi-agent mode state and updates
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project, MergeStrategy, ConflictResolution } from '@shared/types'
import type { MultiAgentSettings } from '../types'
import { readMultiAgentSettings } from '../utils/settings-readers'

interface UseMultiAgentSettingsReturn {
  multiAgentEnabled: boolean
  mergeStrategy: MergeStrategy
  conflictResolution: ConflictResolution
  maxAgentsPerCard: string
  loadMultiAgentSettings: (project: Project) => void
  handleMultiAgentEnabledChange: (project: Project, enabled: boolean) => void
  handleMergeStrategyChange: (project: Project, strategy: MergeStrategy) => void
  handleConflictResolutionChange: (project: Project, resolution: ConflictResolution) => void
  handleMaxAgentsPerCardChange: (value: string) => void
  handleMaxAgentsPerCardBlur: (project: Project) => void
}

export function useMultiAgentSettings(): UseMultiAgentSettingsReturn {
  const [multiAgentEnabled, setMultiAgentEnabled] = useState(false)
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('sequential')
  const [conflictResolution, setConflictResolution] = useState<ConflictResolution>('auto')
  const [maxAgentsPerCard, setMaxAgentsPerCard] = useState('')

  const loadMultiAgentSettings = useCallback((project: Project) => {
    const settings = readMultiAgentSettings(project)
    setMultiAgentEnabled(settings.enabled)
    setMergeStrategy(settings.mergeStrategy)
    setConflictResolution(settings.conflictResolution)
    setMaxAgentsPerCard(settings.maxAgentsPerCard?.toString() || '')
  }, [])

  const updateMultiAgentSetting = useCallback(
    async (project: Project, update: Partial<MultiAgentSettings>) => {
      try {
        await window.electron.ipcRenderer.invoke('updateFeatureConfig', {
          projectId: project.id,
          featureKey: 'multiAgent',
          config: update
        })
        toast.success('Multi-Agent settings updated')
      } catch (err) {
        console.error('Failed to update Multi-Agent settings:', err)
        toast.error('Failed to update Multi-Agent settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        // Reload settings on error
        const multiAgent = readMultiAgentSettings(project)
        setMultiAgentEnabled(multiAgent.enabled)
        setMergeStrategy(multiAgent.mergeStrategy)
        setConflictResolution(multiAgent.conflictResolution)
        setMaxAgentsPerCard(multiAgent.maxAgentsPerCard?.toString() || '')
      }
    },
    []
  )

  const handleMultiAgentEnabledChange = useCallback(
    (project: Project, enabled: boolean) => {
      setMultiAgentEnabled(enabled)
      updateMultiAgentSetting(project, { enabled })
    },
    [updateMultiAgentSetting]
  )

  const handleMergeStrategyChange = useCallback(
    (project: Project, strategy: MergeStrategy) => {
      setMergeStrategy(strategy)
      updateMultiAgentSetting(project, { mergeStrategy: strategy })
    },
    [updateMultiAgentSetting]
  )

  const handleConflictResolutionChange = useCallback(
    (project: Project, resolution: ConflictResolution) => {
      setConflictResolution(resolution)
      updateMultiAgentSetting(project, { conflictResolution: resolution })
    },
    [updateMultiAgentSetting]
  )

  const handleMaxAgentsPerCardChange = useCallback((value: string) => {
    setMaxAgentsPerCard(value)
  }, [])

  const handleMaxAgentsPerCardBlur = useCallback(
    (project: Project) => {
      const num = parseInt(maxAgentsPerCard, 10)
      if (num > 0) {
        updateMultiAgentSetting(project, { maxAgentsPerCard: num })
      } else if (maxAgentsPerCard === '') {
        updateMultiAgentSetting(project, { maxAgentsPerCard: undefined })
      }
    },
    [maxAgentsPerCard, updateMultiAgentSetting]
  )

  return {
    multiAgentEnabled,
    mergeStrategy,
    conflictResolution,
    maxAgentsPerCard,
    loadMultiAgentSettings,
    handleMultiAgentEnabledChange,
    handleMergeStrategyChange,
    handleConflictResolutionChange,
    handleMaxAgentsPerCardChange,
    handleMaxAgentsPerCardBlur
  }
}
