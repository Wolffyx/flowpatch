/**
 * Sync Hook
 *
 * Manages project synchronization operations.
 */

import { useCallback } from 'react'

export interface UseSyncOptions {
  selectedProjectId: string | null
  setIsLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  loadState: () => Promise<void>
}

export interface UseSyncResult {
  syncProject: () => Promise<void>
}

export function useSync(options: UseSyncOptions): UseSyncResult {
  const { selectedProjectId, setIsLoading, setError, loadState } = options

  const syncProject = useCallback(async () => {
    if (!selectedProjectId) return
    setIsLoading(true)
    try {
      await window.electron.ipcRenderer.invoke('syncProject', { projectId: selectedProjectId })
      await loadState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync project')
    } finally {
      setIsLoading(false)
    }
  }, [selectedProjectId, loadState, setIsLoading, setError])

  return {
    syncProject
  }
}
