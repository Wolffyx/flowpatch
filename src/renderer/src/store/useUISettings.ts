/**
 * UI Settings Hook
 *
 * Manages UI-related settings like showing pull requests section.
 */

import { useCallback } from 'react'
import type { PolicyConfig } from '../../../shared/types'
import type { ProjectData } from './useProjects'

export interface UseUISettingsOptions {
  selectedProjectId: string | null
  projects: ProjectData[]
  setError: (error: string | null) => void
  loadState: () => Promise<void>
}

export interface UseUISettingsResult {
  setShowPullRequestsSection: (showPullRequestsSection: boolean) => Promise<void>
}

export function useUISettings(options: UseUISettingsOptions): UseUISettingsResult {
  const { selectedProjectId, projects, setError, loadState } = options

  const setShowPullRequestsSection = useCallback(
    async (showPullRequestsSection: boolean) => {
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

        const existingValue = policy?.ui?.showPullRequestsSection ?? false
        if (existingValue === showPullRequestsSection) return

        const result = await window.electron.ipcRenderer.invoke('setShowPullRequestsSection', {
          projectId: selectedProjectId,
          showPullRequestsSection
        })
        if (result?.error) {
          setError(result.error)
          return
        }
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update board settings')
      }
    },
    [selectedProjectId, projects, loadState, setError]
  )

  return {
    setShowPullRequestsSection
  }
}
