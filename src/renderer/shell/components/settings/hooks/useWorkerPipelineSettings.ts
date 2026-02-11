/**
 * Worker Pipeline Settings Hook
 *
 * Manages worker pipeline configuration (timeouts, retries, lease renewal)
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { Project } from '@shared/types'
import { LINT_FIX_ATTEMPTS_MAX } from '@shared/constants'
import type { WorkerPipelineSettings } from '../types'
import { readWorkerPipelineSettings } from '../utils/settings-readers'

interface UseWorkerPipelineSettingsReturn {
  leaseRenewalInterval: number // in seconds
  pipelineTimeout: number // in minutes
  pipelineMaxRetries: number
  pipelineRetryDelay: number // in seconds
  maxIterations: number
  lintCommand: string
  lintFixAttempts: number
  draftAiTimeoutSeconds: number
  // Phase toggles
  enableInstallPhase: boolean
  enableChecksPhase: boolean
  // Individual check toggles
  enableLintCheck: boolean
  enableTestCheck: boolean
  enableBuildCheck: boolean
  enableE2EPhase: boolean
  enableDecompositionPhase: boolean
  enablePlanPhase: boolean
  enablePlanApprovalPhase: boolean
  enableCommitPhase: boolean
  enablePrPhase: boolean
  loadWorkerPipelineSettings: (project: Project) => void
  handleLeaseRenewalIntervalChange: (project: Project, seconds: number) => void
  handlePipelineTimeoutChange: (project: Project, minutes: number) => void
  handlePipelineMaxRetriesChange: (project: Project, retries: number) => void
  handlePipelineRetryDelayChange: (project: Project, seconds: number) => void
  handleMaxIterationsChange: (project: Project, iterations: number) => void
  handleLintCommandChange: (value: string) => void
  handleLintCommandBlur: (project: Project) => void
  handleLintFixAttemptsChange: (project: Project, attempts: number) => void
  handleDraftAiTimeoutChange: (project: Project, seconds: number) => void
  // Phase toggle handlers
  handlePhaseToggle: (project: Project, phase: string, enabled: boolean) => void
}

export function useWorkerPipelineSettings(): UseWorkerPipelineSettingsReturn {
  const [leaseRenewalInterval, setLeaseRenewalInterval] = useState(60)
  const [pipelineTimeout, setPipelineTimeout] = useState(30)
  const [pipelineMaxRetries, setPipelineMaxRetries] = useState(3)
  const [pipelineRetryDelay, setPipelineRetryDelay] = useState(1)
  const [maxIterations, setMaxIterations] = useState(3)
  const [lintCommand, setLintCommand] = useState('')
  const [lintFixAttempts, setLintFixAttempts] = useState(1)
  const [draftAiTimeoutSeconds, setDraftAiTimeoutSeconds] = useState(300)

  // Phase toggle states
  const [enableInstallPhase, setEnableInstallPhase] = useState(true)
  const [enableChecksPhase, setEnableChecksPhase] = useState(true)
  // Individual check toggle states
  const [enableLintCheck, setEnableLintCheck] = useState(true)
  const [enableTestCheck, setEnableTestCheck] = useState(true)
  const [enableBuildCheck, setEnableBuildCheck] = useState(true)
  const [enableE2EPhase, setEnableE2EPhase] = useState(true)
  const [enableDecompositionPhase, setEnableDecompositionPhase] = useState(true)
  const [enablePlanPhase, setEnablePlanPhase] = useState(true)
  const [enablePlanApprovalPhase, setEnablePlanApprovalPhase] = useState(true)
  const [enableCommitPhase, setEnableCommitPhase] = useState(true)
  const [enablePrPhase, setEnablePrPhase] = useState(true)

  const loadWorkerPipelineSettings = useCallback((project: Project) => {
    const settings = readWorkerPipelineSettings(project)
    setLeaseRenewalInterval(Math.round(settings.leaseRenewalIntervalMs / 1000))
    setPipelineTimeout(Math.round(settings.pipelineTimeoutMs / 60000))
    setPipelineMaxRetries(settings.maxRetries)
    setPipelineRetryDelay(Math.round(settings.retryDelayMs / 1000))
    setMaxIterations(settings.maxIterations)
    setLintCommand(settings.lintCommand)
    setLintFixAttempts(settings.lintFixAttempts)
    setDraftAiTimeoutSeconds(settings.draftAiTimeoutSeconds)
    // Phase toggles
    setEnableInstallPhase(settings.enableInstallPhase)
    setEnableChecksPhase(settings.enableChecksPhase)
    // Individual check toggles
    setEnableLintCheck(settings.enableLintCheck)
    setEnableTestCheck(settings.enableTestCheck)
    setEnableBuildCheck(settings.enableBuildCheck)
    setEnableE2EPhase(settings.enableE2EPhase)
    setEnableDecompositionPhase(settings.enableDecompositionPhase)
    setEnablePlanPhase(settings.enablePlanPhase)
    setEnablePlanApprovalPhase(settings.enablePlanApprovalPhase)
    setEnableCommitPhase(settings.enableCommitPhase)
    setEnablePrPhase(settings.enablePrPhase)
  }, [])

  const updateWorkerPipelineSetting = useCallback(
    async (project: Project, update: Partial<WorkerPipelineSettings>) => {
      try {
        const { maxIterations, ...workerSettings } = update

        // Construct policy update with nested session config if maxIterations is present
        const policyUpdate: any = { worker: workerSettings }
        if (maxIterations !== undefined) {
          policyUpdate.worker.session = { maxIterations }
        }

        await window.electron.ipcRenderer.invoke('updateProjectPolicy', {
          projectId: project.id,
          policy: policyUpdate
        })
        toast.success('Pipeline settings updated')
      } catch (err) {
        // Rollback state on error
        const pipeline = readWorkerPipelineSettings(project)
        setLeaseRenewalInterval(Math.round(pipeline.leaseRenewalIntervalMs / 1000))
        setPipelineTimeout(Math.round(pipeline.pipelineTimeoutMs / 60000))
        setPipelineMaxRetries(pipeline.maxRetries)
        setPipelineRetryDelay(Math.round(pipeline.retryDelayMs / 1000))
        setMaxIterations(pipeline.maxIterations)
        setLintCommand(pipeline.lintCommand)
        setLintFixAttempts(pipeline.lintFixAttempts)
        setDraftAiTimeoutSeconds(pipeline.draftAiTimeoutSeconds)
        // Rollback phase toggles
        setEnableInstallPhase(pipeline.enableInstallPhase)
        setEnableChecksPhase(pipeline.enableChecksPhase)
        // Rollback individual check toggles
        setEnableLintCheck(pipeline.enableLintCheck)
        setEnableTestCheck(pipeline.enableTestCheck)
        setEnableBuildCheck(pipeline.enableBuildCheck)
        setEnableE2EPhase(pipeline.enableE2EPhase)
        setEnableDecompositionPhase(pipeline.enableDecompositionPhase)
        setEnablePlanPhase(pipeline.enablePlanPhase)
        setEnablePlanApprovalPhase(pipeline.enablePlanApprovalPhase)
        setEnableCommitPhase(pipeline.enableCommitPhase)
        setEnablePrPhase(pipeline.enablePrPhase)

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

  const handleMaxIterationsChange = useCallback(
    (project: Project, iterations: number) => {
      const clamped = Math.max(1, Math.min(20, iterations))
      setMaxIterations(clamped)
      updateWorkerPipelineSetting(project, { maxIterations: clamped })
    },
    [updateWorkerPipelineSetting]
  )

  const handleLintCommandChange = useCallback((value: string) => {
    setLintCommand(value)
  }, [])

  const handleLintCommandBlur = useCallback(
    (project: Project) => {
      const trimmed = lintCommand.trim()
      updateWorkerPipelineSetting(project, { lintCommand: trimmed || undefined })
    },
    [lintCommand, updateWorkerPipelineSetting]
  )

  const handleLintFixAttemptsChange = useCallback(
    (project: Project, attempts: number) => {
      const clamped = Math.max(0, Math.min(LINT_FIX_ATTEMPTS_MAX, attempts))
      setLintFixAttempts(clamped)
      updateWorkerPipelineSetting(project, { lintFixAttempts: clamped })
    },
    [updateWorkerPipelineSetting]
  )

  const handleDraftAiTimeoutChange = useCallback(
    (project: Project, seconds: number) => {
      const clamped = Math.max(60, Math.min(1800, seconds))
      setDraftAiTimeoutSeconds(clamped)
      updateWorkerPipelineSetting(project, { draftAiTimeoutSeconds: clamped })
    },
    [updateWorkerPipelineSetting]
  )

  const handlePhaseToggle = useCallback(
    (project: Project, phase: string, enabled: boolean) => {
      // Update local state immediately
      switch (phase) {
        case 'enableInstallPhase':
          setEnableInstallPhase(enabled)
          break
        case 'enableChecksPhase':
          setEnableChecksPhase(enabled)
          break
        case 'enableLintCheck':
          setEnableLintCheck(enabled)
          break
        case 'enableTestCheck':
          setEnableTestCheck(enabled)
          break
        case 'enableBuildCheck':
          setEnableBuildCheck(enabled)
          break
        case 'enableE2EPhase':
          setEnableE2EPhase(enabled)
          break
        case 'enableDecompositionPhase':
          setEnableDecompositionPhase(enabled)
          break
        case 'enablePlanPhase':
          setEnablePlanPhase(enabled)
          break
        case 'enablePlanApprovalPhase':
          setEnablePlanApprovalPhase(enabled)
          break
        case 'enableCommitPhase':
          setEnableCommitPhase(enabled)
          break
        case 'enablePrPhase':
          setEnablePrPhase(enabled)
          break
      }
      // Update policy
      updateWorkerPipelineSetting(project, { [phase]: enabled })
    },
    [updateWorkerPipelineSetting]
  )

  return {
    leaseRenewalInterval,
    pipelineTimeout,
    pipelineMaxRetries,
    pipelineRetryDelay,
    maxIterations,
    lintCommand,
    lintFixAttempts,
    draftAiTimeoutSeconds,
    // Phase toggles
    enableInstallPhase,
    enableChecksPhase,
    // Individual check toggles
    enableLintCheck,
    enableTestCheck,
    enableBuildCheck,
    enableE2EPhase,
    enableDecompositionPhase,
    enablePlanPhase,
    enablePlanApprovalPhase,
    enableCommitPhase,
    enablePrPhase,
    loadWorkerPipelineSettings,
    handleLeaseRenewalIntervalChange,
    handlePipelineTimeoutChange,
    handlePipelineMaxRetriesChange,
    handlePipelineRetryDelayChange,
    handleMaxIterationsChange,
    handleLintCommandChange,
    handleLintCommandBlur,
    handleLintFixAttemptsChange,
    handleDraftAiTimeoutChange,
    handlePhaseToggle
  }
}
