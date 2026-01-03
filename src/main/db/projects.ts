/**
 * Project Database Operations
 */

import { desc, eq, inArray } from 'drizzle-orm'
import { getDrizzle, getSqlite } from './drizzle'
import {
  projects,
  cards,
  jobs,
  events,
  workerSlots,
  worktrees,
  syncState,
  subtasks,
  workerProgress,
  cardLinks
} from './schema'
import type { Project } from '@shared/types'

export type { Project }

/**
 * List all projects ordered by updated_at descending.
 */
export function listProjects(): Project[] {
  const db = getDrizzle()
  return db.select().from(projects).orderBy(desc(projects.updated_at)).all() as Project[]
}

/**
 * Get a project by ID.
 */
export function getProject(id: string): Project | null {
  const db = getDrizzle()
  return (db.select().from(projects).where(eq(projects.id, id)).get() as Project) ?? null
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
  const db = getDrizzle()
  const now = new Date().toISOString()
  const existing = db.select().from(projects).where(eq(projects.id, p.id)).get() as
    | Project
    | undefined

  if (existing) {
    db.update(projects)
      .set({
        name: p.name,
        local_path: p.local_path,
        selected_remote_name: p.selected_remote_name,
        remote_repo_key: p.remote_repo_key,
        provider_hint: p.provider_hint,
        policy_json: p.policy_json ?? null,
        worker_enabled: p.worker_enabled ?? existing.worker_enabled,
        last_sync_at: p.last_sync_at ?? existing.last_sync_at,
        updated_at: now
      })
      .where(eq(projects.id, p.id))
      .run()
    return { ...existing, ...p, updated_at: now } as Project
  }

  db.insert(projects)
    .values({
      id: p.id,
      name: p.name,
      local_path: p.local_path,
      selected_remote_name: p.selected_remote_name,
      remote_repo_key: p.remote_repo_key,
      provider_hint: p.provider_hint,
      policy_json: p.policy_json ?? null,
      worker_enabled: p.worker_enabled ?? 0,
      last_sync_at: p.last_sync_at ?? null,
      created_at: now,
      updated_at: now
    })
    .run()
  return db.select().from(projects).where(eq(projects.id, p.id)).get() as Project
}

/**
 * Delete a project and all associated data.
 */
export function deleteProject(id: string): boolean {
  const db = getDrizzle()
  const sqlite = getSqlite()

  const deleteByIds = (cardIds: string[]): void => {
    // SQLite default max variables is 999
    const chunkSize = 900
    for (let i = 0; i < cardIds.length; i += chunkSize) {
      const chunk = cardIds.slice(i, i + chunkSize)
      db.delete(workerProgress).where(inArray(workerProgress.card_id, chunk)).run()
      db.delete(cardLinks).where(inArray(cardLinks.card_id, chunk)).run()
      db.delete(events).where(inArray(events.card_id, chunk)).run()
      db.delete(subtasks).where(inArray(subtasks.parent_card_id, chunk)).run()
    }
  }

  try {
    const tx = sqlite.transaction((): boolean => {
      const cardIds = db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.project_id, id))
        .all()
        .map((r) => r.id)

      if (cardIds.length) {
        deleteByIds(cardIds)
      }

      db.delete(workerSlots).where(eq(workerSlots.project_id, id)).run()
      db.delete(worktrees).where(eq(worktrees.project_id, id)).run()
      db.delete(jobs).where(eq(jobs.project_id, id)).run()
      db.delete(syncState).where(eq(syncState.project_id, id)).run()
      db.delete(events).where(eq(events.project_id, id)).run()
      db.delete(subtasks).where(eq(subtasks.project_id, id)).run()
      db.delete(cards).where(eq(cards.project_id, id)).run()

      const result = db.delete(projects).where(eq(projects.id, id)).run()
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
  const db = getDrizzle()
  const now = new Date().toISOString()
  db.update(projects)
    .set({
      worker_enabled: enabled ? 1 : 0,
      updated_at: now
    })
    .where(eq(projects.id, projectId))
    .run()
  return getProject(projectId)
}

/**
 * Update project sync time.
 */
export function updateProjectSyncTime(projectId: string): void {
  const db = getDrizzle()
  const now = new Date().toISOString()
  db.update(projects)
    .set({
      last_sync_at: now,
      updated_at: now
    })
    .where(eq(projects.id, projectId))
    .run()
}

/**
 * Update project policy JSON.
 */
export function updateProjectPolicyJson(projectId: string, policyJson: string | null): void {
  const db = getDrizzle()
  const now = new Date().toISOString()
  db.update(projects)
    .set({
      policy_json: policyJson,
      updated_at: now
    })
    .where(eq(projects.id, projectId))
    .run()
}
