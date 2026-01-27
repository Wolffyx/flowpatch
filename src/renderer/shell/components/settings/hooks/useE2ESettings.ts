/**
 * E2E Testing Settings Hook
 *
 * Manages E2E testing configuration state and updates
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project, AppType, TestPersistence } from '@shared/types'
import type { E2ESettings } from '../types'
import { readE2ESettings } from '../utils/settings-readers'

interface UseE2ESettingsReturn {
  // Existing settings
  e2eEnabled: boolean
  e2eMaxRetries: number
  e2eTimeoutMinutes: number
  e2eCreateTestsIfMissing: boolean
  e2eTestCommand: string

  // New browser testing settings
  e2eAppType: AppType
  e2eTestPersistence: TestPersistence
  e2eDevServerCommand: string
  e2eDevServerPort: number | null
  e2eBaseUrl: string

  // Handlers
  loadE2ESettings: (project: Project) => void
  handleE2eEnabledChange: (project: Project, enabled: boolean) => void
  handleE2eMaxRetriesChange: (project: Project, value: string) => void
  handleE2eTimeoutChange: (project: Project, value: string) => void
  handleE2eCreateTestsChange: (project: Project, enabled: boolean) => void
  handleE2eTestCommandChange: (value: string) => void
  handleE2eTestCommandBlur: (project: Project) => void

  // New handlers for browser testing settings
  handleE2eAppTypeChange: (project: Project, appType: AppType) => void
  handleE2eTestPersistenceChange: (project: Project, persistence: TestPersistence) => void
  handleE2eDevServerCommandChange: (value: string) => void
  handleE2eDevServerCommandBlur: (project: Project) => void
  handleE2eDevServerPortChange: (project: Project, value: string) => void
  handleE2eBaseUrlChange: (value: string) => void
  handleE2eBaseUrlBlur: (project: Project) => void
}

export function useE2ESettings(): UseE2ESettingsReturn {
  // Existing state
  const [e2eEnabled, setE2eEnabled] = useState(false)
  const [e2eMaxRetries, setE2eMaxRetries] = useState(3)
  const [e2eTimeoutMinutes, setE2eTimeoutMinutes] = useState(10)
  const [e2eCreateTestsIfMissing, setE2eCreateTestsIfMissing] = useState(true)
  const [e2eTestCommand, setE2eTestCommand] = useState('')

  // New browser testing state
  const [e2eAppType, setE2eAppType] = useState<AppType>('auto')
  const [e2eTestPersistence, setE2eTestPersistence] = useState<TestPersistence>('persistent')
  const [e2eDevServerCommand, setE2eDevServerCommand] = useState('')
  const [e2eDevServerPort, setE2eDevServerPort] = useState<number | null>(null)
  const [e2eBaseUrl, setE2eBaseUrl] = useState('')

  const loadE2ESettings = useCallback((project: Project) => {
    const settings = readE2ESettings(project)
    setE2eEnabled(settings.enabled)
    setE2eMaxRetries(settings.maxRetries)
    setE2eTimeoutMinutes(settings.timeoutMinutes)
    setE2eCreateTestsIfMissing(settings.createTestsIfMissing)
    setE2eTestCommand(settings.testCommand)
    setE2eAppType(settings.appType)
    setE2eTestPersistence(settings.testPersistence)
    setE2eDevServerCommand(settings.devServerCommand)
    setE2eDevServerPort(settings.devServerPort)
    setE2eBaseUrl(settings.baseUrl)
  }, [])

  const reloadE2ESettings = useCallback((project: Project) => {
    const settings = readE2ESettings(project)
    setE2eEnabled(settings.enabled)
    setE2eMaxRetries(settings.maxRetries)
    setE2eTimeoutMinutes(settings.timeoutMinutes)
    setE2eCreateTestsIfMissing(settings.createTestsIfMissing)
    setE2eTestCommand(settings.testCommand)
    setE2eAppType(settings.appType)
    setE2eTestPersistence(settings.testPersistence)
    setE2eDevServerCommand(settings.devServerCommand)
    setE2eDevServerPort(settings.devServerPort)
    setE2eBaseUrl(settings.baseUrl)
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
      reloadE2ESettings(project)
    }
  }, [reloadE2ESettings])

  // Existing handlers
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

  // New handlers for browser testing settings
  const handleE2eAppTypeChange = useCallback(
    (project: Project, appType: AppType) => {
      setE2eAppType(appType)
      updateE2ESetting(project, { appType })
    },
    [updateE2ESetting]
  )

  const handleE2eTestPersistenceChange = useCallback(
    (project: Project, persistence: TestPersistence) => {
      setE2eTestPersistence(persistence)
      updateE2ESetting(project, { testPersistence: persistence })
    },
    [updateE2ESetting]
  )

  const handleE2eDevServerCommandChange = useCallback((value: string) => {
    setE2eDevServerCommand(value)
  }, [])

  const handleE2eDevServerCommandBlur = useCallback(
    (project: Project) => {
      updateE2ESetting(project, { devServerCommand: e2eDevServerCommand || undefined })
    },
    [e2eDevServerCommand, updateE2ESetting]
  )

  const handleE2eDevServerPortChange = useCallback(
    (project: Project, value: string) => {
      const num = value ? parseInt(value, 10) : null
      if (num === null || (num >= 1 && num <= 65535)) {
        setE2eDevServerPort(num)
        updateE2ESetting(project, { devServerPort: num })
      }
    },
    [updateE2ESetting]
  )

  const handleE2eBaseUrlChange = useCallback((value: string) => {
    setE2eBaseUrl(value)
  }, [])

  const handleE2eBaseUrlBlur = useCallback(
    (project: Project) => {
      updateE2ESetting(project, { baseUrl: e2eBaseUrl || undefined })
    },
    [e2eBaseUrl, updateE2ESetting]
  )

  return {
    // Existing settings
    e2eEnabled,
    e2eMaxRetries,
    e2eTimeoutMinutes,
    e2eCreateTestsIfMissing,
    e2eTestCommand,

    // New browser testing settings
    e2eAppType,
    e2eTestPersistence,
    e2eDevServerCommand,
    e2eDevServerPort,
    e2eBaseUrl,

    // Existing handlers
    loadE2ESettings,
    handleE2eEnabledChange,
    handleE2eMaxRetriesChange,
    handleE2eTimeoutChange,
    handleE2eCreateTestsChange,
    handleE2eTestCommandChange,
    handleE2eTestCommandBlur,

    // New handlers
    handleE2eAppTypeChange,
    handleE2eTestPersistenceChange,
    handleE2eDevServerCommandChange,
    handleE2eDevServerCommandBlur,
    handleE2eDevServerPortChange,
    handleE2eBaseUrlChange,
    handleE2eBaseUrlBlur
  }
}
