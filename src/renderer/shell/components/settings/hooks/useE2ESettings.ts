/**
 * E2E Testing Settings Hook
 *
 * Manages E2E testing configuration state and updates
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project } from '@shared/types'
import type { E2ESettings } from '../types'
import { readE2ESettings } from '../utils/settings-readers'

interface UseE2ESettingsReturn {
  e2eEnabled: boolean
  e2eMaxRetries: number
  e2eTimeoutMinutes: number
  e2eCreateTestsIfMissing: boolean
  e2eTestCommand: string
  loadE2ESettings: (project: Project) => void
  handleE2eEnabledChange: (project: Project, enabled: boolean) => void
  handleE2eMaxRetriesChange: (project: Project, value: string) => void
  handleE2eTimeoutChange: (project: Project, value: string) => void
  handleE2eCreateTestsChange: (project: Project, enabled: boolean) => void
  handleE2eTestCommandChange: (value: string) => void
  handleE2eTestCommandBlur: (project: Project) => void
}

export function useE2ESettings(): UseE2ESettingsReturn {
  const [e2eEnabled, setE2eEnabled] = useState(false)
  const [e2eMaxRetries, setE2eMaxRetries] = useState(3)
  const [e2eTimeoutMinutes, setE2eTimeoutMinutes] = useState(10)
  const [e2eCreateTestsIfMissing, setE2eCreateTestsIfMissing] = useState(true)
  const [e2eTestCommand, setE2eTestCommand] = useState('')

  const loadE2ESettings = useCallback((project: Project) => {
    const settings = readE2ESettings(project)
    setE2eEnabled(settings.enabled)
    setE2eMaxRetries(settings.maxRetries)
    setE2eTimeoutMinutes(settings.timeoutMinutes)
    setE2eCreateTestsIfMissing(settings.createTestsIfMissing)
    setE2eTestCommand(settings.testCommand)
  }, [])

  const updateE2ESetting = useCallback(async (project: Project, update: Partial<E2ESettings>) => {
    try {
      await window.electron.ipcRenderer.invoke('updateE2ESettings', {
        projectId: project.id,
        e2eConfig: update
      })
      toast.success('E2E settings updated')
    } catch (err) {
      toast.error('Failed to update E2E settings', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
      // Reload settings on error
      const e2e = readE2ESettings(project)
      setE2eEnabled(e2e.enabled)
      setE2eMaxRetries(e2e.maxRetries)
      setE2eTimeoutMinutes(e2e.timeoutMinutes)
      setE2eCreateTestsIfMissing(e2e.createTestsIfMissing)
      setE2eTestCommand(e2e.testCommand)
    }
  }, [])

  const handleE2eEnabledChange = useCallback(
    (project: Project, enabled: boolean) => {
      setE2eEnabled(enabled)
      updateE2ESetting(project, { enabled })
    },
    [updateE2ESetting]
  )

  const handleE2eMaxRetriesChange = useCallback(
    (project: Project, value: string) => {
      const num = parseInt(value, 10)
      if (num >= 1 && num <= 10) {
        setE2eMaxRetries(num)
        updateE2ESetting(project, { maxRetries: num })
      }
    },
    [updateE2ESetting]
  )

  const handleE2eTimeoutChange = useCallback(
    (project: Project, value: string) => {
      const num = parseInt(value, 10)
      if (num >= 1 && num <= 60) {
        setE2eTimeoutMinutes(num)
        updateE2ESetting(project, { timeoutMinutes: num })
      }
    },
    [updateE2ESetting]
  )

  const handleE2eCreateTestsChange = useCallback(
    (project: Project, enabled: boolean) => {
      setE2eCreateTestsIfMissing(enabled)
      updateE2ESetting(project, { createTestsIfMissing: enabled })
    },
    [updateE2ESetting]
  )

  const handleE2eTestCommandChange = useCallback((value: string) => {
    setE2eTestCommand(value)
  }, [])

  const handleE2eTestCommandBlur = useCallback(
    (project: Project) => {
      updateE2ESetting(project, { testCommand: e2eTestCommand || undefined })
    },
    [e2eTestCommand, updateE2ESetting]
  )

  return {
    e2eEnabled,
    e2eMaxRetries,
    e2eTimeoutMinutes,
    e2eCreateTestsIfMissing,
    e2eTestCommand,
    loadE2ESettings,
    handleE2eEnabledChange,
    handleE2eMaxRetriesChange,
    handleE2eTimeoutChange,
    handleE2eCreateTestsChange,
    handleE2eTestCommandChange,
    handleE2eTestCommandBlur
  }
}
