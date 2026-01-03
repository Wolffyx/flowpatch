/**
 * App Settings Database Operations
 */

import { eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { appSettings } from './schema'

/**
 * Get an app setting.
 */
export function getAppSetting(key: string): string | null {
  const db = getDrizzle()
  const row = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).get()
  return row?.value ?? null
}

/**
 * Set an app setting.
 */
export function setAppSetting(key: string, value: string): void {
  const db = getDrizzle()
  const now = new Date().toISOString()
  db.insert(appSettings)
    .values({ key, value, updated_at: now })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updated_at: now }
    })
    .run()
}

/**
 * Delete an app setting.
 */
export function deleteAppSetting(key: string): void {
  const db = getDrizzle()
  db.delete(appSettings).where(eq(appSettings.key, key)).run()
}
