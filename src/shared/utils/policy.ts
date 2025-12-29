/**
 * Policy parsing and manipulation utilities.
 */

import type { PolicyConfig, CardStatus } from '../types'
import { DEFAULT_POLICY } from '../types'

/**
 * Parse a policy JSON string, returning DEFAULT_POLICY if parsing fails.
 */
export function parsePolicyJson(json: string | null | undefined): PolicyConfig {
  if (!json) return DEFAULT_POLICY
  try {
    return JSON.parse(json) as PolicyConfig
  } catch {
    return DEFAULT_POLICY
  }
}

/**
 * Safely merge a partial policy update into an existing policy.
 */
export function mergePolicyUpdate(
  current: PolicyConfig,
  update: Partial<PolicyConfig>
): PolicyConfig {
  const merged: PolicyConfig = {
    ...current,
    version: update.version ?? current.version,
    ui: {
      ...current.ui,
      ...(update.ui || {})
    },
    repo: {
      ...current.repo,
      ...(update.repo || {})
    },
    sync: {
      ...current.sync,
      ...(update.sync || {}),
      statusLabels: {
        ...current.sync?.statusLabels,
        ...(update.sync?.statusLabels || {})
      },
      githubProjectsV2: {
        ...current.sync?.githubProjectsV2,
        ...(update.sync?.githubProjectsV2 || {})
      }
    },
    worker: {
      ...current.worker,
      ...(update.worker || {}),
      worktree: {
        ...current.worker?.worktree,
        ...(update.worker?.worktree || {}),
        cleanup: {
          ...current.worker?.worktree?.cleanup,
          ...(update.worker?.worktree?.cleanup || {})
        }
      }
    }
  }

  // Ensure pool has required fields
  if (merged.worker) {
    merged.worker.pool = {
      maxWorkers: update.worker?.pool?.maxWorkers ?? current.worker?.pool?.maxWorkers ?? 1,
      queueStrategy:
        update.worker?.pool?.queueStrategy ?? current.worker?.pool?.queueStrategy ?? 'fifo',
      priorityField: update.worker?.pool?.priorityField ?? current.worker?.pool?.priorityField
    }

    // Ensure decomposition has required fields
    merged.worker.decomposition = {
      enabled:
        update.worker?.decomposition?.enabled ?? current.worker?.decomposition?.enabled ?? false,
      threshold:
        update.worker?.decomposition?.threshold ??
        current.worker?.decomposition?.threshold ??
        'auto',
      createSubIssues:
        update.worker?.decomposition?.createSubIssues ??
        current.worker?.decomposition?.createSubIssues ??
        true,
      maxSubtasks:
        update.worker?.decomposition?.maxSubtasks ?? current.worker?.decomposition?.maxSubtasks ?? 5
    }

    // Ensure session has required fields
    merged.worker.session = {
      sessionMode:
        update.worker?.session?.sessionMode ?? current.worker?.session?.sessionMode ?? 'single',
      maxIterations:
        update.worker?.session?.maxIterations ?? current.worker?.session?.maxIterations ?? 5,
      progressCheckpoint:
        update.worker?.session?.progressCheckpoint ??
        current.worker?.session?.progressCheckpoint ??
        false,
      contextCarryover:
        update.worker?.session?.contextCarryover ??
        current.worker?.session?.contextCarryover ??
        'summary'
    }

    // Ensure e2e has required fields
    merged.worker.e2e = {
      enabled: update.worker?.e2e?.enabled ?? current.worker?.e2e?.enabled ?? false,
      framework: 'playwright',
      maxRetries: update.worker?.e2e?.maxRetries ?? current.worker?.e2e?.maxRetries ?? 3,
      timeoutMinutes:
        update.worker?.e2e?.timeoutMinutes ?? current.worker?.e2e?.timeoutMinutes ?? 10,
      createTestsIfMissing:
        update.worker?.e2e?.createTestsIfMissing ??
        current.worker?.e2e?.createTestsIfMissing ??
        true,
      testCommand: update.worker?.e2e?.testCommand ?? current.worker?.e2e?.testCommand,
      testDirectories:
        update.worker?.e2e?.testDirectories ??
        current.worker?.e2e?.testDirectories ??
        ['e2e', 'tests/e2e', 'test/e2e'],
      fixToolPriority: 'claude-first'
    }
  }

  return merged
}

/**
 * Get the status label for a given card status from policy.
 */
export function getStatusLabelFromPolicy(status: CardStatus, policy: PolicyConfig): string {
  const statusLabels = policy.sync?.statusLabels || {}
  const defaults: Record<CardStatus, string> = {
    draft: 'status::draft',
    ready: 'status::ready',
    in_progress: 'status::in-progress',
    in_review: 'status::in-review',
    testing: 'status::testing',
    done: 'status::done'
  }
  const keyMap: Record<CardStatus, keyof NonNullable<typeof statusLabels>> = {
    draft: 'draft',
    ready: 'ready',
    in_progress: 'inProgress',
    in_review: 'inReview',
    testing: 'testing',
    done: 'done'
  }
  return statusLabels[keyMap[status]] || defaults[status]
}

/**
 * Get all status labels from policy.
 */
export function getAllStatusLabelsFromPolicy(policy: PolicyConfig): string[] {
  const statusLabels = policy.sync?.statusLabels || {}
  return [
    statusLabels.draft || 'status::draft',
    statusLabels.ready || 'status::ready',
    statusLabels.inProgress || 'status::in-progress',
    statusLabels.inReview || 'status::in-review',
    statusLabels.testing || 'status::testing',
    statusLabels.done || 'status::done'
  ]
}

/**
 * Check if worker is enabled in policy.
 */
export function isWorkerEnabled(policy: PolicyConfig): boolean {
  return policy.worker?.enabled !== false
}

/**
 * Get the tool preference from policy.
 */
export function getToolPreference(policy: PolicyConfig): 'auto' | 'claude' | 'codex' {
  return policy.worker?.toolPreference ?? 'auto'
}
