/**
 * Project Database Operations
 */

import { getDb } from './connection'
import type { Project } from '@shared/types'

export type { Project }

/**
 * List all projects ordered by updated_at descending.
 */
export function listProjects(): Project[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM projects ORDER BY updated_at DESC')
  return stmt.all() as Project[]
}

/**
 * Get a project by ID.
 */
export function getProject(id: string): Project | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM projects WHERE id = ?')
  return (stmt.get(id) as Project) ?? null
}

/**
 * Create or update a project.
 */
export function upsertProject(
  p: Omit<Project, 'created_at' | 'updated_at' | 'worker_enabled' | 'last_sync_at'> & {
    worker_enabled?: number
    last_sync_at?: string | null
  }
): Project {
  const d = getDb()
  const now = new Date().toISOString()
  const existing = d.prepare('SELECT * FROM projects WHERE id = ?').get(p.id) as Project | undefined
  if (existing) {
    d.prepare(
      `
      UPDATE projects SET
        name = ?,
        local_path = ?,
        selected_remote_name = ?,
        remote_repo_key = ?,
        provider_hint = ?,
        policy_json = ?,
        worker_enabled = ?,
        last_sync_at = ?,
        updated_at = ?
      WHERE id = ?
    `
    ).run(
      p.name,
      p.local_path,
      p.selected_remote_name,
      p.remote_repo_key,
      p.provider_hint,
      p.policy_json ?? null,
      p.worker_enabled ?? existing.worker_enabled,
      p.last_sync_at ?? existing.last_sync_at,
      now,
      p.id
    )
    return { ...existing, ...p, updated_at: now } as Project
  }
  d.prepare(
    `
    INSERT INTO projects (
      id, name, local_path, selected_remote_name, remote_repo_key,
      provider_hint, policy_json, worker_enabled, last_sync_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    p.id,
    p.name,
    p.local_path,
    p.selected_remote_name,
    p.remote_repo_key,
    p.provider_hint,
    p.policy_json ?? null,
    p.worker_enabled ?? 0,
    p.last_sync_at ?? null,
    now,
    now
  )
  const created = d.prepare('SELECT * FROM projects WHERE id = ?').get(p.id) as Project
  return created
}

/**
 * Delete a project and all associated data.
 */
export function deleteProject(id: string): boolean {
  const d = getDb()

  const deleteByIds = (table: string, column: string, ids: string[]): void => {
    // SQLite default max variables is 999
    const chunkSize = 900
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      const placeholders = chunk.map(() => '?').join(',')
      d.prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`).run(...chunk)
    }
  }

  try {
    const tx = d.transaction((): boolean => {
      const cardIds = (
        d.prepare('SELECT id FROM cards WHERE project_id = ?').all(id) as { id: string }[]
      ).map((r) => r.id)

      if (cardIds.length) {
        deleteByIds('worker_progress', 'card_id', cardIds)
        deleteByIds('card_links', 'card_id', cardIds)
        deleteByIds('events', 'card_id', cardIds)
        deleteByIds('subtasks', 'parent_card_id', cardIds)
      }

      d.prepare('DELETE FROM worker_slots WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM worktrees WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM jobs WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM sync_state WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM events WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM subtasks WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM cards WHERE project_id = ?').run(id)

      const result = d.prepare('DELETE FROM projects WHERE id = ?').run(id)
      return result.changes > 0
    })

    return tx()
  } catch {
    return false
  }
}

/**
 * Update project worker enabled state.
 */
export function updateProjectWorkerEnabled(projectId: string, enabled: boolean): Project | null {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE projects SET worker_enabled = ?, updated_at = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    now,
    projectId
  )
  return getProject(projectId)
}

/**
 * Update project sync time.
 */
export function updateProjectSyncTime(projectId: string): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE projects SET last_sync_at = ?, updated_at = ? WHERE id = ?').run(
    now,
    now,
    projectId
  )
}

/**
 * Update project policy JSON.
 */
export function updateProjectPolicyJson(projectId: string, policyJson: string | null): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE projects SET policy_json = ?, updated_at = ? WHERE id = ?').run(
    policyJson,
    now,
    projectId
  )
}
