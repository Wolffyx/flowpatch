export type MergeStrategy = 'sequential' | 'parallel-merge'
export type ConflictResolution = 'auto' | 'manual'
export type ConfigSyncPriority = 'database' | 'file'
export type DiffViewMode = 'side-by-side' | 'inline'
export type GraphLayout = 'dagre' | 'force'
export type UsageExportFormat = 'csv' | 'json'

export type ThinkingMode = 'none' | 'medium' | 'deep' | 'ultra'
export type PlanningMode = 'skip' | 'lite' | 'spec' | 'full'

export interface ThinkingConfig {
  enabled: boolean
  mode: ThinkingMode
  budgetTokens?: number
}

export interface PlanningConfig {
  enabled: boolean
  mode: PlanningMode
  approvalRequired: boolean
}

export interface MultiAgentConfig {
  enabled: boolean
  mergeStrategy: MergeStrategy
  conflictResolution: ConflictResolution
  maxAgentsPerCard?: number
}

export interface ChatConfig {
  enabled: boolean
  persistSessions: boolean
  maxHistoryMessages: number
}

export interface NotificationsConfig {
  audioEnabled: boolean
  soundOnComplete: boolean
  soundOnError: boolean
  soundOnApproval: boolean
}

export interface DiffViewerConfig {
  enabled: boolean
  defaultView: DiffViewMode
  showMinimap: boolean
}

export interface GraphViewConfig {
  enabled: boolean
  defaultLayout: GraphLayout
  showMinimap: boolean
}

export interface UsageTrackingConfig {
  enabled: boolean
  trackCosts: boolean
  exportFormat: UsageExportFormat
}

export interface ImagesConfig {
  enabled: boolean
  maxSizeMb: number
  allowedFormats: string[]
}

export interface AIProfilesConfig {
  enabled: boolean
  defaultProfileId?: string
}

export interface FeatureSuggestionsConfig {
  enabled: boolean
  autoSuggestOnAnalysis: boolean
}

export interface DependenciesConfig {
  enabled: boolean
  blockOnIncomplete: boolean
  showInKanban: boolean
}

export interface FollowUpInstructionsConfig {
  enabled: boolean
  maxQueueSize: number
}

export interface ProviderSwitchConfig {
  /** How to handle mid-execution limit hits. Default: 'automatic' */
  mode: 'automatic' | 'approval' | 'disabled'
  /** What to do when ALL providers are exhausted. Default: 'pause_and_wait' */
  exhaustedBehavior: 'pause_and_wait' | 'fail_immediately' | 'queue_for_later'
  /** Minutes to wait before retrying (for pause_and_wait). Default: 5 */
  retryIntervalMinutes: number
  /** Maximum total wait time in minutes before giving up. Default: 60 */
  maxWaitMinutes: number
  /** Show notification when provider switch occurs. Default: true */
  notifyOnSwitch: boolean
}

export interface FeaturesConfig {
  thinking?: ThinkingConfig
  planning?: PlanningConfig
  multiAgent?: MultiAgentConfig
  chat?: ChatConfig
  notifications?: NotificationsConfig
  diffViewer?: DiffViewerConfig
  graphView?: GraphViewConfig
  usageTracking?: UsageTrackingConfig
  images?: ImagesConfig
  aiProfiles?: AIProfilesConfig
  featureSuggestions?: FeatureSuggestionsConfig
  dependencies?: DependenciesConfig
  followUpInstructions?: FollowUpInstructionsConfig
  providerSwitch?: ProviderSwitchConfig
}
