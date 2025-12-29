/**
 * Configuration Sync Service
 *
 * Handles bidirectional synchronization between:
 * - Database (projects.policy_json) - PolicyConfig
 * - YAML file (.patchwork/config.yml) - PatchworkConfig
 *
 * User can choose which source has priority (database or file).
 */

import { existsSync, writeFileSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import YAML from 'yaml'
import type { PolicyConfig, ConfigSyncPriority, FeaturesConfig } from '../../shared/types'
import { DEFAULT_POLICY } from '../../shared/types'
import { parsePolicyJson, mergePolicyUpdate } from '../../shared/utils/policy'
import {
  readPatchworkConfig,
  type PatchworkConfig,
  type PatchworkFeaturesConfig
} from './patchwork-config'
import { getProject, updateProjectPolicyJson } from '../db/projects'

export interface ConfigSyncResult {
  success: boolean
  source: 'database' | 'file' | 'merged'
  policy: PolicyConfig
  diagnostics: {
    errors: string[]
    warnings: string[]
  }
}

/**
 * Convert PatchworkFeaturesConfig (YAML) to FeaturesConfig (PolicyConfig).
 * Uses DEFAULT_POLICY values as fallbacks for required fields.
 */
function yamlFeaturesToPolicyFeatures(
  yamlFeatures: PatchworkFeaturesConfig | undefined
): FeaturesConfig | undefined {
  if (!yamlFeatures) return undefined

  const defaults = DEFAULT_POLICY.features!
  const features: FeaturesConfig = {}

  if (yamlFeatures.thinking) {
    features.thinking = {
      enabled: yamlFeatures.thinking.enabled ?? defaults.thinking!.enabled,
      mode: yamlFeatures.thinking.defaultMode ?? defaults.thinking!.mode,
      budgetTokens: yamlFeatures.thinking.budgetTokens ?? defaults.thinking!.budgetTokens
    }
  }
  if (yamlFeatures.planning) {
    features.planning = {
      enabled: yamlFeatures.planning.enabled ?? defaults.planning!.enabled,
      mode: yamlFeatures.planning.defaultMode ?? defaults.planning!.mode,
      approvalRequired: defaults.planning!.approvalRequired
    }
  }
  if (yamlFeatures.multiAgent) {
    features.multiAgent = {
      enabled: yamlFeatures.multiAgent.enabled ?? defaults.multiAgent!.enabled,
      mergeStrategy: yamlFeatures.multiAgent.mergeStrategy ?? defaults.multiAgent!.mergeStrategy,
      conflictResolution:
        yamlFeatures.multiAgent.conflictResolution ?? defaults.multiAgent!.conflictResolution,
      maxAgentsPerCard:
        yamlFeatures.multiAgent.maxAgents ?? defaults.multiAgent!.maxAgentsPerCard
    }
  }
  if (yamlFeatures.chat) {
    features.chat = {
      enabled: yamlFeatures.chat.enabled ?? defaults.chat!.enabled,
      persistSessions: defaults.chat!.persistSessions,
      maxHistoryMessages:
        yamlFeatures.chat.maxHistoryMessages ?? defaults.chat!.maxHistoryMessages
    }
  }
  if (yamlFeatures.notifications) {
    features.notifications = {
      audioEnabled: yamlFeatures.notifications.enabled ?? defaults.notifications!.audioEnabled,
      soundOnComplete: yamlFeatures.notifications.soundEnabled ?? defaults.notifications!.soundOnComplete,
      soundOnError: defaults.notifications!.soundOnError,
      soundOnApproval: defaults.notifications!.soundOnApproval
    }
  }
  if (yamlFeatures.diffViewer) {
    features.diffViewer = {
      enabled: yamlFeatures.diffViewer.enabled ?? defaults.diffViewer!.enabled,
      defaultView: yamlFeatures.diffViewer.defaultMode ?? defaults.diffViewer!.defaultView,
      showMinimap: defaults.diffViewer!.showMinimap
    }
  }
  if (yamlFeatures.graphView) {
    features.graphView = {
      enabled: yamlFeatures.graphView.enabled ?? defaults.graphView!.enabled,
      defaultLayout: yamlFeatures.graphView.defaultLayout ?? defaults.graphView!.defaultLayout,
      showMinimap: defaults.graphView!.showMinimap
    }
  }
  if (yamlFeatures.usageTracking) {
    features.usageTracking = {
      enabled: yamlFeatures.usageTracking.enabled ?? defaults.usageTracking!.enabled,
      trackCosts: yamlFeatures.usageTracking.trackCosts ?? defaults.usageTracking!.trackCosts,
      exportFormat: yamlFeatures.usageTracking.exportFormat ?? defaults.usageTracking!.exportFormat
    }
  }
  if (yamlFeatures.images) {
    features.images = {
      enabled: yamlFeatures.images.enabled ?? defaults.images!.enabled,
      maxSizeMb: yamlFeatures.images.maxSizeMB ?? defaults.images!.maxSizeMb,
      allowedFormats: yamlFeatures.images.allowedFormats ?? defaults.images!.allowedFormats
    }
  }
  if (yamlFeatures.aiProfiles) {
    features.aiProfiles = {
      enabled: yamlFeatures.aiProfiles.enabled ?? defaults.aiProfiles!.enabled,
      defaultProfileId: defaults.aiProfiles!.defaultProfileId
    }
  }
  if (yamlFeatures.featureSuggestions) {
    features.featureSuggestions = {
      enabled: yamlFeatures.featureSuggestions.enabled ?? defaults.featureSuggestions!.enabled,
      autoSuggestOnAnalysis:
        yamlFeatures.featureSuggestions.autoSuggest ??
        defaults.featureSuggestions!.autoSuggestOnAnalysis
    }
  }
  if (yamlFeatures.dependencies) {
    features.dependencies = {
      enabled: yamlFeatures.dependencies.enabled ?? defaults.dependencies!.enabled,
      blockOnIncomplete: defaults.dependencies!.blockOnIncomplete,
      showInKanban: yamlFeatures.dependencies.showOutdated ?? defaults.dependencies!.showInKanban
    }
  }
  if (yamlFeatures.followUpInstructions) {
    features.followUpInstructions = {
      enabled: yamlFeatures.followUpInstructions.enabled ?? defaults.followUpInstructions!.enabled,
      maxQueueSize:
        yamlFeatures.followUpInstructions.maxInstructions ??
        defaults.followUpInstructions!.maxQueueSize
    }
  }

  return Object.keys(features).length > 0 ? features : undefined
}

/**
 * Convert FeaturesConfig (PolicyConfig) to PatchworkFeaturesConfig (YAML).
 * Maps between the different field names used in each format.
 */
function policyFeaturesToYamlFeatures(
  policyFeatures: FeaturesConfig | undefined
): PatchworkFeaturesConfig | undefined {
  if (!policyFeatures) return undefined

  const features: PatchworkFeaturesConfig = {}

  if (policyFeatures.thinking) {
    features.thinking = {
      enabled: policyFeatures.thinking.enabled,
      defaultMode: policyFeatures.thinking.mode,
      budgetTokens: policyFeatures.thinking.budgetTokens
    }
  }
  if (policyFeatures.planning) {
    features.planning = {
      enabled: policyFeatures.planning.enabled,
      defaultMode: policyFeatures.planning.mode
    }
  }
  if (policyFeatures.multiAgent) {
    features.multiAgent = {
      enabled: policyFeatures.multiAgent.enabled,
      mergeStrategy: policyFeatures.multiAgent.mergeStrategy,
      conflictResolution: policyFeatures.multiAgent.conflictResolution,
      maxAgents: policyFeatures.multiAgent.maxAgentsPerCard
    }
  }
  if (policyFeatures.chat) {
    features.chat = {
      enabled: policyFeatures.chat.enabled,
      maxHistoryMessages: policyFeatures.chat.maxHistoryMessages
    }
  }
  if (policyFeatures.notifications) {
    features.notifications = {
      enabled: policyFeatures.notifications.audioEnabled,
      soundEnabled: policyFeatures.notifications.soundOnComplete
    }
  }
  if (policyFeatures.diffViewer) {
    features.diffViewer = {
      enabled: policyFeatures.diffViewer.enabled,
      defaultMode: policyFeatures.diffViewer.defaultView
    }
  }
  if (policyFeatures.graphView) {
    features.graphView = {
      enabled: policyFeatures.graphView.enabled,
      defaultLayout: policyFeatures.graphView.defaultLayout
    }
  }
  if (policyFeatures.usageTracking) {
    features.usageTracking = {
      enabled: policyFeatures.usageTracking.enabled,
      trackCosts: policyFeatures.usageTracking.trackCosts,
      exportFormat: policyFeatures.usageTracking.exportFormat
    }
  }
  if (policyFeatures.images) {
    features.images = {
      enabled: policyFeatures.images.enabled,
      maxSizeMB: policyFeatures.images.maxSizeMb,
      allowedFormats: policyFeatures.images.allowedFormats
    }
  }
  if (policyFeatures.aiProfiles) {
    features.aiProfiles = {
      enabled: policyFeatures.aiProfiles.enabled
    }
  }
  if (policyFeatures.featureSuggestions) {
    features.featureSuggestions = {
      enabled: policyFeatures.featureSuggestions.enabled,
      autoSuggest: policyFeatures.featureSuggestions.autoSuggestOnAnalysis
    }
  }
  if (policyFeatures.dependencies) {
    features.dependencies = {
      enabled: policyFeatures.dependencies.enabled,
      showOutdated: policyFeatures.dependencies.showInKanban
    }
  }
  if (policyFeatures.followUpInstructions) {
    features.followUpInstructions = {
      enabled: policyFeatures.followUpInstructions.enabled,
      maxInstructions: policyFeatures.followUpInstructions.maxQueueSize
    }
  }

  return Object.keys(features).length > 0 ? features : undefined
}

/**
 * Convert PatchworkConfig to partial PolicyConfig for merging.
 * Uses DEFAULT_POLICY values as fallbacks for required fields.
 */
function yamlConfigToPolicyUpdate(yamlConfig: PatchworkConfig): Partial<PolicyConfig> {
  const update: Partial<PolicyConfig> = {}
  const defaults = DEFAULT_POLICY

  // Map sync config
  if (yamlConfig.sync) {
    update.sync = {
      configPriority: yamlConfig.sync.configPriority,
      syncOnStartup: yamlConfig.sync.syncOnStartup,
      watchFileChanges: yamlConfig.sync.watchFileChanges
    }
  }

  // Map features config
  const features = yamlFeaturesToPolicyFeatures(yamlConfig.features)
  if (features) {
    update.features = features
  }

  // Map e2e config to worker.e2e
  if (yamlConfig.e2e) {
    const defaultE2e = defaults.worker!.e2e!
    update.worker = {
      e2e: {
        enabled: yamlConfig.e2e.enabled ?? defaultE2e.enabled,
        framework: yamlConfig.e2e.framework ?? defaultE2e.framework,
        maxRetries: yamlConfig.e2e.maxRetries ?? defaultE2e.maxRetries,
        timeoutMinutes: yamlConfig.e2e.timeoutMinutes ?? defaultE2e.timeoutMinutes,
        createTestsIfMissing: yamlConfig.e2e.createTestsIfMissing ?? defaultE2e.createTestsIfMissing,
        testCommand: yamlConfig.e2e.testCommand ?? defaultE2e.testCommand,
        testDirectories: yamlConfig.e2e.testDirectories ?? defaultE2e.testDirectories,
        fixToolPriority: defaultE2e.fixToolPriority
      }
    }
  }

  return update
}

/**
 * Convert PolicyConfig to PatchworkConfig for YAML export.
 */
function policyToYamlConfig(policy: PolicyConfig): PatchworkConfig {
  const e2eConfig = policy.worker?.e2e
  return {
    schemaVersion: 2, // New schema version for features support
    generatedBy: 'patchwork-config-sync',
    budgets: {
      maxFiles: 12,
      maxLinesPerFile: 200,
      maxTotalLines: 1200,
      maxTotalBytes: 250000
    },
    sync: policy.sync
      ? {
          configPriority: policy.sync.configPriority,
          syncOnStartup: policy.sync.syncOnStartup,
          watchFileChanges: policy.sync.watchFileChanges
        }
      : undefined,
    features: policyFeaturesToYamlFeatures(policy.features),
    e2e: e2eConfig
      ? {
          enabled: e2eConfig.enabled,
          framework: 'playwright' as const,
          maxRetries: e2eConfig.maxRetries,
          timeoutMinutes: e2eConfig.timeoutMinutes,
          createTestsIfMissing: e2eConfig.createTestsIfMissing,
          testCommand: e2eConfig.testCommand,
          testDirectories: e2eConfig.testDirectories
        }
      : undefined
  }
}

/**
 * Sync configuration for a project.
 * Returns the merged/prioritized config based on settings.
 */
export function syncProjectConfig(
  projectId: string,
  repoRoot: string,
  priorityOverride?: ConfigSyncPriority
): ConfigSyncResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Load from database
  const project = getProject(projectId)
  const dbPolicy = project ? parsePolicyJson(project.policy_json) : DEFAULT_POLICY

  // Determine priority (from override, then db config, then default)
  const priority = priorityOverride ?? dbPolicy.sync?.configPriority ?? 'database'

  // Load from YAML file
  const { config: yamlConfig, diagnostics: yamlDiags } = readPatchworkConfig(repoRoot)
  errors.push(...yamlDiags.errors)
  warnings.push(...yamlDiags.warnings)

  // Convert YAML config to policy update
  const yamlUpdate = yamlConfigToPolicyUpdate(yamlConfig)

  let finalPolicy: PolicyConfig
  let source: 'database' | 'file' | 'merged'

  if (priority === 'database') {
    // Database takes priority - merge YAML on top of defaults, then DB on top
    const withYaml = mergePolicyUpdate(DEFAULT_POLICY, yamlUpdate)
    finalPolicy = mergePolicyUpdate(withYaml, dbPolicy)
    source = 'database'

    // Write merged config back to YAML file
    writeConfigToYaml(repoRoot, finalPolicy)
  } else {
    // File takes priority - merge DB on top of defaults, then YAML on top
    finalPolicy = mergePolicyUpdate(dbPolicy, yamlUpdate)
    source = 'file'

    // Write merged config back to database
    updateProjectPolicyJson(projectId, JSON.stringify(finalPolicy))
  }

  return {
    success: errors.length === 0,
    source,
    policy: finalPolicy,
    diagnostics: { errors, warnings }
  }
}

/**
 * Write configuration to YAML file.
 */
export function writeConfigToYaml(repoRoot: string, policy: PolicyConfig): boolean {
  try {
    const configDir = join(repoRoot, '.patchwork')
    const configPath = join(configDir, 'config.yml')

    // Ensure .patchwork directory exists
    if (!existsSync(configDir)) {
      return false // Don't create directory, just skip
    }

    const yamlConfig = policyToYamlConfig(policy)

    // Clean up undefined values for cleaner YAML
    const cleanedConfig = JSON.parse(JSON.stringify(yamlConfig))

    const yamlContent = YAML.stringify(cleanedConfig, {
      indent: 2,
      lineWidth: 120
    })

    writeFileSync(configPath, yamlContent, 'utf-8')
    return true
  } catch {
    return false
  }
}

/**
 * Update a specific feature configuration.
 */
export function updateFeatureConfig<K extends keyof FeaturesConfig>(
  projectId: string,
  repoRoot: string,
  featureKey: K,
  config: Partial<FeaturesConfig[K]>
): ConfigSyncResult {
  const project = getProject(projectId)
  const currentPolicy = project ? parsePolicyJson(project.policy_json) : DEFAULT_POLICY

  const update: Partial<PolicyConfig> = {
    features: {
      ...currentPolicy.features,
      [featureKey]: {
        ...(currentPolicy.features?.[featureKey] || {}),
        ...config
      }
    }
  }

  const newPolicy = mergePolicyUpdate(currentPolicy, update)

  // Save to database
  updateProjectPolicyJson(projectId, JSON.stringify(newPolicy))

  // Sync to YAML if enabled
  const shouldSync = newPolicy.sync?.watchFileChanges !== false
  if (shouldSync) {
    writeConfigToYaml(repoRoot, newPolicy)
  }

  return {
    success: true,
    source: 'database',
    policy: newPolicy,
    diagnostics: { errors: [], warnings: [] }
  }
}

/**
 * Get configuration sync priority for a project.
 */
export function getConfigSyncPriority(projectId: string): ConfigSyncPriority {
  const project = getProject(projectId)
  if (!project) return 'database'
  const policy = parsePolicyJson(project.policy_json)
  return policy.sync?.configPriority ?? 'database'
}

/**
 * Set configuration sync priority for a project.
 */
export function setConfigSyncPriority(
  projectId: string,
  repoRoot: string,
  priority: ConfigSyncPriority
): ConfigSyncResult {
  const project = getProject(projectId)
  const currentPolicy = project ? parsePolicyJson(project.policy_json) : DEFAULT_POLICY

  const update: Partial<PolicyConfig> = {
    sync: {
      ...currentPolicy.sync,
      configPriority: priority
    }
  }

  const newPolicy = mergePolicyUpdate(currentPolicy, update)

  // Save to database
  updateProjectPolicyJson(projectId, JSON.stringify(newPolicy))

  // Sync to YAML
  writeConfigToYaml(repoRoot, newPolicy)

  return {
    success: true,
    source: 'database',
    policy: newPolicy,
    diagnostics: { errors: [], warnings: [] }
  }
}

// File watcher management
const watchers = new Map<string, FSWatcher>()

/**
 * Start watching a project's config file for changes.
 */
export function startConfigFileWatcher(
  projectId: string,
  repoRoot: string,
  onConfigChange: (result: ConfigSyncResult) => void
): boolean {
  const configPath = join(repoRoot, '.patchwork', 'config.yml')

  if (!existsSync(configPath)) {
    return false
  }

  // Stop existing watcher if any
  stopConfigFileWatcher(projectId)

  try {
    const watcher = watch(configPath, { persistent: false }, (eventType) => {
      if (eventType === 'change') {
        // Debounce: wait a bit for file to be fully written
        setTimeout(() => {
          const result = syncProjectConfig(projectId, repoRoot, 'file')
          onConfigChange(result)
        }, 100)
      }
    })

    watchers.set(projectId, watcher)
    return true
  } catch {
    return false
  }
}

/**
 * Stop watching a project's config file.
 */
export function stopConfigFileWatcher(projectId: string): void {
  const watcher = watchers.get(projectId)
  if (watcher) {
    watcher.close()
    watchers.delete(projectId)
  }
}

/**
 * Stop all config file watchers.
 */
export function stopAllConfigFileWatchers(): void {
  for (const [projectId] of watchers) {
    stopConfigFileWatcher(projectId)
  }
}

/**
 * Get the current configuration for a project (from database).
 */
export function getProjectConfig(projectId: string): PolicyConfig {
  const project = getProject(projectId)
  return project ? parsePolicyJson(project.policy_json) : DEFAULT_POLICY
}
