/**
 * Worker Hook
 *
 * Manages worker state, logs, and worker-related operations.
 */

import { useState, useCallback, useEffect } from 'react'
import type { PolicyConfig, WorkerLogMessage } from '../../../shared/types'
import type { ProjectData } from './useProjects'

export interface UseWorkerOptions {
  selectedProjectId: string | null
  projects: ProjectData[]
  setError: (error: string | null) => void
  loadState: () => Promise<void>
}

export interface UseWorkerResult {
  // State
  workerLogsByJobId: Record<string, string[]>

  // Actions
  toggleWorker: (enabled: boolean) => Promise<void>
  setWorkerToolPreference: (toolPreference: 'auto' | 'claude' | 'codex') => Promise<void>
  setWorkerRollbackOnCancel: (rollbackOnCancel: boolean) => Promise<void>
  runWorker: (cardId?: string) => Promise<void>
  clearWorkerLogs: (jobId: string) => void
}

export function useWorker(options: UseWorkerOptions): UseWorkerResult {
  const { selectedProjectId, projects, setError, loadState } = options
  const [workerLogsByJobId, setWorkerLogsByJobId] = useState<Record<string, string[]>>({})

  const toggleWorker = useCallback(
    async (enabled: boolean) => {
      if (!selectedProjectId) return
      try {
        await window.electron.ipcRenderer.invoke('toggleWorker', {
          projectId: selectedProjectId,
          enabled
        })
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to toggle worker')
      }
    },
    [selectedProjectId, loadState, setError]
  )

  const setWorkerToolPreference = useCallback(
    async (toolPreference: 'auto' | 'claude' | 'codex') => {
      if (!selectedProjectId) return
      try {
        const currentProject = projects.find((p) => p.project.id === selectedProjectId)?.project
        let policy: PolicyConfig | null = null
        if (currentProject?.policy_json) {
          try {
            policy = JSON.parse(currentProject.policy_json) as PolicyConfig
          } catch {
            policy = null
          }
        }

        const existingPreference = policy?.worker?.toolPreference ?? 'auto'
        if (existingPreference === toolPreference) return

        const result = await window.electron.ipcRenderer.invoke('setWorkerToolPreference', {
          projectId: selectedProjectId,
          toolPreference
        })
        if (result?.error) {
          setError(result.error)
          return
        }
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update worker settings')
      }
    },
    [selectedProjectId, projects, loadState, setError]
  )

  const setWorkerRollbackOnCancel = useCallback(
    async (rollbackOnCancel: boolean) => {
      if (!selectedProjectId) return
      try {
        const currentProject = projects.find((p) => p.project.id === selectedProjectId)?.project
        let policy: PolicyConfig | null = null
        if (currentProject?.policy_json) {
          try {
            policy = JSON.parse(currentProject.policy_json) as PolicyConfig
          } catch {
            policy = null
          }
        }

        const existingValue = policy?.worker?.rollbackOnCancel ?? false
        if (existingValue === rollbackOnCancel) return

        const result = await window.electron.ipcRenderer.invoke('setWorkerRollbackOnCancel', {
          projectId: selectedProjectId,
          rollbackOnCancel
        })
        if (result?.error) {
          setError(result.error)
          return
        }
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update worker settings')
      }
    },
    [selectedProjectId, projects, loadState, setError]
  )

  const runWorker = useCallback(
    async (cardId?: string) => {
      if (!selectedProjectId) return
      try {
        await window.electron.ipcRenderer.invoke('runWorker', {
          projectId: selectedProjectId,
          cardId
        })
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to run worker')
      }
    },
    [selectedProjectId, loadState, setError]
  )

  const clearWorkerLogs = useCallback((jobId: string) => {
    setWorkerLogsByJobId((prev) => {
      if (!(jobId in prev)) return prev
      const next = { ...prev }
      delete next[jobId]
      return next
    })
  }, [])

  // Listen for worker log events
  useEffect(() => {
    const handleWorkerLog = (_event: unknown, payload: WorkerLogMessage): void => {
      if (!payload?.jobId || !payload?.line) return
      setWorkerLogsByJobId((prev) => {
        const existing = prev[payload.jobId] ?? []
        const nextLines = [...existing, payload.line].slice(-1000)
        return { ...prev, [payload.jobId]: nextLines }
      })
    }

    window.electron.ipcRenderer.on('workerLog', handleWorkerLog)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('workerLog')
    }
  }, [])

  return {
    workerLogsByJobId,
    toggleWorker,
    setWorkerToolPreference,
    setWorkerRollbackOnCancel,
    runWorker,
    clearWorkerLogs
  }
}
