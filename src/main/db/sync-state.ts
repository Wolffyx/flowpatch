/**
 * Sync State Database Operations
 */

import { and, eq } from 'drizzle-orm'
import { syncState } from './schema'
import { syncState as projectSyncState } from './schema/project'
import { resolveProjectDb } from './db-resolver'

/**
 * Get a sync cursor value.
 */
export function getSyncCursor(
  projectId: string,
  provider: string,
  cursorType: string
): string | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const row = db
      .select({ cursor_value: projectSyncState.cursor_value })
      .from(projectSyncState)
      .where(
        and(eq(projectSyncState.provider, provider), eq(projectSyncState.cursor_type, cursorType))
      )
      .get()
    return row?.cursor_value ?? null
  }

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
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const now = new Date().toISOString()
  const id = `${projectId}:${provider}:${cursorType}`

  if (isLocalDb) {
    db.insert(projectSyncState)
      .values({
        id,
        provider,
        cursor_type: cursorType,
        cursor_value: value,
        updated_at: now
      })
      .onConflictDoUpdate({
        target: [projectSyncState.provider, projectSyncState.cursor_type],
        set: { cursor_value: value, updated_at: now }
      })
      .run()
  } else {
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
}
