/**
 * Settings Migration Service
 *
 * Handles migration of project-specific settings from central database
 * (stored as project:{id}:* keys in app_settings table) to .flowpatch/config.yml.
 *
 * Migration flow:
 * 1. Find all project:{id}:* keys in central DB
 * 2. Convert to FlowPatchSettingsConfig format
 * 3. Write to .flowpatch/config.yml
 * 4. Delete from central DB
 */

import { sql } from 'drizzle-orm'
import { getDrizzle } from '../drizzle'
import { appSettings } from '../schema'
import {
  updateProjectSettings,
  type FlowPatchSettingsConfig
} from '../../services/flowpatch-config'
import { SETTINGS_SCHEMA } from '../../settingsStore'

// Map settingsStore keys to config.yml keys
const SETTING_TO_CONFIG_KEY: Record<string, keyof FlowPatchSettingsConfig> = {
  'sync.autoSync': 'autoSync',
  'sync.pollIntervalMinutes': 'pollIntervalMinutes',
  'worker.enabled': 'workerEnabled',
  'worker.maxMinutes': 'workerMaxMinutes',
  'worker.planFirst': 'workerPlanFirst',
  'worker.toolPreference': 'workerToolPreference',
  'worker.enableTestMode': 'workerEnableTestMode',
  'index.autoIndexingEnabled': 'autoIndexingEnabled',
  'ui.showPullRequestsSection': 'showPullRequestsSection',
  'ui.logsMaxLines': 'logsMaxLines'
}

export interface SettingsMigrationResult {
  success: boolean
  settingsMigrated: number
  errors: string[]
}

/**
 * Migrate project settings from central DB to .flowpatch/config.yml
 *
 * @param projectId - The project ID
 * @param projectPath - The project local path
 * @returns Migration result with success status and count
 */
export function migrateProjectSettingsToConfig(
  projectId: string,
  projectPath: string
): SettingsMigrationResult {
  const result: SettingsMigrationResult = {
    success: false,
    settingsMigrated: 0,
    errors: []
  }

  try {
    const db = getDrizzle()
    const prefix = `project:${projectId}:`

    // Get all project settings from central DB
    const rows = db
      .select()
      .from(appSettings)
      .where(sql`${appSettings.key} LIKE ${prefix + '%'}`)
      .all() as Array<{ key: string; value: string }>

    if (rows.length === 0) {
      result.success = true
      return result
    }

    // Convert to config.yml format
    const settings: Partial<FlowPatchSettingsConfig> = {}
    let convertedCount = 0

    for (const row of rows) {
      const key = row.key.slice(prefix.length) // Remove "project:{id}:" prefix
      const configKey = SETTING_TO_CONFIG_KEY[key]

      if (configKey) {
        try {
          // Convert value to proper type
          const valueType = SETTINGS_SCHEMA[key]
          const typedValue =
            valueType === 'boolean'
              ? row.value === 'true'
              : valueType === 'number'
                ? Number(row.value)
                : row.value

          settings[configKey] = typedValue as never
          convertedCount++
        } catch (err) {
          result.errors.push(`Failed to convert setting ${key}: ${err}`)
        }
      }
    }

    // Write to config.yml
    if (Object.keys(settings).length > 0) {
      updateProjectSettings(projectPath, settings)
      result.settingsMigrated = convertedCount
    }

    // Delete from central DB
    db.delete(appSettings).where(sql`${appSettings.key} LIKE ${prefix + '%'}`).run()

    result.success = true
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err))
  }

  return result
}

/**
 * Check if a project has settings in central DB that need migration
 *
 * @param projectId - The project ID
 * @returns True if project has settings in central DB
 */
export function hasProjectSettingsInCentralDb(projectId: string): boolean {
  const db = getDrizzle()
  const prefix = `project:${projectId}:`

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(appSettings)
    .where(sql`${appSettings.key} LIKE ${prefix + '%'}`)
    .get() as { count: number } | undefined

  return (result?.count ?? 0) > 0
}

/**
 * Get count of project settings in central DB
 *
 * @param projectId - The project ID
 * @returns Number of settings stored in central DB
 */
export function getProjectSettingsCount(projectId: string): number {
  const db = getDrizzle()
  const prefix = `project:${projectId}:`

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(appSettings)
    .where(sql`${appSettings.key} LIKE ${prefix + '%'}`)
    .get() as { count: number } | undefined

  return result?.count ?? 0
}

/**
 * Get all project settings from central DB (for preview/debugging)
 *
 * @param projectId - The project ID
 * @returns Array of setting key-value pairs
 */
export function getProjectSettingsFromCentralDb(
  projectId: string
): Array<{ key: string; value: string }> {
  const db = getDrizzle()
  const prefix = `project:${projectId}:`

  const rows = db
    .select()
    .from(appSettings)
    .where(sql`${appSettings.key} LIKE ${prefix + '%'}`)
    .all() as Array<{ key: string; value: string }>

  // Strip prefix from keys for readability
  return rows.map((row) => ({
    key: row.key.slice(prefix.length),
    value: row.value
  }))
}
