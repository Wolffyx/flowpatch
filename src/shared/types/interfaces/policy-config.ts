import type { WorktreeRoot, WorktreeCleanupTiming } from './worktree'
import type { WorkerPoolConfig } from './worker-pool'
import type { TaskDecompositionConfig } from './task-decomposition'
import type { AISessionConfig } from './ai-session'
import type { E2ETestConfig } from './e2e-test'
import type { UnitTestConfig } from './unit-test'
import type { PreCommitConfig } from './pre-commit'
import type { FeaturesConfig } from './feature-config'

export interface PolicyConfig {
  version: number
  ui?: {
    showPullRequestsSection?: boolean
  }
  repo?: {
    provider?: 'auto' | 'github' | 'gitlab'
    gitlab?: {
      host?: string
    }
    gitAuth?: {
      mode?: 'auto' | 'ssh' | 'https' | 'gh_cli' | 'glab_cli'
      forceSshRewrite?: boolean
      preferredHost?: string | null
    }
  }
  sync?: {
    webhookPreferred?: boolean
    pollingFallbackMinutes?: number
    readyLabel?: string
    statusLabels?: {
      draft?: string
      ready?: string
      inProgress?: string
      inReview?: string
      testing?: string
      failed?: string
      done?: string
    }
    githubProjectsV2?: {
      enabled?: boolean
      projectId?: string
      statusFieldName?: string
      statusValues?: {
        draft?: string
        ready?: string
        inProgress?: string
        inReview?: string
        testing?: string
        failed?: string
        done?: string
      }
    }
    configPriority?: ConfigSyncPriority
    syncOnStartup?: boolean
    watchFileChanges?: boolean
    pollInterval?: number
    autoSyncOnAction?: boolean
    debounceDelay?: number
  }
  features?: FeaturesConfig
  worker?: {
    enabled?: boolean
    toolPreference?: 'auto' | 'claude' | 'codex' | 'opencode' | 'cursor'
    planFirst?: boolean
    maxMinutes?: number
    allowNetwork?: boolean
    rollbackOnCancel?: boolean
    branchPattern?: string
    baseBranch?: string
    commitMessage?: string
    allowedCommands?: string[]
    installCommand?: string
    lintCommand?: string
    /** When lint fails, how many times to run the AI to fix (0 = disable). Capped at LINT_FIX_ATTEMPTS_MAX. */
    lintFixAttempts?: number
    testCommand?: string
    buildCommand?: string
    forbidPaths?: string[]
    /** Timeout for draft AI operations (description, starter cards, split cards) in seconds */
    draftAiTimeoutSeconds?: number
    leaseRenewalIntervalMs?: number
    pipelineTimeoutMs?: number
    maxRetries?: number
    retryDelayMs?: number
    worktree?: {
      enabled?: boolean
      root?: WorktreeRoot
      customPath?: string
      baseBranch?: string
      branchPrefix?: string
      cleanup?: {
        onSuccess?: WorktreeCleanupTiming
        onFailure?: WorktreeCleanupTiming
        delayMinutes?: number
      }
      maxConcurrent?: number
      skipInstallIfCached?: boolean
    }
    pool?: WorkerPoolConfig
    decomposition?: TaskDecompositionConfig
    session?: AISessionConfig
    e2e?: E2ETestConfig
    unitTest?: UnitTestConfig
    preCommit?: PreCommitConfig
    manualTest?: {
      /** Show notification prompting user to test after AI phase completes */
      autoPromptAfterAI?: boolean
      /** Keep worktree alive for manual testing (overrides cleanup policy) */
      keepWorktreeForManualTest?: boolean
      /** Default location for testing: worktree (isolated) or mainRepo */
      defaultTestLocation?: 'worktree' | 'mainRepo'
    }

    // Phase toggles - all default to true (enabled) when undefined
    /** Enable/disable install dependencies phase */
    enableInstallPhase?: boolean
    /** Enable/disable checks phase (lint, test, build) - master toggle */
    enableChecksPhase?: boolean
    /** Enable/disable lint check (requires enableChecksPhase) */
    enableLintCheck?: boolean
    /** Enable/disable test check (requires enableChecksPhase) */
    enableTestCheck?: boolean
    /** Enable/disable build check (requires enableChecksPhase) */
    enableBuildCheck?: boolean
    /** Enable/disable E2E testing phase (also requires e2e.enabled) */
    enableE2EPhase?: boolean
    /** Enable/disable task decomposition phase (also requires decomposition.enabled) */
    enableDecompositionPhase?: boolean
    /** Enable/disable plan generation phase */
    enablePlanPhase?: boolean
    /** Enable/disable plan approval phase (also requires features.planning.approvalRequired) */
    enablePlanApprovalPhase?: boolean
    /** Enable/disable commit & push phase. When disabled, changes remain in working tree. */
    enableCommitPhase?: boolean
    /** Enable/disable PR/MR creation phase. When disabled with commit enabled, branch is pushed but no PR created. */
    enablePrPhase?: boolean
  }
}

import type { ConfigSyncPriority } from './feature-config'
