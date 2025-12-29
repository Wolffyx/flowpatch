import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import YAML from 'yaml'
import type {
  ThinkingMode,
  PlanningMode,
  MergeStrategy,
  ConflictResolution,
  ConfigSyncPriority,
  DiffViewMode,
  GraphLayout,
  UsageExportFormat
} from '../../shared/types'

export type PrivacyMode = 'strict' | 'standard' | 'off'

export interface PatchworkBudgets {
  maxFiles: number
  maxLinesPerFile: number
  maxTotalLines: number
  maxTotalBytes?: number
}

export interface PatchworkPrivacyOverride {
  mode?: PrivacyMode
  denyCategories?: string[]
  allowGlobs?: string[]
  denyGlobs?: string[]
}

export interface PatchworkE2EConfig {
  enabled?: boolean
  framework?: 'playwright'
  maxRetries?: number
  timeoutMinutes?: number
  createTestsIfMissing?: boolean
  testCommand?: string
  testDirectories?: string[]
}

// Feature configuration interfaces for YAML
export interface PatchworkThinkingConfig {
  enabled?: boolean
  defaultMode?: ThinkingMode
  budgetTokens?: number
  showInUI?: boolean
}

export interface PatchworkPlanningConfig {
  enabled?: boolean
  defaultMode?: PlanningMode
  autoSaveSpecs?: boolean
  specsDirectory?: string
}

export interface PatchworkMultiAgentConfig {
  enabled?: boolean
  maxAgents?: number
  mergeStrategy?: MergeStrategy
  conflictResolution?: ConflictResolution
  showAgentActivity?: boolean
}

export interface PatchworkChatConfig {
  enabled?: boolean
  maxHistoryMessages?: number
  streamResponses?: boolean
  showTimestamps?: boolean
}

export interface PatchworkNotificationsConfig {
  enabled?: boolean
  showToasts?: boolean
  soundEnabled?: boolean
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
}

export interface PatchworkDiffViewerConfig {
  enabled?: boolean
  defaultMode?: DiffViewMode
  syntaxHighlighting?: boolean
  lineNumbers?: boolean
  wordWrap?: boolean
}

export interface PatchworkGraphViewConfig {
  enabled?: boolean
  defaultLayout?: GraphLayout
  showLabels?: boolean
  animateTransitions?: boolean
}

export interface PatchworkUsageTrackingConfig {
  enabled?: boolean
  trackTokens?: boolean
  trackCosts?: boolean
  exportFormat?: UsageExportFormat
  retentionDays?: number
}

export interface PatchworkImagesConfig {
  enabled?: boolean
  maxSizeMB?: number
  allowedFormats?: string[]
  compressionQuality?: number
}

export interface PatchworkAIProfilesConfig {
  enabled?: boolean
  maxProfiles?: number
  allowCustomInstructions?: boolean
}

export interface PatchworkFeatureSuggestionsConfig {
  enabled?: boolean
  autoSuggest?: boolean
  maxSuggestions?: number
}

export interface PatchworkDependenciesConfig {
  enabled?: boolean
  autoDetect?: boolean
  showOutdated?: boolean
}

export interface PatchworkFollowUpInstructionsConfig {
  enabled?: boolean
  maxInstructions?: number
  persistAcrossSessions?: boolean
}

export interface PatchworkSyncConfig {
  configPriority?: ConfigSyncPriority
  syncOnStartup?: boolean
  watchFileChanges?: boolean
}

export interface PatchworkFeaturesConfig {
  thinking?: PatchworkThinkingConfig
  planning?: PatchworkPlanningConfig
  multiAgent?: PatchworkMultiAgentConfig
  chat?: PatchworkChatConfig
  notifications?: PatchworkNotificationsConfig
  diffViewer?: PatchworkDiffViewerConfig
  graphView?: PatchworkGraphViewConfig
  usageTracking?: PatchworkUsageTrackingConfig
  images?: PatchworkImagesConfig
  aiProfiles?: PatchworkAIProfilesConfig
  featureSuggestions?: PatchworkFeatureSuggestionsConfig
  dependencies?: PatchworkDependenciesConfig
  followUpInstructions?: PatchworkFollowUpInstructionsConfig
}

export interface PatchworkConfig {
  schemaVersion: number
  generatedBy?: string
  budgets: PatchworkBudgets
  privacy?: PatchworkPrivacyOverride
  workspaces?: string[]
  approval?: {
    confirmIndexBuild?: boolean
    confirmIndexRefresh?: boolean
    confirmWatchToggle?: boolean
    confirmDocsRefresh?: boolean
    confirmContextPreview?: boolean
    confirmRepair?: boolean
    confirmMigrate?: boolean
  }
  e2e?: PatchworkE2EConfig
  sync?: PatchworkSyncConfig
  features?: PatchworkFeaturesConfig
}

export interface PatchworkConfigDiagnostics {
  errors: string[]
  warnings: string[]
}

export const DEFAULT_BUDGETS: PatchworkBudgets = {
  maxFiles: 12,
  maxLinesPerFile: 200,
  maxTotalLines: 1200,
  maxTotalBytes: 250_000
}

export function readPatchworkConfig(repoRoot: string): {
  config: PatchworkConfig
  diagnostics: PatchworkConfigDiagnostics
} {
  const errors: string[] = []
  const warnings: string[] = []

  const configPath = join(repoRoot, '.patchwork', 'config.yml')
  if (!existsSync(configPath)) {
    warnings.push('Missing .patchwork/config.yml; using defaults')
    return {
      config: { schemaVersion: 1, budgets: { ...DEFAULT_BUDGETS } },
      diagnostics: { errors, warnings }
    }
  }

  let parsed: any
  try {
    parsed = YAML.parse(readFileSync(configPath, 'utf-8'))
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Failed to parse YAML')
    return {
      config: { schemaVersion: 1, budgets: { ...DEFAULT_BUDGETS } },
      diagnostics: { errors, warnings }
    }
  }

  const schemaVersion = Number(parsed?.schemaVersion ?? 1)
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
    warnings.push('Invalid schemaVersion; using 1')
  }

  const budgetsRaw = parsed?.budgets ?? {}
  const budgets: PatchworkBudgets = {
    maxFiles: Number(budgetsRaw.maxFiles ?? DEFAULT_BUDGETS.maxFiles),
    maxLinesPerFile: Number(budgetsRaw.maxLinesPerFile ?? DEFAULT_BUDGETS.maxLinesPerFile),
    maxTotalLines: Number(budgetsRaw.maxTotalLines ?? DEFAULT_BUDGETS.maxTotalLines),
    maxTotalBytes:
      budgetsRaw.maxTotalBytes != null
        ? Number(budgetsRaw.maxTotalBytes)
        : DEFAULT_BUDGETS.maxTotalBytes
  }

  if (!Number.isFinite(budgets.maxFiles) || budgets.maxFiles <= 0)
    errors.push('budgets.maxFiles must be > 0')
  if (!Number.isFinite(budgets.maxLinesPerFile) || budgets.maxLinesPerFile <= 0)
    errors.push('budgets.maxLinesPerFile must be > 0')
  if (!Number.isFinite(budgets.maxTotalLines) || budgets.maxTotalLines <= 0)
    errors.push('budgets.maxTotalLines must be > 0')
  if (
    budgets.maxTotalBytes != null &&
    (!Number.isFinite(budgets.maxTotalBytes) || budgets.maxTotalBytes <= 0)
  ) {
    errors.push('budgets.maxTotalBytes must be > 0')
  }

  let privacy: PatchworkPrivacyOverride | undefined
  if (parsed?.privacy && typeof parsed.privacy === 'object') {
    const mode = parsed.privacy.mode as PrivacyMode | undefined
    if (mode && mode !== 'strict' && mode !== 'standard' && mode !== 'off') {
      warnings.push('privacy.mode must be strict|standard|off; ignoring')
    }
    privacy = {
      mode: mode === 'strict' || mode === 'standard' || mode === 'off' ? mode : undefined,
      denyCategories: Array.isArray(parsed.privacy.denyCategories)
        ? parsed.privacy.denyCategories.map(String)
        : undefined,
      allowGlobs: Array.isArray(parsed.privacy.allowGlobs)
        ? parsed.privacy.allowGlobs.map(String)
        : undefined,
      denyGlobs: Array.isArray(parsed.privacy.denyGlobs)
        ? parsed.privacy.denyGlobs.map(String)
        : undefined
    }
  }

  const workspaces = Array.isArray(parsed?.workspaces)
    ? parsed.workspaces.map(String).filter(Boolean)
    : undefined

  const approvalRaw = parsed?.approval
  const approval =
    approvalRaw && typeof approvalRaw === 'object'
      ? {
          confirmIndexBuild:
            typeof approvalRaw.confirmIndexBuild === 'boolean'
              ? approvalRaw.confirmIndexBuild
              : true,
          confirmIndexRefresh:
            typeof approvalRaw.confirmIndexRefresh === 'boolean'
              ? approvalRaw.confirmIndexRefresh
              : true,
          confirmWatchToggle:
            typeof approvalRaw.confirmWatchToggle === 'boolean'
              ? approvalRaw.confirmWatchToggle
              : true,
          confirmDocsRefresh:
            typeof approvalRaw.confirmDocsRefresh === 'boolean'
              ? approvalRaw.confirmDocsRefresh
              : true,
          confirmContextPreview:
            typeof approvalRaw.confirmContextPreview === 'boolean'
              ? approvalRaw.confirmContextPreview
              : true,
          confirmRepair:
            typeof approvalRaw.confirmRepair === 'boolean' ? approvalRaw.confirmRepair : true,
          confirmMigrate:
            typeof approvalRaw.confirmMigrate === 'boolean' ? approvalRaw.confirmMigrate : true
        }
      : {
          confirmIndexBuild: true,
          confirmIndexRefresh: true,
          confirmWatchToggle: true,
          confirmDocsRefresh: true,
          confirmContextPreview: true,
          confirmRepair: true,
          confirmMigrate: true
        }

  // Parse E2E configuration
  let e2e: PatchworkE2EConfig | undefined
  if (parsed?.e2e && typeof parsed.e2e === 'object') {
    e2e = {
      enabled: typeof parsed.e2e.enabled === 'boolean' ? parsed.e2e.enabled : undefined,
      framework: parsed.e2e.framework === 'playwright' ? 'playwright' : undefined,
      maxRetries:
        typeof parsed.e2e.maxRetries === 'number' && parsed.e2e.maxRetries > 0
          ? parsed.e2e.maxRetries
          : undefined,
      timeoutMinutes:
        typeof parsed.e2e.timeoutMinutes === 'number' && parsed.e2e.timeoutMinutes > 0
          ? parsed.e2e.timeoutMinutes
          : undefined,
      createTestsIfMissing:
        typeof parsed.e2e.createTestsIfMissing === 'boolean'
          ? parsed.e2e.createTestsIfMissing
          : undefined,
      testCommand:
        typeof parsed.e2e.testCommand === 'string' ? parsed.e2e.testCommand : undefined,
      testDirectories: Array.isArray(parsed.e2e.testDirectories)
        ? parsed.e2e.testDirectories.map(String).filter(Boolean)
        : undefined
    }
  }

  // Parse sync configuration
  let sync: PatchworkSyncConfig | undefined
  if (parsed?.sync && typeof parsed.sync === 'object') {
    const priority = parsed.sync.configPriority
    sync = {
      configPriority:
        priority === 'database' || priority === 'file' ? priority : undefined,
      syncOnStartup:
        typeof parsed.sync.syncOnStartup === 'boolean' ? parsed.sync.syncOnStartup : undefined,
      watchFileChanges:
        typeof parsed.sync.watchFileChanges === 'boolean' ? parsed.sync.watchFileChanges : undefined
    }
  }

  // Parse features configuration
  let features: PatchworkFeaturesConfig | undefined
  if (parsed?.features && typeof parsed.features === 'object') {
    features = parseFeatures(parsed.features, warnings)
  }

  return {
    config: {
      schemaVersion: Number.isFinite(schemaVersion) && schemaVersion >= 1 ? schemaVersion : 1,
      generatedBy: typeof parsed?.generatedBy === 'string' ? parsed.generatedBy : undefined,
      budgets,
      privacy,
      workspaces,
      approval,
      e2e,
      sync,
      features
    },
    diagnostics: { errors, warnings }
  }
}

/**
 * Parse features configuration from YAML with validation.
 */
function parseFeatures(raw: any, warnings: string[]): PatchworkFeaturesConfig {
  const features: PatchworkFeaturesConfig = {}

  // Parse thinking config
  if (raw.thinking && typeof raw.thinking === 'object') {
    const mode = raw.thinking.defaultMode
    const validModes = ['none', 'medium', 'deep', 'ultra']
    if (mode && !validModes.includes(mode)) {
      warnings.push(`features.thinking.defaultMode must be one of ${validModes.join('|')}; ignoring`)
    }
    features.thinking = {
      enabled: typeof raw.thinking.enabled === 'boolean' ? raw.thinking.enabled : undefined,
      defaultMode: validModes.includes(mode) ? mode : undefined,
      budgetTokens:
        typeof raw.thinking.budgetTokens === 'number' && raw.thinking.budgetTokens > 0
          ? raw.thinking.budgetTokens
          : undefined,
      showInUI: typeof raw.thinking.showInUI === 'boolean' ? raw.thinking.showInUI : undefined
    }
  }

  // Parse planning config
  if (raw.planning && typeof raw.planning === 'object') {
    const mode = raw.planning.defaultMode
    const validModes = ['skip', 'lite', 'spec', 'full']
    if (mode && !validModes.includes(mode)) {
      warnings.push(`features.planning.defaultMode must be one of ${validModes.join('|')}; ignoring`)
    }
    features.planning = {
      enabled: typeof raw.planning.enabled === 'boolean' ? raw.planning.enabled : undefined,
      defaultMode: validModes.includes(mode) ? mode : undefined,
      autoSaveSpecs:
        typeof raw.planning.autoSaveSpecs === 'boolean' ? raw.planning.autoSaveSpecs : undefined,
      specsDirectory:
        typeof raw.planning.specsDirectory === 'string' ? raw.planning.specsDirectory : undefined
    }
  }

  // Parse multiAgent config
  if (raw.multiAgent && typeof raw.multiAgent === 'object') {
    const strategy = raw.multiAgent.mergeStrategy
    const resolution = raw.multiAgent.conflictResolution
    features.multiAgent = {
      enabled: typeof raw.multiAgent.enabled === 'boolean' ? raw.multiAgent.enabled : undefined,
      maxAgents:
        typeof raw.multiAgent.maxAgents === 'number' && raw.multiAgent.maxAgents > 0
          ? raw.multiAgent.maxAgents
          : undefined,
      mergeStrategy:
        strategy === 'sequential' || strategy === 'parallel-merge' ? strategy : undefined,
      conflictResolution: resolution === 'auto' || resolution === 'manual' ? resolution : undefined,
      showAgentActivity:
        typeof raw.multiAgent.showAgentActivity === 'boolean'
          ? raw.multiAgent.showAgentActivity
          : undefined
    }
  }

  // Parse chat config
  if (raw.chat && typeof raw.chat === 'object') {
    features.chat = {
      enabled: typeof raw.chat.enabled === 'boolean' ? raw.chat.enabled : undefined,
      maxHistoryMessages:
        typeof raw.chat.maxHistoryMessages === 'number' && raw.chat.maxHistoryMessages > 0
          ? raw.chat.maxHistoryMessages
          : undefined,
      streamResponses:
        typeof raw.chat.streamResponses === 'boolean' ? raw.chat.streamResponses : undefined,
      showTimestamps:
        typeof raw.chat.showTimestamps === 'boolean' ? raw.chat.showTimestamps : undefined
    }
  }

  // Parse notifications config
  if (raw.notifications && typeof raw.notifications === 'object') {
    const pos = raw.notifications.position
    const validPositions = ['top-right', 'top-left', 'bottom-right', 'bottom-left']
    features.notifications = {
      enabled:
        typeof raw.notifications.enabled === 'boolean' ? raw.notifications.enabled : undefined,
      showToasts:
        typeof raw.notifications.showToasts === 'boolean' ? raw.notifications.showToasts : undefined,
      soundEnabled:
        typeof raw.notifications.soundEnabled === 'boolean'
          ? raw.notifications.soundEnabled
          : undefined,
      position: validPositions.includes(pos) ? pos : undefined
    }
  }

  // Parse diffViewer config
  if (raw.diffViewer && typeof raw.diffViewer === 'object') {
    const mode = raw.diffViewer.defaultMode
    features.diffViewer = {
      enabled: typeof raw.diffViewer.enabled === 'boolean' ? raw.diffViewer.enabled : undefined,
      defaultMode: mode === 'side-by-side' || mode === 'inline' ? mode : undefined,
      syntaxHighlighting:
        typeof raw.diffViewer.syntaxHighlighting === 'boolean'
          ? raw.diffViewer.syntaxHighlighting
          : undefined,
      lineNumbers:
        typeof raw.diffViewer.lineNumbers === 'boolean' ? raw.diffViewer.lineNumbers : undefined,
      wordWrap: typeof raw.diffViewer.wordWrap === 'boolean' ? raw.diffViewer.wordWrap : undefined
    }
  }

  // Parse graphView config
  if (raw.graphView && typeof raw.graphView === 'object') {
    const layout = raw.graphView.defaultLayout
    features.graphView = {
      enabled: typeof raw.graphView.enabled === 'boolean' ? raw.graphView.enabled : undefined,
      defaultLayout: layout === 'dagre' || layout === 'force' ? layout : undefined,
      showLabels:
        typeof raw.graphView.showLabels === 'boolean' ? raw.graphView.showLabels : undefined,
      animateTransitions:
        typeof raw.graphView.animateTransitions === 'boolean'
          ? raw.graphView.animateTransitions
          : undefined
    }
  }

  // Parse usageTracking config
  if (raw.usageTracking && typeof raw.usageTracking === 'object') {
    const format = raw.usageTracking.exportFormat
    features.usageTracking = {
      enabled:
        typeof raw.usageTracking.enabled === 'boolean' ? raw.usageTracking.enabled : undefined,
      trackTokens:
        typeof raw.usageTracking.trackTokens === 'boolean'
          ? raw.usageTracking.trackTokens
          : undefined,
      trackCosts:
        typeof raw.usageTracking.trackCosts === 'boolean' ? raw.usageTracking.trackCosts : undefined,
      exportFormat: format === 'csv' || format === 'json' ? format : undefined,
      retentionDays:
        typeof raw.usageTracking.retentionDays === 'number' && raw.usageTracking.retentionDays > 0
          ? raw.usageTracking.retentionDays
          : undefined
    }
  }

  // Parse images config
  if (raw.images && typeof raw.images === 'object') {
    features.images = {
      enabled: typeof raw.images.enabled === 'boolean' ? raw.images.enabled : undefined,
      maxSizeMB:
        typeof raw.images.maxSizeMB === 'number' && raw.images.maxSizeMB > 0
          ? raw.images.maxSizeMB
          : undefined,
      allowedFormats: Array.isArray(raw.images.allowedFormats)
        ? raw.images.allowedFormats.map(String).filter(Boolean)
        : undefined,
      compressionQuality:
        typeof raw.images.compressionQuality === 'number' &&
        raw.images.compressionQuality >= 0 &&
        raw.images.compressionQuality <= 100
          ? raw.images.compressionQuality
          : undefined
    }
  }

  // Parse aiProfiles config
  if (raw.aiProfiles && typeof raw.aiProfiles === 'object') {
    features.aiProfiles = {
      enabled: typeof raw.aiProfiles.enabled === 'boolean' ? raw.aiProfiles.enabled : undefined,
      maxProfiles:
        typeof raw.aiProfiles.maxProfiles === 'number' && raw.aiProfiles.maxProfiles > 0
          ? raw.aiProfiles.maxProfiles
          : undefined,
      allowCustomInstructions:
        typeof raw.aiProfiles.allowCustomInstructions === 'boolean'
          ? raw.aiProfiles.allowCustomInstructions
          : undefined
    }
  }

  // Parse featureSuggestions config
  if (raw.featureSuggestions && typeof raw.featureSuggestions === 'object') {
    features.featureSuggestions = {
      enabled:
        typeof raw.featureSuggestions.enabled === 'boolean'
          ? raw.featureSuggestions.enabled
          : undefined,
      autoSuggest:
        typeof raw.featureSuggestions.autoSuggest === 'boolean'
          ? raw.featureSuggestions.autoSuggest
          : undefined,
      maxSuggestions:
        typeof raw.featureSuggestions.maxSuggestions === 'number' &&
        raw.featureSuggestions.maxSuggestions > 0
          ? raw.featureSuggestions.maxSuggestions
          : undefined
    }
  }

  // Parse dependencies config
  if (raw.dependencies && typeof raw.dependencies === 'object') {
    features.dependencies = {
      enabled:
        typeof raw.dependencies.enabled === 'boolean' ? raw.dependencies.enabled : undefined,
      autoDetect:
        typeof raw.dependencies.autoDetect === 'boolean' ? raw.dependencies.autoDetect : undefined,
      showOutdated:
        typeof raw.dependencies.showOutdated === 'boolean'
          ? raw.dependencies.showOutdated
          : undefined
    }
  }

  // Parse followUpInstructions config
  if (raw.followUpInstructions && typeof raw.followUpInstructions === 'object') {
    features.followUpInstructions = {
      enabled:
        typeof raw.followUpInstructions.enabled === 'boolean'
          ? raw.followUpInstructions.enabled
          : undefined,
      maxInstructions:
        typeof raw.followUpInstructions.maxInstructions === 'number' &&
        raw.followUpInstructions.maxInstructions > 0
          ? raw.followUpInstructions.maxInstructions
          : undefined,
      persistAcrossSessions:
        typeof raw.followUpInstructions.persistAcrossSessions === 'boolean'
          ? raw.followUpInstructions.persistAcrossSessions
          : undefined
    }
  }

  return features
}
