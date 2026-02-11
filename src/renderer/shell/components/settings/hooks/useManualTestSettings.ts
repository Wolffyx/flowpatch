/**
 * Manual Test Settings Hook
 *
 * Manages manual testing configuration settings
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project } from '@shared/types'
import type { ManualTestSettings } from '../types'
import { readManualTestSettings } from '../utils/settings-readers'

interface UseManualTestSettingsReturn {
  autoPromptAfterAI: boolean
  keepWorktreeForManualTest: boolean
  defaultTestLocation: 'worktree' | 'mainRepo'
  loadManualTestSettings: (project: Project | null) => void
  handleAutoPromptChange: (project: Project | null, enabled: boolean) => void
  handleKeepWorktreeChange: (project: Project | null, enabled: boolean) => void
  handleDefaultLocationChange: (project: Project | null, location: 'worktree' | 'mainRepo') => void
}

export function useManualTestSettings(): UseManualTestSettingsReturn {
  const [autoPromptAfterAI, setAutoPromptAfterAI] = useState(false)
  const [keepWorktreeForManualTest, setKeepWorktreeForManualTest] = useState(false)
  const [defaultTestLocation, setDefaultTestLocation] = useState<'worktree' | 'mainRepo'>('worktree')

  const loadManualTestSettings = useCallback((project: Project | null) => {
    const settings = readManualTestSettings(project)
    setAutoPromptAfterAI(settings.autoPromptAfterAI)
    setKeepWorktreeForManualTest(settings.keepWorktreeForManualTest)
    setDefaultTestLocation(settings.defaultTestLocation)
  }, [])

  const updateManualTestSetting = useCallback(
    async (project: Project | null, update: Partial<ManualTestSettings>) => {
      try {
        await window.electron.ipcRenderer.invoke('updateManualTestSettings', {
          projectId: project?.id,
          manualTestConfig: update
        })
        toast.success('Manual test settings updated')
      } catch (err) {
        toast.error('Failed to update manual test settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        // Revert to saved settings on error
        const settings = readManualTestSettings(project)
        setAutoPromptAfterAI(settings.autoPromptAfterAI)
        setKeepWorktreeForManualTest(settings.keepWorktreeForManualTest)
        setDefaultTestLocation(settings.defaultTestLocation)
      }
    },
    []
  )

  const handleAutoPromptChange = useCallback(
    (project: Project | null, enabled: boolean) => {
      setAutoPromptAfterAI(enabled)
      updateManualTestSetting(project, { autoPromptAfterAI: enabled })
    },
    [updateManualTestSetting]
  )

  const handleKeepWorktreeChange = useCallback(
    (project: Project | null, enabled: boolean) => {
      setKeepWorktreeForManualTest(enabled)
      updateManualTestSetting(project, { keepWorktreeForManualTest: enabled })
    },
    [updateManualTestSetting]
  )

  const handleDefaultLocationChange = useCallback(
    (project: Project | null, location: 'worktree' | 'mainRepo') => {
      setDefaultTestLocation(location)
      updateManualTestSetting(project, { defaultTestLocation: location })
    },
    [updateManualTestSetting]
  )

  return {
    autoPromptAfterAI,
    keepWorktreeForManualTest,
    defaultTestLocation,
    loadManualTestSettings,
    handleAutoPromptChange,
    handleKeepWorktreeChange,
    handleDefaultLocationChange
  }
}
