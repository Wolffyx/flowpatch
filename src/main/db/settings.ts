/**
 * App Settings Database Operations
 */

import { getDb } from './connection'

/**
 * Get an app setting.
 */
export function getAppSetting(key: string): string | null {
  const d = getDb()
  const row = d.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

/**
 * Set an app setting.
 */
export function setAppSetting(key: string, value: string): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `
  ).run(key, value, now)
}

/**
 * Delete an app setting.
 */
export function deleteAppSetting(key: string): void {
  const d = getDb()
  d.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
}
