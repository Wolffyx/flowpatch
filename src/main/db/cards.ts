/**
 * Card Database Operations
 */

import { getDb } from './connection'
import { generateId } from '@shared/utils'
import type { Card, CardStatus, PolicyConfig } from '@shared/types'

export type { Card, CardStatus }

/**
 * List all cards for a project.
 */
export function listCards(projectId: string): Card[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM cards WHERE project_id = ? ORDER BY updated_local_at DESC')
  return stmt.all(projectId) as Card[]
}

/**
 * Get a card by ID.
 */
export function getCard(id: string): Card | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM cards WHERE id = ?')
  return (stmt.get(id) as Card) ?? null
}

/**
 * Get a card by remote key and number.
 */
export function getCardByRemote(
  projectId: string,
  remoteRepoKey: string,
  remoteNumberOrIid: string
): Card | null {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM cards WHERE project_id = ? AND remote_repo_key = ? AND remote_number_or_iid = ?'
  )
  return (stmt.get(projectId, remoteRepoKey, remoteNumberOrIid) as Card) ?? null
}

/**
 * Create or update a card.
 */
export function upsertCard(
  c: Omit<Card, 'updated_local_at'> & { updated_local_at?: string }
): Card {
  const d = getDb()
  const now = new Date().toISOString()
  const existing = d.prepare('SELECT * FROM cards WHERE id = ?').get(c.id) as Card | undefined
  if (existing) {
    d.prepare(
      `
      UPDATE cards SET
        project_id = ?,
        provider = ?,
        type = ?,
        title = ?,
        body = ?,
        status = ?,
        ready_eligible = ?,
        assignees_json = ?,
        labels_json = ?,
        remote_url = ?,
        remote_repo_key = ?,
        remote_number_or_iid = ?,
        remote_node_id = ?,
        updated_remote_at = ?,
        updated_local_at = ?,
        sync_state = ?,
        last_error = ?
      WHERE id = ?
    `
    ).run(
      c.project_id,
      c.provider,
      c.type,
      c.title,
      c.body,
      c.status,
      c.ready_eligible,
      c.assignees_json,
      c.labels_json,
      c.remote_url,
      c.remote_repo_key,
      c.remote_number_or_iid,
      c.remote_node_id ?? null,
      c.updated_remote_at,
      c.updated_local_at ?? now,
      c.sync_state,
      c.last_error,
      c.id
    )
    return { ...existing, ...c, updated_local_at: c.updated_local_at ?? now }
  }
  d.prepare(
    `
    INSERT INTO cards (
      id, project_id, provider, type, title, body, status, ready_eligible,
      assignees_json, labels_json, remote_url, remote_repo_key, remote_number_or_iid,
      remote_node_id, updated_remote_at, updated_local_at, sync_state, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    c.id,
    c.project_id,
    c.provider,
    c.type,
    c.title,
    c.body,
    c.status,
    c.ready_eligible,
    c.assignees_json,
    c.labels_json,
    c.remote_url,
    c.remote_repo_key,
    c.remote_number_or_iid,
    c.remote_node_id ?? null,
    c.updated_remote_at,
    c.updated_local_at ?? now,
    c.sync_state,
    c.last_error
  )
  return d.prepare('SELECT * FROM cards WHERE id = ?').get(c.id) as Card
}

/**
 * Create a local test card.
 */
export function createLocalTestCard(projectId: string, title: string): Card {
  const id = generateId()
  return upsertCard({
    id,
    project_id: projectId,
    provider: 'local',
    type: 'local',
    title,
    body: null,
    status: 'draft',
    ready_eligible: 0,
    assignees_json: null,
    labels_json: null,
    remote_url: null,
    remote_repo_key: null,
    remote_number_or_iid: null,
    remote_node_id: null,
    updated_remote_at: null,
    sync_state: 'ok',
    last_error: null
  })
}

/**
 * Update card status.
 */
export function updateCardStatus(cardId: string, status: CardStatus): Card | null {
  const d = getDb()
  const now = new Date().toISOString()
  const readyEligible = status === 'ready' ? 1 : 0
  d.prepare(
    'UPDATE cards SET status = ?, ready_eligible = ?, updated_local_at = ?, sync_state = ? WHERE id = ?'
  ).run(status, readyEligible, now, 'pending', cardId)
  return getCard(cardId)
}

/**
 * Update card labels.
 */
export function updateCardLabels(cardId: string, labelsJson: string | null): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE cards SET labels_json = ?, updated_local_at = ? WHERE id = ?').run(
    labelsJson,
    now,
    cardId
  )
}

/**
 * Get status label from policy.
 */
export function getStatusLabelFromPolicy(status: CardStatus, policy: PolicyConfig): string {
  const statusLabels = policy.sync?.statusLabels || {}
  const defaults: Record<CardStatus, string> = {
    draft: 'status::draft',
    ready: 'status::ready',
    in_progress: 'status::in-progress',
    in_review: 'status::in-review',
    testing: 'status::testing',
    done: 'status::done'
  }
  const keyMap: Record<CardStatus, keyof NonNullable<typeof statusLabels>> = {
    draft: 'draft',
    ready: 'ready',
    in_progress: 'inProgress',
    in_review: 'inReview',
    testing: 'testing',
    done: 'done'
  }
  return statusLabels[keyMap[status]] || defaults[status]
}

/**
 * Get all status labels from policy.
 */
export function getAllStatusLabelsFromPolicy(policy: PolicyConfig): string[] {
  const statusLabels = policy.sync?.statusLabels || {}
  return [
    statusLabels.draft || 'status::draft',
    statusLabels.ready || 'status::ready',
    statusLabels.inProgress || 'status::in-progress',
    statusLabels.inReview || 'status::in-review',
    statusLabels.testing || 'status::testing',
    statusLabels.done || 'status::done'
  ]
}

/**
 * Update card sync state.
 */
export function updateCardSyncState(
  cardId: string,
  syncState: 'ok' | 'pending' | 'error',
  error?: string
): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare(
    'UPDATE cards SET sync_state = ?, last_error = ?, updated_local_at = ? WHERE id = ?'
  ).run(syncState, error ?? null, now, cardId)
}

/**
 * Delete a card.
 */
export function deleteCard(id: string): boolean {
  const d = getDb()
  const result = d.prepare('DELETE FROM cards WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Get the next ready card for worker processing.
 */
export function getNextReadyCard(projectId: string, retryCooldownMinutes = 30): Card | null {
  const d = getDb()
  const cooldownTime = new Date(Date.now() - retryCooldownMinutes * 60 * 1000).toISOString()

  const stmt = d.prepare(`
    SELECT c.* FROM cards c
    WHERE c.project_id = ?
      AND c.status = 'ready'
      AND c.provider != 'local'
      AND c.remote_repo_key IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.card_id = c.id
          AND j.type = 'worker_run'
          AND j.state IN ('queued', 'running')
      )
      AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.card_id = c.id
          AND j.type = 'worker_run'
          AND j.state = 'failed'
          AND j.updated_at > ?
      )
    ORDER BY c.updated_local_at ASC
    LIMIT 1
  `)

  return (stmt.get(projectId, cooldownTime) as Card) ?? null
}

/**
 * Get multiple ready cards for parallel processing.
 */
export function getNextReadyCards(
  projectId: string,
  limit: number,
  retryCooldownMinutes = 30
): Card[] {
  const d = getDb()
  const cooldownTime = new Date(Date.now() - retryCooldownMinutes * 60 * 1000).toISOString()

  const stmt = d.prepare(`
    SELECT c.* FROM cards c
    WHERE c.project_id = ?
      AND c.status = 'ready'
      AND c.provider != 'local'
      AND c.remote_repo_key IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.card_id = c.id
          AND j.type = 'worker_run'
          AND j.state IN ('queued', 'running')
      )
      AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.card_id = c.id
          AND j.type = 'worker_run'
          AND j.state = 'failed'
          AND j.updated_at > ?
      )
    ORDER BY c.updated_local_at ASC
    LIMIT ?
  `)

  return stmt.all(projectId, cooldownTime, limit) as Card[]
}
