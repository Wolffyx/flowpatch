/**
 * Feature Settings Hook
 *
 * Manages feature-related settings (cancel behavior, base branch, board settings, etc.)
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project } from '@shared/types'
import type { WorkerToolPreference } from '../types'
import {
  readToolPreference,
  readRollbackOnCancel,
  readBaseBranch,
  readShowPullRequestsSection
} from '../utils/settings-readers'

interface UseFeatureSettingsReturn {
  toolPreference: WorkerToolPreference
  rollbackOnCancel: boolean
  baseBranch: string
  showPullRequestsSection: boolean
  savingBaseBranch: boolean
  setBaseBranch: (branch: string) => void
  loadFeatureSettings: (project: Project) => void
  handleToolPreferenceChange: (project: Project, pref: WorkerToolPreference) => Promise<void>
  handleRollbackOnCancelChange: (project: Project, enabled: boolean) => Promise<void>
  handleBaseBranchSave: (project: Project) => Promise<void>
  handleShowPRsSectionChange: (project: Project, enabled: boolean) => Promise<void>
}

export function useFeatureSettings(): UseFeatureSettingsReturn {
  const [toolPreference, setToolPreference] = useState<WorkerToolPreference>('auto')
  const [rollbackOnCancel, setRollbackOnCancel] = useState(false)
  const [baseBranch, setBaseBranch] = useState('')
  const [showPullRequestsSection, setShowPullRequestsSection] = useState(false)
  const [savingBaseBranch, setSavingBaseBranch] = useState(false)

  const loadFeatureSettings = useCallback((project: Project) => {
    setToolPreference(readToolPreference(project))
    setRollbackOnCancel(readRollbackOnCancel(project))
    setBaseBranch(readBaseBranch(project))
    setShowPullRequestsSection(readShowPullRequestsSection(project))
  }, [])

  const handleToolPreferenceChange = useCallback(
    async (project: Project, newPref: WorkerToolPreference) => {
      const previousValue = toolPreference
      setToolPreference(newPref)
      try {
        await window.electron.ipcRenderer.invoke('updateProjectPolicy', {
          projectId: project.id,
          policy: { worker: { toolPreference: newPref } }
        })
        toast.success('AI tool preference updated', {
          description: `Worker will use ${newPref === 'auto' ? 'Auto' : newPref === 'claude' ? 'Claude Code' : 'Codex'}`
        })
      } catch (err) {
        setToolPreference(previousValue)
        console.error('Failed to update tool preference:', err)
        toast.error('Failed to update tool preference', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [toolPreference]
  )

  const handleRollbackOnCancelChange = useCallback(
    async (project: Project, enabled: boolean) => {
      const previousValue = rollbackOnCancel
      setRollbackOnCancel(enabled)
      try {
        await window.electron.ipcRenderer.invoke('updateProjectPolicy', {
          projectId: project.id,
          policy: { worker: { rollbackOnCancel: enabled } }
        })
        toast.success('Cancel behavior updated', {
          description: enabled
            ? 'Changes will be rolled back on cancel'
            : 'Changes will be kept on cancel'
        })
      } catch (err) {
        setRollbackOnCancel(previousValue)
        console.error('Failed to update cancel behavior:', err)
        toast.error('Failed to update cancel behavior', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [rollbackOnCancel]
  )

  const handleBaseBranchSave = useCallback(
    async (project: Project) => {
      const value = baseBranch.trim()
      setSavingBaseBranch(true)
      try {
        await window.electron.ipcRenderer.invoke('updateProjectPolicy', {
          projectId: project.id,
          policy: {
            worker: {
              baseBranch: value || undefined,
              worktree: { baseBranch: value || undefined }
            }
          }
        })
        toast.success('Base branch updated', {
          description: value
            ? `Worker will pull ${value} before starting`
            : 'Worker will auto-detect the main branch'
        })
      } catch (err) {
        console.error('Failed to update base branch:', err)
        toast.error('Failed to update base branch', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      } finally {
        setSavingBaseBranch(false)
      }
    },
    [baseBranch]
  )

  const handleShowPRsSectionChange = useCallback(
    async (project: Project, enabled: boolean) => {
      const previousValue = showPullRequestsSection
      setShowPullRequestsSection(enabled)
      try {
        await window.electron.ipcRenderer.invoke('updateProjectPolicy', {
          projectId: project.id,
          policy: { ui: { showPullRequestsSection: enabled } }
        })
        toast.success('Board layout updated', {
          description: enabled
            ? 'Pull requests section is now visible'
            : 'Pull requests section is now hidden'
        })
      } catch (err) {
        setShowPullRequestsSection(previousValue)
        console.error('Failed to update board layout:', err)
        toast.error('Failed to update board layout', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [showPullRequestsSection]
  )

  return {
    toolPreference,
    rollbackOnCancel,
    baseBranch,
    showPullRequestsSection,
    savingBaseBranch,
    setBaseBranch,
    loadFeatureSettings,
    handleToolPreferenceChange,
    handleRollbackOnCancelChange,
    handleBaseBranchSave,
    handleShowPRsSectionChange
  }
}
