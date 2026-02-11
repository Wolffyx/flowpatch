/**
 * Card Database Operations
 *
 * Supports both central database (legacy) and project-local database.
 */

import { and, asc, desc, eq, gt, inArray, isNotNull, lte, ne, notExists, sql } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { cards, jobs } from './schema'
import { cards as projectCards } from './schema/project'
import { jobs as projectJobs } from './schema/project'
import { generateId } from '@shared/utils'
import { logAction } from '../utils/main-logger'
import { getPriorityFromLabels } from '@shared/utils/priority'
import type { Card, CardStatus, PolicyConfig } from '@shared/types'
import { getDependenciesForCard } from './card-dependencies'
import { resolveProjectDb, getProjectPath } from './db-resolver'
import { listProjects } from './projects'
import { getProjectDrizzle, hasProjectDb } from './project-db'

export type { Card, CardStatus }

export interface CardEligibilityDiagnostic {
  cardId: string
  cardTitle: string
  isEligible: boolean
  reasons: string[]
  details: {
    status: CardStatus
    provider: string
    hasRemoteRepoKey: boolean
    hasActiveJob: boolean
    isInCooldown: boolean
    isBlockedByDependencies: boolean
    cooldownEndsAt?: string
    blockingDependencies?: string[]
  }
}

/**
 * List all cards for a project.
 */
export function listCards(projectId: string): Card[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - no project_id filter needed (implicit)
    const rows = db.select().from(projectCards).orderBy(desc(projectCards.updated_local_at)).all()
    // Add project_id to match Card type
    return rows.map((r) => ({ ...r, project_id: projectId })) as Card[]
  }

  // Central DB - filter by project_id
  return db
    .select()
    .from(cards)
    .where(eq(cards.project_id, projectId))
    .orderBy(desc(cards.updated_local_at))
    .all() as Card[]
}

/**
 * Get a card by ID.
 * @param id - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getCard(id: string, projectId?: string): Card | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db.select().from(projectCards).where(eq(projectCards.id, id)).get()
      return row ? ({ ...row, project_id: projectId } as Card) : null
    }
  }

  // If no projectId provided, prioritize project DBs for migrated projects
  // This ensures migrated cards are found in project DB, not central DB
  if (!projectId) {
    const projects = listProjects()
    for (const project of projects) {
      const projectPath = getProjectPath(project.id)
      if (projectPath && hasProjectDb(projectPath)) {
        try {
          const projectDb = getProjectDrizzle(projectPath)
          const row = projectDb.select().from(projectCards).where(eq(projectCards.id, id)).get()
          if (row) {
            logAction('getCard:found_in_project_db', {
              cardId: id,
              projectId: project.id,
              searchedAllProjects: true,
              priority: 'project_db_first'
            })
            return { ...row, project_id: project.id } as Card
          }
        } catch (err) {
          // Skip projects with DB access errors
          logAction('getCard:project_db_error', {
            cardId: id,
            projectId: project.id,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }
    }
  }

  // Fallback to central DB if not found in project DBs
  // This handles non-migrated projects or cards that haven't been migrated yet
  const db = getDrizzle()
  const centralCard = db.select().from(cards).where(eq(cards.id, id)).get() as Card | undefined
  if (centralCard) {
    logAction('getCard:found_in_central_db', {
      cardId: id,
      projectId: centralCard.project_id,
      note: projectId ? 'projectId provided but not migrated' : 'searched project DBs first, not found'
    })
    return centralCard
  }

  return null
}

/**
 * Get a card by remote key and number.
 */
export function getCardByRemote(
  projectId: string,
  remoteRepoKey: string,
  remoteNumberOrIid: string
): Card | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - no project_id filter needed
    const row = db
      .select()
      .from(projectCards)
      .where(
        and(
          eq(projectCards.remote_repo_key, remoteRepoKey),
          eq(projectCards.remote_number_or_iid, remoteNumberOrIid)
        )
      )
      .get()
    return row ? ({ ...row, project_id: projectId } as Card) : null
  }

  // Central DB - filter by project_id
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
  const { db, isLocalDb } = resolveProjectDb(c.project_id)
  const now = new Date().toISOString()

  if (isLocalDb) {
    // Project DB - exclude project_id from schema
    const existing = db.select().from(projectCards).where(eq(projectCards.id, c.id)).get()

    const cardData = {
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
      last_error: c.last_error,
      has_conflicts: c.has_conflicts ?? 0
    }

    if (existing) {
      db.update(projectCards).set(cardData).where(eq(projectCards.id, c.id)).run()
    } else {
      db.insert(projectCards).values({ id: c.id, ...cardData }).run()
    }

    const result = db.select().from(projectCards).where(eq(projectCards.id, c.id)).get()
    return { ...result, project_id: c.project_id } as Card
  }

  // Central DB - include project_id
  const centralDb = getDrizzle()
  const existing = centralDb.select().from(cards).where(eq(cards.id, c.id)).get() as
    | Card
    | undefined

  if (existing) {
    centralDb
      .update(cards)
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

  centralDb
    .insert(cards)
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
  return centralDb.select().from(cards).where(eq(cards.id, c.id)).get() as Card
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
 * @param cardId - The card ID
 * @param status - The new status
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateCardStatus(
  cardId: string,
  status: CardStatus,
  projectId?: string
): Card | null {
  const now = new Date().toISOString()
  const readyEligible = status === 'ready' ? 1 : 0

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      logAction('updateCardStatus:using_project_db', { cardId, projectId, status })
      db.update(projectCards)
        .set({
          status,
          ready_eligible: readyEligible,
          updated_local_at: now,
          sync_state: 'pending'
        })
        .where(eq(projectCards.id, cardId))
        .run()
      const updated = getCard(cardId, projectId)
      if (!updated) {
        logAction('updateCardStatus:card_not_found_after_update', {
          cardId,
          projectId,
          dbType: 'project',
          status
        })
      } else {
        logAction('updateCardStatus:success', {
          cardId,
          projectId,
          dbType: 'project',
          status,
          newStatus: updated.status
        })
      }
      return updated
    }
  }

  // Central DB fallback
  logAction('updateCardStatus:using_central_db', {
    cardId,
    projectId: projectId || 'none',
    status
  })
  const db = getDrizzle()
  db.update(cards)
    .set({
      status,
      ready_eligible: readyEligible,
      updated_local_at: now,
      sync_state: 'pending'
    })
    .where(eq(cards.id, cardId))
    .run()
  // Always pass projectId if available to ensure consistent DB resolution
  const updated = getCard(cardId, projectId)
  if (!updated && projectId) {
    logAction('updateCardStatus:card_not_found_after_update', {
      cardId,
      projectId,
      dbType: 'central',
      status
    })
  } else if (updated) {
    logAction('updateCardStatus:success', {
      cardId,
      projectId: projectId || 'none',
      dbType: 'central',
      status,
      newStatus: updated.status
    })
  }
  return updated
}

/**
 * Update card labels.
 * @param cardId - The card ID
 * @param labelsJson - The labels JSON string
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateCardLabels(
  cardId: string,
  labelsJson: string | null,
  projectId?: string
): void {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectCards)
        .set({
          labels_json: labelsJson,
          updated_local_at: now
        })
        .where(eq(projectCards.id, cardId))
        .run()
      return
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
    draft: 'Draft',
    ready: 'Ready',
    in_progress: 'In Progress',
    in_review: 'In Review',
    testing: 'Testing',
    failed: 'Failed',
    done: 'Done'
  }
  const keyMap: Record<CardStatus, keyof NonNullable<typeof statusLabels>> = {
    draft: 'draft',
    ready: 'ready',
    in_progress: 'inProgress',
    in_review: 'inReview',
    testing: 'testing',
    failed: 'failed',
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
    statusLabels.draft || 'Draft',
    statusLabels.ready || 'Ready',
    statusLabels.inProgress || 'In Progress',
    statusLabels.inReview || 'In Review',
    statusLabels.testing || 'Testing',
    statusLabels.failed || 'Failed',
    statusLabels.done || 'Done'
  ]
}

/**
 * Update card sync state.
 * @param cardId - The card ID
 * @param syncState - The new sync state
 * @param error - Optional error message
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateCardSyncState(
  cardId: string,
  syncState: 'ok' | 'pending' | 'error',
  error?: string,
  projectId?: string
): void {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectCards)
        .set({
          sync_state: syncState,
          last_error: error ?? null,
          updated_local_at: now
        })
        .where(eq(projectCards.id, cardId))
        .run()
      return
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * Update card timestamp (used for manual priority sorting).
 * @param cardId - The card ID
 * @param timestamp - The new timestamp
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateCardTimestamp(cardId: string, timestamp: string, projectId?: string): void {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectCards).set({ updated_local_at: timestamp }).where(eq(projectCards.id, cardId)).run()
      return
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.update(cards).set({ updated_local_at: timestamp }).where(eq(cards.id, cardId)).run()
}

/**
 * Update card conflict status.
 * @param cardId - The card ID
 * @param hasConflicts - Whether the card has conflicts
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateCardConflictStatus(
  cardId: string,
  hasConflicts: boolean,
  projectId?: string
): void {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.update(projectCards)
        .set({
          has_conflicts: hasConflicts ? 1 : 0,
          updated_local_at: now
        })
        .where(eq(projectCards.id, cardId))
        .run()
      return
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function clearCardConflictStatus(cardId: string, projectId?: string): void {
  updateCardConflictStatus(cardId, false, projectId)
}

/**
 * Delete a card.
 * @param id - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteCard(id: string, projectId?: string): boolean {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db.delete(projectCards).where(eq(projectCards.id, id)).run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db.delete(cards).where(eq(cards.id, id)).run()
  return result.changes > 0
}

/**
 * Get the next ready card for worker processing.
 */
export function getNextReadyCard(projectId: string, retryCooldownMinutes = 30): Card | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const cooldownTime = new Date(Date.now() - retryCooldownMinutes * 60 * 1000).toISOString()

  if (isLocalDb) {
    // Project DB - no project_id filter needed
    const activeJobSubquery = db
      .select({ _: sql`1` })
      .from(projectJobs)
      .where(
        and(
          eq(projectJobs.card_id, projectCards.id),
          eq(projectJobs.type, 'worker_run'),
          inArray(projectJobs.state, ['queued', 'running'])
        )
      )

    const failedJobSubquery = db
      .select({ _: sql`1` })
      .from(projectJobs)
      .where(
        and(
          eq(projectJobs.card_id, projectCards.id),
          eq(projectJobs.type, 'worker_run'),
          eq(projectJobs.state, 'failed'),
          gt(projectJobs.updated_at, cooldownTime),
          lte(projectCards.updated_local_at, projectJobs.updated_at)
        )
      )

    const row = db
      .select()
      .from(projectCards)
      .where(
        and(
          eq(projectCards.status, 'ready'),
          ne(projectCards.provider, 'local'),
          isNotNull(projectCards.remote_repo_key),
          notExists(activeJobSubquery),
          notExists(failedJobSubquery)
        )
      )
      .orderBy(asc(projectCards.updated_local_at))
      .limit(1)
      .get()
    return row ? ({ ...row, project_id: projectId } as Card) : null
  }

  // Central DB - filter by project_id
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
/**
 * Check if a card is blocked by unsatisfied dependencies.
 * Returns true if the card has active dependencies that block 'ready' status
 * and those dependencies have not reached their required status.
 */
export function isCardBlockedByDependencies(cardId: string, projectId?: string): boolean {
  const deps = getDependenciesForCard(cardId, projectId)

  // Filter active dependencies that block 'ready' status
  const blockingDeps = deps.filter(
    (dep) => dep.is_active === 1 && dep.blocking_statuses.includes('ready')
  )

  if (blockingDeps.length === 0) return false

  // Status order for comparison (same as in card-dependencies.ts)
  const statusOrder: CardStatus[] = [
    'draft',
    'ready',
    'in_progress',
    'in_review',
    'testing',
    'done'
  ]

  // Check if any blocking dependency is not satisfied
  for (const dep of blockingDeps) {
    const depCard = getCard(dep.depends_on_card_id, projectId)
    if (!depCard) continue // Missing dependency card - treat as satisfied

    const currentIndex = statusOrder.indexOf(depCard.status)
    const requiredIndex = statusOrder.indexOf(dep.required_status)

    if (currentIndex < requiredIndex) {
      return true // Dependency not satisfied
    }
  }

  return false
}

function getBlockingDependenciesForReady(cardId: string, projectId?: string): string[] {
  const deps = getDependenciesForCard(cardId, projectId)
  const blockingDeps = deps.filter(
    (dep) => dep.is_active === 1 && dep.blocking_statuses.includes('ready')
  )

  if (blockingDeps.length === 0) return []

  const statusOrder: CardStatus[] = [
    'draft',
    'ready',
    'in_progress',
    'in_review',
    'testing',
    'done'
  ]

  const blockedBy: string[] = []
  for (const dep of blockingDeps) {
    const depCard = getCard(dep.depends_on_card_id, projectId)
    if (!depCard) continue

    const currentIndex = statusOrder.indexOf(depCard.status)
    const requiredIndex = statusOrder.indexOf(dep.required_status)

    if (currentIndex < requiredIndex) {
      blockedBy.push(dep.depends_on_card_id)
    }
  }

  return blockedBy
}

function buildCardEligibilityDiagnostic(
  card: Card,
  projectId: string,
  retryCooldownMinutes: number
): CardEligibilityDiagnostic {
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const reasons: string[] = []

  if (card.status !== 'ready') reasons.push('status_not_ready')
  if (card.provider === 'local') reasons.push('provider_local')
  const hasRemoteRepoKey = !!card.remote_repo_key
  if (!hasRemoteRepoKey) reasons.push('missing_remote_repo_key')

  const activeJob = isLocalDb
    ? db
        .select({ id: projectJobs.id })
        .from(projectJobs)
        .where(
          and(
            eq(projectJobs.card_id, card.id),
            eq(projectJobs.type, 'worker_run'),
            inArray(projectJobs.state, ['queued', 'running'])
          )
        )
        .limit(1)
        .get()
    : db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.card_id, card.id),
            eq(jobs.type, 'worker_run'),
            inArray(jobs.state, ['queued', 'running'])
          )
        )
        .limit(1)
        .get()
  const hasActiveJob = !!activeJob
  if (hasActiveJob) reasons.push('active_worker_job')

  const cooldownMs = retryCooldownMinutes * 60 * 1000
  const cooldownTime = new Date(Date.now() - cooldownMs).toISOString()

  const failedJob = isLocalDb
    ? db
        .select({ updated_at: projectJobs.updated_at })
        .from(projectJobs)
        .where(
          and(
            eq(projectJobs.card_id, card.id),
            eq(projectJobs.type, 'worker_run'),
            eq(projectJobs.state, 'failed'),
            gt(projectJobs.updated_at, cooldownTime),
            lte(projectCards.updated_local_at, projectJobs.updated_at)
          )
        )
        .orderBy(desc(projectJobs.updated_at))
        .limit(1)
        .get()
    : db
        .select({ updated_at: jobs.updated_at })
        .from(jobs)
        .where(
          and(
            eq(jobs.card_id, card.id),
            eq(jobs.type, 'worker_run'),
            eq(jobs.state, 'failed'),
            gt(jobs.updated_at, cooldownTime),
            lte(cards.updated_local_at, jobs.updated_at)
          )
        )
        .orderBy(desc(jobs.updated_at))
        .limit(1)
        .get()

  const isInCooldown = !!failedJob
  if (isInCooldown) reasons.push('recent_failed_job_cooldown')

  const blockingDependencies = getBlockingDependenciesForReady(card.id, projectId)
  const isBlockedByDependencies = blockingDependencies.length > 0
  if (isBlockedByDependencies) reasons.push('blocked_by_dependencies')

  const cooldownEndsAt = failedJob
    ? new Date(new Date(failedJob.updated_at).getTime() + cooldownMs).toISOString()
    : undefined

  return {
    cardId: card.id,
    cardTitle: card.title,
    isEligible: reasons.length === 0,
    reasons,
    details: {
      status: card.status,
      provider: card.provider,
      hasRemoteRepoKey,
      hasActiveJob,
      isInCooldown,
      isBlockedByDependencies,
      cooldownEndsAt,
      blockingDependencies: blockingDependencies.length > 0 ? blockingDependencies : undefined
    }
  }
}

export function getCardEligibilityDiagnostic(
  cardId: string,
  projectId?: string,
  retryCooldownMinutes = 30
): CardEligibilityDiagnostic | null {
  const card = getCard(cardId, projectId)
  if (!card) return null
  return buildCardEligibilityDiagnostic(card, card.project_id, retryCooldownMinutes)
}

export function getReadyCardsNotProcessing(
  projectId: string,
  retryCooldownMinutes = 30
): CardEligibilityDiagnostic[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  const readyCards = isLocalDb
    ? db.select().from(projectCards).where(eq(projectCards.status, 'ready')).all()
    : (db
        .select()
        .from(cards)
        .where(and(eq(cards.project_id, projectId), eq(cards.status, 'ready')))
        .all() as Card[])

  return readyCards.map((card) =>
    buildCardEligibilityDiagnostic(
      isLocalDb ? ({ ...card, project_id: projectId } as Card) : (card as Card),
      projectId,
      retryCooldownMinutes
    )
  )
}

export function getNextReadyCards(
  projectId: string,
  limit: number,
  retryCooldownMinutes = 30
): Card[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const cooldownTime = new Date(Date.now() - retryCooldownMinutes * 60 * 1000).toISOString()

  let eligibleCards: Card[]

  if (isLocalDb) {
    // Project DB - no project_id filter needed
    const activeJobSubquery = db
      .select({ _: sql`1` })
      .from(projectJobs)
      .where(
        and(
          eq(projectJobs.card_id, projectCards.id),
          eq(projectJobs.type, 'worker_run'),
          inArray(projectJobs.state, ['queued', 'running'])
        )
      )

    const failedJobSubquery = db
      .select({ _: sql`1` })
      .from(projectJobs)
      .where(
        and(
          eq(projectJobs.card_id, projectCards.id),
          eq(projectJobs.type, 'worker_run'),
          eq(projectJobs.state, 'failed'),
          gt(projectJobs.updated_at, cooldownTime),
          lte(projectCards.updated_local_at, projectJobs.updated_at)
        )
      )

    const rows = db
      .select()
      .from(projectCards)
      .where(
        and(
          eq(projectCards.status, 'ready'),
          ne(projectCards.provider, 'local'),
          isNotNull(projectCards.remote_repo_key),
          notExists(activeJobSubquery),
          notExists(failedJobSubquery)
        )
      )
      .all()
    eligibleCards = rows.map((r) => ({ ...r, project_id: projectId })) as Card[]
  } else {
    // Central DB - filter by project_id
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

    eligibleCards = db
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
      .all() as Card[]
  }

  // Filter out dependency-blocked cards
  const unblockedCards = eligibleCards.filter(
    (card) => !isCardBlockedByDependencies(card.id, projectId)
  )

  // Sort by priority (lower number = higher priority), then by timestamp (FIFO tie-breaker)
  const sortedCards = unblockedCards
    .map((card) => ({
      card,
      priority: getPriorityFromLabels(card.labels_json)
    }))
    .sort((a, b) => {
      // Primary sort: priority (ascending - lower number = higher priority)
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }
      // Secondary sort: timestamp (ascending - older first)
      return a.card.updated_local_at.localeCompare(b.card.updated_local_at)
    })
    .slice(0, limit)
    .map((item) => item.card)

  return sortedCards
}
