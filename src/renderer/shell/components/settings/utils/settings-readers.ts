/**
 * Settings Reader Functions
 *
 * Functions to read settings from project policy JSON with defaults
 */

import type { Project, PolicyConfig } from '@shared/types'
import { LINT_FIX_ATTEMPTS_DEFAULT } from '@shared/constants'
import type {
  ThinkingSettings,
  PlanningSettings,
  MultiAgentSettings,
  E2ESettings,
  UnitTestSettings,
  PreCommitSettings,
  NotificationsSettings,
  SyncSettings,
  WorkerPipelineSettings,
  ManualTestSettings,
  ProviderSwitchSettings
} from '../types'

export function readThinkingSettings(project: Project | null): ThinkingSettings {
  const defaults: ThinkingSettings = {
    enabled: true,
    mode: 'medium',
    budgetTokens: undefined
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy?.features?.thinking?.enabled ?? defaults.enabled,
      mode: policy?.features?.thinking?.mode ?? defaults.mode,
      budgetTokens: policy?.features?.thinking?.budgetTokens ?? defaults.budgetTokens
    }
  } catch {
    return defaults
  }
}

export function readPlanningSettings(project: Project | null): PlanningSettings {
  const defaults: PlanningSettings = {
    enabled: true,
    mode: 'lite',
    approvalRequired: false
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy?.features?.planning?.enabled ?? defaults.enabled,
      mode: policy?.features?.planning?.mode ?? defaults.mode,
      approvalRequired: policy?.features?.planning?.approvalRequired ?? defaults.approvalRequired
    }
  } catch {
    return defaults
  }
}

export function readMultiAgentSettings(project: Project | null): MultiAgentSettings {
  const defaults: MultiAgentSettings = {
    enabled: false,
    mergeStrategy: 'sequential',
    conflictResolution: 'auto',
    maxAgentsPerCard: undefined
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy?.features?.multiAgent?.enabled ?? defaults.enabled,
      mergeStrategy: policy?.features?.multiAgent?.mergeStrategy ?? defaults.mergeStrategy,
      conflictResolution:
        policy?.features?.multiAgent?.conflictResolution ?? defaults.conflictResolution,
      maxAgentsPerCard: policy?.features?.multiAgent?.maxAgentsPerCard ?? defaults.maxAgentsPerCard
    }
  } catch {
    return defaults
  }
}

export function readE2ESettings(project: Project | null): E2ESettings {
  const defaults: E2ESettings = {
    enabled: false,
    maxRetries: 3,
    timeoutMinutes: 10,
    createTestsIfMissing: true,
    testCommand: '',
    appType: 'auto',
    testPersistence: 'persistent',
    devServerCommand: '',
    devServerPort: null,
    baseUrl: ''
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy?.worker?.e2e?.enabled ?? defaults.enabled,
      maxRetries: policy?.worker?.e2e?.maxRetries ?? defaults.maxRetries,
      timeoutMinutes: policy?.worker?.e2e?.timeoutMinutes ?? defaults.timeoutMinutes,
      createTestsIfMissing:
        policy?.worker?.e2e?.createTestsIfMissing ?? defaults.createTestsIfMissing,
      testCommand: policy?.worker?.e2e?.testCommand ?? defaults.testCommand,
      appType: policy?.worker?.e2e?.appType ?? defaults.appType,
      testPersistence: policy?.worker?.e2e?.testPersistence ?? defaults.testPersistence,
      devServerCommand: policy?.worker?.e2e?.devServer?.startCommand ?? defaults.devServerCommand,
      devServerPort: policy?.worker?.e2e?.devServer?.port ?? defaults.devServerPort,
      baseUrl: policy?.worker?.e2e?.baseUrl ?? defaults.baseUrl
    }
  } catch {
    return defaults
  }
}

export function readUnitTestSettings(project: Project | null): UnitTestSettings {
  const defaults: UnitTestSettings = {
    enabled: false,
    command: '',
    runOnSave: false
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy?.worker?.unitTest?.enabled ?? defaults.enabled,
      command: policy?.worker?.unitTest?.command ?? defaults.command,
      runOnSave: policy?.worker?.unitTest?.runOnSave ?? defaults.runOnSave
    }
  } catch {
    return defaults
  }
}

export function readPreCommitSettings(project: Project | null): PreCommitSettings {
  const defaults: PreCommitSettings = {
    enabled: false,
    lint: true,
    test: true,
    typecheck: false
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy?.worker?.preCommit?.enabled ?? defaults.enabled,
      lint: policy?.worker?.preCommit?.lint ?? defaults.lint,
      test: policy?.worker?.preCommit?.test ?? defaults.test,
      typecheck: policy?.worker?.preCommit?.typecheck ?? defaults.typecheck
    }
  } catch {
    return defaults
  }
}

export function readNotificationsSettings(project: Project | null): NotificationsSettings {
  const defaults: NotificationsSettings = {
    audioEnabled: false,
    soundOnComplete: true,
    soundOnError: true,
    soundOnApproval: true
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      audioEnabled: policy?.features?.notifications?.audioEnabled ?? defaults.audioEnabled,
      soundOnComplete: policy?.features?.notifications?.soundOnComplete ?? defaults.soundOnComplete,
      soundOnError: policy?.features?.notifications?.soundOnError ?? defaults.soundOnError,
      soundOnApproval: policy?.features?.notifications?.soundOnApproval ?? defaults.soundOnApproval
    }
  } catch {
    return defaults
  }
}

export function readSyncSettings(project: Project | null): SyncSettings {
  const defaults: SyncSettings = {
    pollInterval: 180000,
    autoSyncOnAction: true
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      pollInterval: policy?.sync?.pollInterval ?? defaults.pollInterval,
      autoSyncOnAction: policy?.sync?.autoSyncOnAction ?? defaults.autoSyncOnAction
    }
  } catch {
    return defaults
  }
}

export function readWorkerPipelineSettings(project: Project | null): WorkerPipelineSettings {
  const defaults: WorkerPipelineSettings = {
    leaseRenewalIntervalMs: 60000,
    pipelineTimeoutMs: 30 * 60 * 1000, // 30 minutes
    maxRetries: 3,
    retryDelayMs: 1000,
    maxIterations: 3,
    lintCommand: '',
    lintFixAttempts: LINT_FIX_ATTEMPTS_DEFAULT,
    draftAiTimeoutSeconds: 300,
    // Phase toggles - all enabled by default
    enableInstallPhase: true,
    enableChecksPhase: true,
    // Individual check toggles (all enabled by default)
    enableLintCheck: true,
    enableTestCheck: true,
    enableBuildCheck: true,
    enableE2EPhase: true,
    enableDecompositionPhase: true,
    enablePlanPhase: true,
    enablePlanApprovalPhase: true,
    enableCommitPhase: true,
    enablePrPhase: true
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      leaseRenewalIntervalMs:
        policy?.worker?.leaseRenewalIntervalMs ?? defaults.leaseRenewalIntervalMs,
      pipelineTimeoutMs: policy?.worker?.pipelineTimeoutMs ?? defaults.pipelineTimeoutMs,
      maxRetries: policy?.worker?.maxRetries ?? defaults.maxRetries,
      retryDelayMs: policy?.worker?.retryDelayMs ?? defaults.retryDelayMs,
      maxIterations: policy?.worker?.session?.maxIterations ?? defaults.maxIterations,
      lintCommand: policy?.worker?.lintCommand ?? defaults.lintCommand,
      lintFixAttempts: policy?.worker?.lintFixAttempts ?? defaults.lintFixAttempts,
      draftAiTimeoutSeconds:
        policy?.worker?.draftAiTimeoutSeconds ?? defaults.draftAiTimeoutSeconds,
      // Phase toggles - undefined means enabled (true)
      enableInstallPhase: policy?.worker?.enableInstallPhase ?? defaults.enableInstallPhase,
      enableChecksPhase: policy?.worker?.enableChecksPhase ?? defaults.enableChecksPhase,
      // Individual check toggles - undefined means enabled (true)
      enableLintCheck: policy?.worker?.enableLintCheck ?? defaults.enableLintCheck,
      enableTestCheck: policy?.worker?.enableTestCheck ?? defaults.enableTestCheck,
      enableBuildCheck: policy?.worker?.enableBuildCheck ?? defaults.enableBuildCheck,
      enableE2EPhase: policy?.worker?.enableE2EPhase ?? defaults.enableE2EPhase,
      enableDecompositionPhase:
        policy?.worker?.enableDecompositionPhase ?? defaults.enableDecompositionPhase,
      enablePlanPhase: policy?.worker?.enablePlanPhase ?? defaults.enablePlanPhase,
      enablePlanApprovalPhase:
        policy?.worker?.enablePlanApprovalPhase ?? defaults.enablePlanApprovalPhase,
      enableCommitPhase: policy?.worker?.enableCommitPhase ?? defaults.enableCommitPhase,
      enablePrPhase: policy?.worker?.enablePrPhase ?? defaults.enablePrPhase
    }
  } catch {
    return defaults
  }
}

export function readToolPreference(project: Project | null): 'auto' | 'claude' | 'codex' | 'opencode' {
  if (!project?.policy_json) return 'auto'
  try {
    const policy = JSON.parse(project.policy_json)
    const pref = policy?.worker?.toolPreference
    if (pref === 'claude' || pref === 'codex' || pref === 'opencode' || pref === 'auto') {
      return pref
    }
    return 'auto'
  } catch {
    return 'auto'
  }
}

export function readRollbackOnCancel(project: Project | null): boolean {
  if (!project?.policy_json) return false
  try {
    const policy = JSON.parse(project.policy_json)
    return !!policy?.worker?.rollbackOnCancel
  } catch {
    return false
  }
}

export function readBaseBranch(project: Project | null): string {
  if (!project?.policy_json) return ''
  try {
    const policy = JSON.parse(project.policy_json)
    return (policy?.worker?.baseBranch || policy?.worker?.worktree?.baseBranch || '').trim()
  } catch {
    return ''
  }
}

export function readShowPullRequestsSection(project: Project | null): boolean {
  if (!project?.policy_json) return false
  try {
    const policy = JSON.parse(project.policy_json)
    return !!policy?.ui?.showPullRequestsSection
  } catch {
    return false
  }
}

export function readManualTestSettings(project: Project | null): ManualTestSettings {
  const defaults: ManualTestSettings = {
    autoPromptAfterAI: false,
    keepWorktreeForManualTest: false,
    defaultTestLocation: 'worktree'
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    const loc = policy?.worker?.manualTest?.defaultTestLocation
    return {
      autoPromptAfterAI: policy?.worker?.manualTest?.autoPromptAfterAI ?? defaults.autoPromptAfterAI,
      keepWorktreeForManualTest:
        policy?.worker?.manualTest?.keepWorktreeForManualTest ?? defaults.keepWorktreeForManualTest,
      defaultTestLocation:
        loc === 'worktree' || loc === 'mainRepo' ? loc : defaults.defaultTestLocation
    }
  } catch {
    return defaults
  }
}

export function readProviderSwitchSettings(project: Project | null): ProviderSwitchSettings {
  const defaults: ProviderSwitchSettings = {
    mode: 'automatic',
    exhaustedBehavior: 'pause_and_wait',
    retryIntervalMinutes: 5,
    maxWaitMinutes: 60,
    notifyOnSwitch: true
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    const ps = policy?.features?.providerSwitch
    const mode = ps?.mode
    const exhausted = ps?.exhaustedBehavior
    return {
      mode:
        mode === 'automatic' || mode === 'approval' || mode === 'disabled'
          ? mode
          : defaults.mode,
      exhaustedBehavior:
        exhausted === 'pause_and_wait' || exhausted === 'fail_immediately' || exhausted === 'queue_for_later'
          ? exhausted
          : defaults.exhaustedBehavior,
      retryIntervalMinutes: ps?.retryIntervalMinutes ?? defaults.retryIntervalMinutes,
      maxWaitMinutes: ps?.maxWaitMinutes ?? defaults.maxWaitMinutes,
      notifyOnSwitch: ps?.notifyOnSwitch ?? defaults.notifyOnSwitch
    }
  } catch {
    return defaults
  }
}
