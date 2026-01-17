/**
 * Settings Store with layered resolution.
 *
 * This module implements a three-tier settings system:
 * 1. App defaults (hardcoded)
 * 2. User defaults (persisted, shared across projects)
 * 3. Project overrides (persisted, per-project)
 *
 * Resolution order: projectOverride → userDefault → appDefault
 *
 * Storage format uses prefixed keys in app_settings table:
 * - 'defaults:{key}' for user defaults
 * - 'project:{projectKey}:{key}' for project overrides
 */

import { deleteAppSetting, getAppSetting, setAppSetting } from './db'

// ============================================================================
// App Defaults (Hardcoded)
// ============================================================================

/**
 * Hardcoded application defaults.
 * These are used when no user default or project override is set.
 */
export const APP_DEFAULTS: Record<string, string> = {
  // Sync settings
  'sync.autoSync': 'true',
  'sync.pollIntervalMinutes': '3',

  // Indexing settings
  'index.autoIndexingEnabled': 'false',

  // Worker settings
  'worker.enabled': 'true',
  'worker.toolPreference': 'auto',
  'worker.maxMinutes': '25',
  'worker.planFirst': 'true',
  'worker.enableTestMode': 'false',

  // UI settings
  'ui.showPullRequestsSection': 'false',
  'ui.logsMaxLines': '500',

  // Log settings
  'logs.maxEntries': '5000',
  'logs.persistEnabled': 'false',
  'logs.exportIncludeDiskWhenEnabled': 'true'
}

// ============================================================================
// User Defaults (Shared across projects)
// ============================================================================

const DEFAULTS_PREFIX = 'defaults:'

/**
 * Get a user default setting.
 * Returns null if not set.
 */
export function getDefault(key: string): string | null {
  return getAppSetting(`${DEFAULTS_PREFIX}${key}`)
}

/**
 * Set a user default setting.
 */
export function setDefault(key: string, value: string): void {
  setAppSetting(`${DEFAULTS_PREFIX}${key}`, value)
}

/**
 * Remove a user default setting.
 */
export function clearDefault(key: string): void {
  deleteAppSetting(`${DEFAULTS_PREFIX}${key}`)
}

/**
 * Get all user defaults as an object.
 */
export function getAllDefaults(): Record<string, string> {
  // This would require a new DB function to list all settings with prefix
  // For now, return empty - can be implemented when needed
  return {}
}

// ============================================================================
// Project Overrides (Per-project settings)
// ============================================================================

const PROJECT_PREFIX = 'project:'

/**
 * Build the storage key for a project override.
 */
function projectKey(projectKey: string, settingKey: string): string {
  return `${PROJECT_PREFIX}${projectKey}:${settingKey}`
}

/**
 * Get a project-specific override.
 * Returns null if not set.
 */
export function getProjectOverride(projKey: string, key: string): string | null {
  return getAppSetting(projectKey(projKey, key))
}

/**
 * Set a project-specific override.
 */
export function setProjectOverride(projKey: string, key: string, value: string): void {
  setAppSetting(projectKey(projKey, key), value)
}

/**
 * Clear a project-specific override.
 */
export function clearProjectOverride(projKey: string, key: string): void {
  deleteAppSetting(projectKey(projKey, key))
}

/**
 * Clear all overrides for a project.
 */
export function clearAllProjectOverrides(projKey: string): void {
  // Would need a bulk delete function
  void projKey
}

// ============================================================================
// Resolved Settings (The main API)
// ============================================================================

/**
 * Get the effective value for a setting, applying the layered resolution.
 *
 * Resolution order:
 * 1. Project override (if projectKey provided and override exists)
 * 2. User default
 * 3. App default
 *
 * @param projKey - The project key (or null for global context)
 * @param key - The setting key
 * @returns The resolved value, or null if not found in any layer
 */
export function getResolved(projKey: string | null, key: string): string | null {
  // 1. Check project override
  if (projKey) {
    const override = getProjectOverride(projKey, key)
    if (override !== null) return override
  }

  // 2. Check user default
  const userDefault = getDefault(key)
  if (userDefault !== null) return userDefault

  // 3. Check app default
  return APP_DEFAULTS[key] ?? null
}

/**
 * Get the effective value as a boolean.
 */
export function getResolvedBool(projKey: string | null, key: string): boolean {
  const value = getResolved(projKey, key)
  return value === 'true' || value === '1'
}

/**
 * Get the effective value as a number.
 */
export function getResolvedNumber(projKey: string | null, key: string): number | null {
  const value = getResolved(projKey, key)
  if (value === null) return null
  const num = parseFloat(value)
  return isNaN(num) ? null : num
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Settings patch for bulk updates.
 */
export interface SettingsPatch {
  [key: string]: string | null // null means delete/clear
}

/**
 * Apply a patch to user defaults.
 */
export function patchDefaults(patch: SettingsPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null) {
      setDefault(key, value)
    } else {
      clearDefault(key)
    }
  }
}

/**
 * Apply a patch to project overrides.
 */
export function patchProjectOverrides(projKey: string, patch: SettingsPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null) {
      setProjectOverride(projKey, key, value)
    } else {
      clearProjectOverride(projKey, key)
    }
  }
}

// ============================================================================
// Settings Schema & Validation
// ============================================================================

/**
 * Known setting keys and their types for validation.
 */
export const SETTINGS_SCHEMA: Record<string, 'string' | 'boolean' | 'number'> = {
  'sync.autoSync': 'boolean',
  'sync.pollIntervalMinutes': 'number',
  'index.autoIndexingEnabled': 'boolean',
  'worker.enabled': 'boolean',
  'worker.toolPreference': 'string',
  'worker.maxMinutes': 'number',
  'worker.planFirst': 'boolean',
  'worker.enableTestMode': 'boolean',
  'ui.showPullRequestsSection': 'boolean',
  'ui.logsMaxLines': 'number',
  'logs.maxEntries': 'number',
  'logs.persistEnabled': 'boolean',
  'logs.exportIncludeDiskWhenEnabled': 'boolean'
}

/**
 * Get all resolved settings for a project as an object.
 */
export function getAllResolvedSettings(projKey: string | null): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const key of Object.keys(SETTINGS_SCHEMA)) {
    result[key] = getResolved(projKey, key)
  }
  return result
}
