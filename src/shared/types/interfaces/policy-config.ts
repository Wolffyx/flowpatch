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
    testCommand?: string
    buildCommand?: string
    forbidPaths?: string[]
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
  }
}

import type { ConfigSyncPriority } from './feature-config'
