/**
 * Policy parsing and manipulation utilities.
 */

import type {
  PolicyConfig,
  CardStatus,
  FeaturesConfig,
  ThinkingConfig,
  PlanningConfig,
  MultiAgentConfig,
  ChatConfig,
  NotificationsConfig,
  DiffViewerConfig,
  GraphViewConfig,
  UsageTrackingConfig,
  ImagesConfig,
  AIProfilesConfig,
  FeatureSuggestionsConfig,
  DependenciesConfig,
  FollowUpInstructionsConfig
} from '../types'
import { DEFAULT_POLICY } from '../types'

// ============================================================================
// Policy Cache
// ============================================================================

interface CachedPolicy {
  policy: PolicyConfig
  hash: string
  cachedAt: number
}

const POLICY_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_POLICY_CACHE_SIZE = 100

const policyCache = new Map<string, CachedPolicy>()

/**
 * Simple hash function for cache keys.
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return hash.toString(36)
}

/**
 * Evict oldest entries if cache is full.
 */
function evictOldestCache(): void {
  if (policyCache.size < MAX_POLICY_CACHE_SIZE) return

  let oldestKey: string | null = null
  let oldestTime = Infinity

  for (const [key, entry] of policyCache) {
    if (entry.cachedAt < oldestTime) {
      oldestTime = entry.cachedAt
      oldestKey = key
    }
  }

  if (oldestKey) {
    policyCache.delete(oldestKey)
  }
}

/**
 * Get policy from cache if valid.
 */
function getCachedPolicy(json: string): PolicyConfig | null {
  const hash = simpleHash(json)
  const cached = policyCache.get(hash)

  if (!cached) return null

  // Check TTL
  if (Date.now() - cached.cachedAt > POLICY_CACHE_TTL_MS) {
    policyCache.delete(hash)
    return null
  }

  return cached.policy
}

/**
 * Cache a parsed policy.
 */
function cachePolicy(json: string, policy: PolicyConfig): void {
  evictOldestCache()

  const hash = simpleHash(json)
  policyCache.set(hash, {
    policy,
    hash,
    cachedAt: Date.now()
  })
}

/**
 * Clear the policy cache.
 */
export function clearPolicyCache(): void {
  policyCache.clear()
}

/**
 * Get policy cache stats.
 */
export function getPolicyCacheStats(): { size: number; maxSize: number } {
  return {
    size: policyCache.size,
    maxSize: MAX_POLICY_CACHE_SIZE
  }
}

// ============================================================================
// Policy Validation
// ============================================================================

export interface PolicyValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate a policy configuration.
 */
export function validatePolicy(policy: PolicyConfig): PolicyValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check version
  if (typeof policy.version !== 'number') {
    errors.push('Policy version must be a number')
  }

  // Validate worker config
  if (policy.worker) {
    if (policy.worker.maxMinutes !== undefined) {
      if (typeof policy.worker.maxMinutes !== 'number' || policy.worker.maxMinutes <= 0) {
        errors.push('worker.maxMinutes must be a positive number')
      }
      if (policy.worker.maxMinutes > 120) {
        warnings.push('worker.maxMinutes > 120 may cause long-running jobs')
      }
    }

    if (policy.worker.pool?.maxWorkers !== undefined) {
      if (typeof policy.worker.pool.maxWorkers !== 'number' || policy.worker.pool.maxWorkers <= 0) {
        errors.push('worker.pool.maxWorkers must be a positive number')
      }
      if (policy.worker.pool.maxWorkers > 8) {
        warnings.push('worker.pool.maxWorkers > 8 may cause resource contention')
      }
    }

    if (policy.worker.leaseRenewalIntervalMs !== undefined) {
      if (typeof policy.worker.leaseRenewalIntervalMs !== 'number' || policy.worker.leaseRenewalIntervalMs < 10000) {
        errors.push('worker.leaseRenewalIntervalMs must be at least 10000ms')
      }
    }

    if (policy.worker.pipelineTimeoutMs !== undefined) {
      if (typeof policy.worker.pipelineTimeoutMs !== 'number' || policy.worker.pipelineTimeoutMs < 60000) {
        errors.push('worker.pipelineTimeoutMs must be at least 60000ms (1 minute)')
      }
    }
  }

  // Validate sync config
  if (policy.sync?.statusLabels) {
    const labels = policy.sync.statusLabels
    const labelValues = Object.values(labels).filter(Boolean)
    const uniqueLabels = new Set(labelValues)
    if (labelValues.length !== uniqueLabels.size) {
      warnings.push('Duplicate status labels detected - this may cause confusion')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

// ============================================================================
// Policy Parsing
// ============================================================================

/**
 * Parse a policy JSON string, returning DEFAULT_POLICY if parsing fails.
 * Uses caching to avoid repeated parsing of the same JSON.
 */
export function parsePolicyJson(json: string | null | undefined): PolicyConfig {
  if (!json) return DEFAULT_POLICY

  // Check cache first
  const cached = getCachedPolicy(json)
  if (cached) return cached

  try {
    const policy = JSON.parse(json) as PolicyConfig
    cachePolicy(json, policy)
    return policy
  } catch {
    return DEFAULT_POLICY
  }
}

/**
 * Parse and validate a policy JSON string.
 * Returns the policy and validation results.
 */
export function parsePolicyJsonWithValidation(
  json: string | null | undefined
): { policy: PolicyConfig; validation: PolicyValidationResult } {
  const policy = parsePolicyJson(json)
  const validation = validatePolicy(policy)
  return { policy, validation }
}

/**
 * Merge features config with deep merging for each feature.
 */
function mergeFeaturesConfig(
  current: FeaturesConfig | undefined,
  update: FeaturesConfig | undefined
): FeaturesConfig {
  const defaults = DEFAULT_POLICY.features!

  return {
    thinking: mergeFeature<ThinkingConfig>(current?.thinking, update?.thinking, defaults.thinking!),
    planning: mergeFeature<PlanningConfig>(current?.planning, update?.planning, defaults.planning!),
    multiAgent: mergeFeature<MultiAgentConfig>(
      current?.multiAgent,
      update?.multiAgent,
      defaults.multiAgent!
    ),
    chat: mergeFeature<ChatConfig>(current?.chat, update?.chat, defaults.chat!),
    notifications: mergeFeature<NotificationsConfig>(
      current?.notifications,
      update?.notifications,
      defaults.notifications!
    ),
    diffViewer: mergeFeature<DiffViewerConfig>(
      current?.diffViewer,
      update?.diffViewer,
      defaults.diffViewer!
    ),
    graphView: mergeFeature<GraphViewConfig>(
      current?.graphView,
      update?.graphView,
      defaults.graphView!
    ),
    usageTracking: mergeFeature<UsageTrackingConfig>(
      current?.usageTracking,
      update?.usageTracking,
      defaults.usageTracking!
    ),
    images: mergeFeature<ImagesConfig>(current?.images, update?.images, defaults.images!),
    aiProfiles: mergeFeature<AIProfilesConfig>(
      current?.aiProfiles,
      update?.aiProfiles,
      defaults.aiProfiles!
    ),
    featureSuggestions: mergeFeature<FeatureSuggestionsConfig>(
      current?.featureSuggestions,
      update?.featureSuggestions,
      defaults.featureSuggestions!
    ),
    dependencies: mergeFeature<DependenciesConfig>(
      current?.dependencies,
      update?.dependencies,
      defaults.dependencies!
    ),
    followUpInstructions: mergeFeature<FollowUpInstructionsConfig>(
      current?.followUpInstructions,
      update?.followUpInstructions,
      defaults.followUpInstructions!
    )
  }
}

/**
 * Merge a single feature config with defaults.
 */
function mergeFeature<T extends object>(
  current: T | undefined,
  update: T | undefined,
  defaults: T
): T {
  return {
    ...defaults,
    ...(current || {}),
    ...(update || {})
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
    features: mergeFeaturesConfig(current.features, update.features),
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
    draft: 'Draft',
    ready: 'Ready',
    in_progress: 'In Progress',
    in_review: 'In Review',
    testing: 'Testing',
    done: 'Done'
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
    statusLabels.draft || 'Draft',
    statusLabels.ready || 'Ready',
    statusLabels.inProgress || 'In Progress',
    statusLabels.inReview || 'In Review',
    statusLabels.testing || 'Testing',
    statusLabels.done || 'Done'
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
export function getToolPreference(policy: PolicyConfig): 'auto' | 'claude' | 'codex' | 'opencode' | 'cursor' {
  return policy.worker?.toolPreference ?? 'auto'
}
