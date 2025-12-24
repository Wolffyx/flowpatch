/**
 * Sync State Database Operations
 */

import { getDb } from './connection'

/**
 * Get a sync cursor value.
 */
export function getSyncCursor(
  projectId: string,
  provider: string,
  cursorType: string
): string | null {
  const d = getDb()
  const row = d
    .prepare(
      'SELECT cursor_value FROM sync_state WHERE project_id = ? AND provider = ? AND cursor_type = ?'
    )
    .get(projectId, provider, cursorType) as { cursor_value: string | null } | undefined
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
  const d = getDb()
  const now = new Date().toISOString()
  const id = `${projectId}:${provider}:${cursorType}`
  d.prepare(
    `
    INSERT INTO sync_state (id, project_id, provider, cursor_type, cursor_value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, provider, cursor_type) DO UPDATE SET
      cursor_value = excluded.cursor_value,
      updated_at = excluded.updated_at
  `
  ).run(id, projectId, provider, cursorType, value, now)
}
