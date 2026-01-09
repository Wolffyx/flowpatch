/**
 * Worker Pipeline Settings Hook
 *
 * Manages worker pipeline configuration (timeouts, retries, lease renewal)
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project } from '@shared/types'
import type { WorkerPipelineSettings } from '../types'
import { readWorkerPipelineSettings } from '../utils/settings-readers'

interface UseWorkerPipelineSettingsReturn {
  leaseRenewalInterval: number // in seconds
  pipelineTimeout: number // in minutes
  pipelineMaxRetries: number
  pipelineRetryDelay: number // in seconds
  loadWorkerPipelineSettings: (project: Project) => void
  handleLeaseRenewalIntervalChange: (project: Project, seconds: number) => void
  handlePipelineTimeoutChange: (project: Project, minutes: number) => void
  handlePipelineMaxRetriesChange: (project: Project, retries: number) => void
  handlePipelineRetryDelayChange: (project: Project, seconds: number) => void
}

export function useWorkerPipelineSettings(): UseWorkerPipelineSettingsReturn {
  const [leaseRenewalInterval, setLeaseRenewalInterval] = useState(60)
  const [pipelineTimeout, setPipelineTimeout] = useState(30)
  const [pipelineMaxRetries, setPipelineMaxRetries] = useState(3)
  const [pipelineRetryDelay, setPipelineRetryDelay] = useState(1)

  const loadWorkerPipelineSettings = useCallback((project: Project) => {
    const settings = readWorkerPipelineSettings(project)
    setLeaseRenewalInterval(Math.round(settings.leaseRenewalIntervalMs / 1000))
    setPipelineTimeout(Math.round(settings.pipelineTimeoutMs / 60000))
    setPipelineMaxRetries(settings.maxRetries)
    setPipelineRetryDelay(Math.round(settings.retryDelayMs / 1000))
  }, [])

  const updateWorkerPipelineSetting = useCallback(
    async (project: Project, update: Partial<WorkerPipelineSettings>) => {
      try {
        await window.electron.ipcRenderer.invoke('updateProjectPolicy', {
          projectId: project.id,
          policy: { worker: update }
        })
        toast.success('Pipeline settings updated')
      } catch (err) {
        // Rollback state on error
        const pipeline = readWorkerPipelineSettings(project)
        setLeaseRenewalInterval(Math.round(pipeline.leaseRenewalIntervalMs / 1000))
        setPipelineTimeout(Math.round(pipeline.pipelineTimeoutMs / 60000))
        setPipelineMaxRetries(pipeline.maxRetries)
        setPipelineRetryDelay(Math.round(pipeline.retryDelayMs / 1000))
        toast.error('Failed to update pipeline settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    []
  )

  const handleLeaseRenewalIntervalChange = useCallback(
    (project: Project, seconds: number) => {
      const clamped = Math.max(10, Math.min(300, seconds))
      setLeaseRenewalInterval(clamped)
      updateWorkerPipelineSetting(project, { leaseRenewalIntervalMs: clamped * 1000 })
    },
    [updateWorkerPipelineSetting]
  )

  const handlePipelineTimeoutChange = useCallback(
    (project: Project, minutes: number) => {
      const clamped = Math.max(5, Math.min(120, minutes))
      setPipelineTimeout(clamped)
      updateWorkerPipelineSetting(project, { pipelineTimeoutMs: clamped * 60000 })
    },
    [updateWorkerPipelineSetting]
  )

  const handlePipelineMaxRetriesChange = useCallback(
    (project: Project, retries: number) => {
      const clamped = Math.max(0, Math.min(10, retries))
      setPipelineMaxRetries(clamped)
      updateWorkerPipelineSetting(project, { maxRetries: clamped })
    },
    [updateWorkerPipelineSetting]
  )

  const handlePipelineRetryDelayChange = useCallback(
    (project: Project, seconds: number) => {
      const clamped = Math.max(1, Math.min(30, seconds))
      setPipelineRetryDelay(clamped)
      updateWorkerPipelineSetting(project, { retryDelayMs: clamped * 1000 })
    },
    [updateWorkerPipelineSetting]
  )

  return {
    leaseRenewalInterval,
    pipelineTimeout,
    pipelineMaxRetries,
    pipelineRetryDelay,
    loadWorkerPipelineSettings,
    handleLeaseRenewalIntervalChange,
    handlePipelineTimeoutChange,
    handlePipelineMaxRetriesChange,
    handlePipelineRetryDelayChange
  }
}
