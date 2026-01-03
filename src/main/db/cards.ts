/**
 * Card Database Operations
 */

import { and, asc, desc, eq, gt, inArray, isNotNull, lte, ne, notExists, sql } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { cards, jobs } from './schema'
import { generateId } from '@shared/utils'
import type { Card, CardStatus, PolicyConfig } from '@shared/types'

export type { Card, CardStatus }

/**
 * List all cards for a project.
 */
export function listCards(projectId: string): Card[] {
  const db = getDrizzle()
  return db
    .select()
    .from(cards)
    .where(eq(cards.project_id, projectId))
    .orderBy(desc(cards.updated_local_at))
    .all() as Card[]
}

/**
 * Get a card by ID.
 */
export function getCard(id: string): Card | null {
  const db = getDrizzle()
  return (db.select().from(cards).where(eq(cards.id, id)).get() as Card) ?? null
}

/**
 * Get a card by remote key and number.
 */
export function getCardByRemote(
  projectId: string,
  remoteRepoKey: string,
  remoteNumberOrIid: string
): Card | null {
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.project_id, projectId),
          eq(cards.remote_repo_key, remoteRepoKey),
          eq(cards.remote_number_or_iid, remoteNumberOrIid)
        )
      )
      .get() as Card) ?? null
  )
}

/**
 * Create or update a card.
 */
export function upsertCard(c: Omit<Card, 'updated_local_at'> & { updated_local_at?: string }): Card {
  const db = getDrizzle()
  const now = new Date().toISOString()
  const existing = db.select().from(cards).where(eq(cards.id, c.id)).get() as Card | undefined

  if (existing) {
    db.update(cards)
      .set({
        project_id: c.project_id,
        provider: c.provider,
        type: c.type,
        title: c.title,
        body: c.body,
        status: c.status,
        ready_eligible: c.ready_eligible,
        assignees_json: c.assignees_json,
        labels_json: c.labels_json,
        remote_url: c.remote_url,
        remote_repo_key: c.remote_repo_key,
        remote_number_or_iid: c.remote_number_or_iid,
        remote_node_id: c.remote_node_id ?? null,
        updated_remote_at: c.updated_remote_at,
        updated_local_at: c.updated_local_at ?? now,
        sync_state: c.sync_state,
        last_error: c.last_error
      })
      .where(eq(cards.id, c.id))
      .run()
    return { ...existing, ...c, updated_local_at: c.updated_local_at ?? now }
  }

  db.insert(cards)
    .values({
      id: c.id,
      project_id: c.project_id,
      provider: c.provider,
      type: c.type,
      title: c.title,
      body: c.body,
      status: c.status,
      ready_eligible: c.ready_eligible,
      assignees_json: c.assignees_json,
      labels_json: c.labels_json,
      remote_url: c.remote_url,
      remote_repo_key: c.remote_repo_key,
      remote_number_or_iid: c.remote_number_or_iid,
      remote_node_id: c.remote_node_id ?? null,
      updated_remote_at: c.updated_remote_at,
      updated_local_at: c.updated_local_at ?? now,
      sync_state: c.sync_state,
      last_error: c.last_error
    })
    .run()
  return db.select().from(cards).where(eq(cards.id, c.id)).get() as Card
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
    last_error: null,
    has_conflicts: 0
  })
}

/**
 * Update card status.
 */
export function updateCardStatus(cardId: string, status: CardStatus): Card | null {
  const db = getDrizzle()
  const now = new Date().toISOString()
  const readyEligible = status === 'ready' ? 1 : 0
  db.update(cards)
    .set({
      status,
      ready_eligible: readyEligible,
      updated_local_at: now,
      sync_state: 'pending'
    })
    .where(eq(cards.id, cardId))
    .run()
  return getCard(cardId)
}

/**
 * Update card labels.
 */
export function updateCardLabels(cardId: string, labelsJson: string | null): void {
  const db = getDrizzle()
  const now = new Date().toISOString()
  db.update(cards)
    .set({
      labels_json: labelsJson,
      updated_local_at: now
    })
    .where(eq(cards.id, cardId))
    .run()
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
  const db = getDrizzle()
  const now = new Date().toISOString()
  db.update(cards)
    .set({
      sync_state: syncState,
      last_error: error ?? null,
      updated_local_at: now
    })
    .where(eq(cards.id, cardId))
    .run()
}

/**
 * Update card conflict status.
 */
export function updateCardConflictStatus(cardId: string, hasConflicts: boolean): void {
  const db = getDrizzle()
  const now = new Date().toISOString()
  db.update(cards)
    .set({
      has_conflicts: hasConflicts ? 1 : 0,
      updated_local_at: now
    })
    .where(eq(cards.id, cardId))
    .run()
}

/**
 * Clear conflict status on a card.
 */
export function clearCardConflictStatus(cardId: string): void {
  updateCardConflictStatus(cardId, false)
}

/**
 * Delete a card.
 */
export function deleteCard(id: string): boolean {
  const db = getDrizzle()
  const result = db.delete(cards).where(eq(cards.id, id)).run()
  return result.changes > 0
}

/**
 * Get the next ready card for worker processing.
 */
export function getNextReadyCard(projectId: string, retryCooldownMinutes = 30): Card | null {
  const db = getDrizzle()
  const cooldownTime = new Date(Date.now() - retryCooldownMinutes * 60 * 1000).toISOString()

  // Subquery to check for active jobs
  const activeJobSubquery = db
    .select({ _: sql`1` })
    .from(jobs)
    .where(
      and(
        eq(jobs.card_id, cards.id),
        eq(jobs.type, 'worker_run'),
        inArray(jobs.state, ['queued', 'running'])
      )
    )

  // Subquery to check for recently failed jobs
  const failedJobSubquery = db
    .select({ _: sql`1` })
    .from(jobs)
    .where(
      and(
        eq(jobs.card_id, cards.id),
        eq(jobs.type, 'worker_run'),
        eq(jobs.state, 'failed'),
        gt(jobs.updated_at, cooldownTime),
        lte(cards.updated_local_at, jobs.updated_at)
      )
    )

  return (
    (db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.project_id, projectId),
          eq(cards.status, 'ready'),
          ne(cards.provider, 'local'),
          isNotNull(cards.remote_repo_key),
          notExists(activeJobSubquery),
          notExists(failedJobSubquery)
        )
      )
      .orderBy(asc(cards.updated_local_at))
      .limit(1)
      .get() as Card) ?? null
  )
}

/**
 * Get multiple ready cards for parallel processing.
 */
export function getNextReadyCards(
  projectId: string,
  limit: number,
  retryCooldownMinutes = 30
): Card[] {
  const db = getDrizzle()
  const cooldownTime = new Date(Date.now() - retryCooldownMinutes * 60 * 1000).toISOString()

  // Subquery to check for active jobs
  const activeJobSubquery = db
    .select({ _: sql`1` })
    .from(jobs)
    .where(
      and(
        eq(jobs.card_id, cards.id),
        eq(jobs.type, 'worker_run'),
        inArray(jobs.state, ['queued', 'running'])
      )
    )

  // Subquery to check for recently failed jobs
  const failedJobSubquery = db
    .select({ _: sql`1` })
    .from(jobs)
    .where(
      and(
        eq(jobs.card_id, cards.id),
        eq(jobs.type, 'worker_run'),
        eq(jobs.state, 'failed'),
        gt(jobs.updated_at, cooldownTime),
        lte(cards.updated_local_at, jobs.updated_at)
      )
    )

  return db
    .select()
    .from(cards)
    .where(
      and(
        eq(cards.project_id, projectId),
        eq(cards.status, 'ready'),
        ne(cards.provider, 'local'),
        isNotNull(cards.remote_repo_key),
        notExists(activeJobSubquery),
        notExists(failedJobSubquery)
      )
    )
    .orderBy(asc(cards.updated_local_at))
    .limit(limit)
    .all() as Card[]
}
