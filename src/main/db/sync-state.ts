/**
 * Sync State Database Operations
 */

import { and, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { syncState } from './schema'

/**
 * Get a sync cursor value.
 */
export function getSyncCursor(
  projectId: string,
  provider: string,
  cursorType: string
): string | null {
  const db = getDrizzle()
  const row = db
    .select({ cursor_value: syncState.cursor_value })
    .from(syncState)
    .where(
      and(
        eq(syncState.project_id, projectId),
        eq(syncState.provider, provider),
        eq(syncState.cursor_type, cursorType)
      )
    )
    .get()
  return row?.cursor_value ?? null
}

/**
 * Set a sync cursor value.
 */
export function setSyncCursor(
  projectId: string,
  provider: string,
  cursorType: string,
  value: string | null
): void {
  const db = getDrizzle()
  const now = new Date().toISOString()
  const id = `${projectId}:${provider}:${cursorType}`
  db.insert(syncState)
    .values({
      id,
      project_id: projectId,
      provider,
      cursor_type: cursorType,
      cursor_value: value,
      updated_at: now
    })
    .onConflictDoUpdate({
      target: [syncState.project_id, syncState.provider, syncState.cursor_type],
      set: { cursor_value: value, updated_at: now }
    })
    .run()
}
