/**
 * Settings Modal Type Definitions
 */

import type { ReactNode } from 'react'
import type {
  ThinkingMode,
  PlanningMode,
  MergeStrategy,
  ConflictResolution,
  AIModelProvider
} from '@shared/types'

// Section types
export type SettingsSection =
  | 'appearance'
  | 'features'
  | 'shortcuts'
  | 'ai-agents'
  | 'usage-limits'
  | 'danger-zone'
  | 'about'

export type ThemePreference = 'light' | 'dark' | 'system'
export type WorkerToolPreference = 'auto' | 'claude' | 'codex'

// Settings interfaces
export interface ThinkingSettings {
  enabled: boolean
  mode: ThinkingMode
  budgetTokens: number | undefined
}

export interface PlanningSettings {
  enabled: boolean
  mode: PlanningMode
  approvalRequired: boolean
}

export interface MultiAgentSettings {
  enabled: boolean
  mergeStrategy: MergeStrategy
  conflictResolution: ConflictResolution
  maxAgentsPerCard: number | undefined
}

export interface E2ESettings {
  enabled: boolean
  maxRetries: number
  timeoutMinutes: number
  createTestsIfMissing: boolean
  testCommand: string
}

export interface UnitTestSettings {
  enabled: boolean
  command: string
  runOnSave: boolean
}

export interface PreCommitSettings {
  enabled: boolean
  lint: boolean
  test: boolean
  typecheck: boolean
}

export interface NotificationsSettings {
  audioEnabled: boolean
  soundOnComplete: boolean
  soundOnError: boolean
  soundOnApproval: boolean
}

export interface SyncSettings {
  pollInterval: number
  autoSyncOnAction: boolean
}

export interface WorkerPipelineSettings {
  leaseRenewalIntervalMs: number
  pipelineTimeoutMs: number
  maxRetries: number
  retryDelayMs: number
}

export interface ToolLimitsState {
  hourlyTokenLimit: string
  dailyTokenLimit: string
  monthlyTokenLimit: string
  hourlyCostLimit: string
  dailyCostLimit: string
  monthlyCostLimit: string
}

// Profile form data type
export interface AIProfileFormData {
  name: string
  description: string
  modelProvider: AIModelProvider
  modelName: string
  temperature: string
  maxTokens: string
  topP: string
  systemPrompt: string
  thinkingEnabled: boolean
  thinkingMode: ThinkingMode
  thinkingBudgetTokens: string
  planningEnabled: boolean
  planningMode: PlanningMode
}

// Option types for UI components
export interface SelectOption<T extends string = string> {
  id: T
  title: string
  description: string
  icon: ReactNode
}

export interface ThinkingModeOption extends SelectOption<ThinkingMode> {
  tokens: string
}

// Section config type
export interface SectionConfig {
  id: SettingsSection
  label: string
  icon: React.ComponentType<{ className?: string }>
}
