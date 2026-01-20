/**
 * Planning Settings Hook
 *
 * Manages planning mode state and updates
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project, PlanningMode } from '@shared/types'
import type { PlanningSettings } from '../types'
import { readPlanningSettings } from '../utils/settings-readers'

interface UsePlanningSettingsReturn {
  planningEnabled: boolean
  planningMode: PlanningMode
  planApprovalRequired: boolean
  loadPlanningSettings: (project: Project) => void
  handlePlanningEnabledChange: (project: Project, enabled: boolean) => void
  handlePlanningModeChange: (project: Project, mode: PlanningMode) => void
  handlePlanApprovalRequiredChange: (project: Project, required: boolean) => void
}

export function usePlanningSettings(): UsePlanningSettingsReturn {
  const [planningEnabled, setPlanningEnabled] = useState(true)
  const [planningMode, setPlanningMode] = useState<PlanningMode>('lite')
  const [planApprovalRequired, setPlanApprovalRequired] = useState(false)

  const loadPlanningSettings = useCallback((project: Project) => {
    const settings = readPlanningSettings(project)
    setPlanningEnabled(settings.enabled)
    setPlanningMode(settings.mode)
    setPlanApprovalRequired(settings.approvalRequired)
  }, [])

  const updatePlanningSetting = useCallback(
    async (project: Project, update: Partial<PlanningSettings>) => {
      try {
        await window.electron.ipcRenderer.invoke('updateFeatureConfig', {
          projectId: project.id,
          featureKey: 'planning',
          config: update
        })
        toast.success('Planning settings updated')
      } catch (err) {
        console.error('Failed to update planning settings:', err)
        toast.error('Failed to update planning settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        // Reload settings on error
        const planning = readPlanningSettings(project)
        setPlanningEnabled(planning.enabled)
        setPlanningMode(planning.mode)
        setPlanApprovalRequired(planning.approvalRequired)
      }
    },
    []
  )

  const handlePlanningEnabledChange = useCallback(
    (project: Project, enabled: boolean) => {
      setPlanningEnabled(enabled)
      updatePlanningSetting(project, { enabled })
    },
    [updatePlanningSetting]
  )

  const handlePlanningModeChange = useCallback(
    (project: Project, mode: PlanningMode) => {
      setPlanningMode(mode)
      updatePlanningSetting(project, { mode })
    },
    [updatePlanningSetting]
  )

  const handlePlanApprovalRequiredChange = useCallback(
    (project: Project, required: boolean) => {
      setPlanApprovalRequired(required)
      updatePlanningSetting(project, { approvalRequired: required })
    },
    [updatePlanningSetting]
  )

  return {
    planningEnabled,
    planningMode,
    planApprovalRequired,
    loadPlanningSettings,
    handlePlanningEnabledChange,
    handlePlanningModeChange,
    handlePlanApprovalRequiredChange
  }
}
