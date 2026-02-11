/**
 * Card Link Database Operations
 *
 * Supports both central database (legacy) and project-local database.
 */

import { and, desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { cardLinks, cards } from './schema'
import { cardLinks as projectCardLinks } from './schema/project'
import { generateId } from '@shared/utils'
import type { CardLink } from '@shared/types'
import { resolveProjectDb } from './db-resolver'

export type { CardLink }

/**
 * List links for a card.
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function listCardLinks(cardId: string, projectId?: string): CardLink[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      return db
        .select()
        .from(projectCardLinks)
        .where(eq(projectCardLinks.card_id, cardId))
        .orderBy(desc(projectCardLinks.created_at))
        .all() as CardLink[]
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  return db
    .select()
    .from(cardLinks)
    .where(eq(cardLinks.card_id, cardId))
    .orderBy(desc(cardLinks.created_at))
    .all() as CardLink[]
}

/**
 * List links for all cards in a project.
 */
export function listCardLinksByProject(projectId: string): CardLink[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - no need to join with cards to filter by project
    return db
      .select()
      .from(projectCardLinks)
      .orderBy(desc(projectCardLinks.created_at))
      .all() as CardLink[]
  }

  // Central DB - join with cards to filter by project_id
  return db
    .select({
      id: cardLinks.id,
      card_id: cardLinks.card_id,
      linked_type: cardLinks.linked_type,
      linked_url: cardLinks.linked_url,
      linked_remote_repo_key: cardLinks.linked_remote_repo_key,
      linked_number_or_iid: cardLinks.linked_number_or_iid,
      created_at: cardLinks.created_at
    })
    .from(cardLinks)
    .innerJoin(cards, eq(cardLinks.card_id, cards.id))
    .where(eq(cards.project_id, projectId))
    .orderBy(desc(cardLinks.created_at))
    .all() as CardLink[]
}

/**
 * Create a card link.
 * @param cardId - The card ID
 * @param linkedType - Type of link (pr or mr)
 * @param linkedUrl - URL of the linked item
 * @param linkedRemoteRepoKey - Remote repository key
 * @param linkedNumberOrIid - Remote number or IID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function createCardLink(
  cardId: string,
  linkedType: 'pr' | 'mr',
  linkedUrl: string,
  linkedRemoteRepoKey?: string,
  linkedNumberOrIid?: string,
  projectId?: string
): CardLink {
  const id = generateId()
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.insert(projectCardLinks)
        .values({
          id,
          card_id: cardId,
          linked_type: linkedType,
          linked_url: linkedUrl,
          linked_remote_repo_key: linkedRemoteRepoKey ?? null,
          linked_number_or_iid: linkedNumberOrIid ?? null,
          created_at: now
        })
        .run()
      return db.select().from(projectCardLinks).where(eq(projectCardLinks.id, id)).get() as CardLink
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.insert(cardLinks)
    .values({
      id,
      card_id: cardId,
      linked_type: linkedType,
      linked_url: linkedUrl,
      linked_remote_repo_key: linkedRemoteRepoKey ?? null,
      linked_number_or_iid: linkedNumberOrIid ?? null,
      created_at: now
    })
    .run()
  return db.select().from(cardLinks).where(eq(cardLinks.id, id)).get() as CardLink
}

/**
 * Ensure a card link exists (create if not).
 * @param cardId - The card ID
 * @param linkedType - Type of link (pr or mr)
 * @param linkedUrl - URL of the linked item
 * @param linkedRemoteRepoKey - Remote repository key
 * @param linkedNumberOrIid - Remote number or IID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function ensureCardLink(
  cardId: string,
  linkedType: 'pr' | 'mr',
  linkedUrl: string,
  linkedRemoteRepoKey?: string,
  linkedNumberOrIid?: string,
  projectId?: string
): CardLink {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const existing = db
        .select()
        .from(projectCardLinks)
        .where(
          and(eq(projectCardLinks.card_id, cardId), eq(projectCardLinks.linked_url, linkedUrl))
        )
        .limit(1)
        .get() as CardLink | undefined

      if (!existing) {
        return createCardLink(
          cardId,
          linkedType,
          linkedUrl,
          linkedRemoteRepoKey,
          linkedNumberOrIid,
          projectId
        )
      }

      const shouldUpdateNumber = !existing.linked_number_or_iid && linkedNumberOrIid
      const shouldUpdateRepoKey = !existing.linked_remote_repo_key && linkedRemoteRepoKey
      if (shouldUpdateNumber || shouldUpdateRepoKey) {
        db.update(projectCardLinks)
          .set({
            linked_remote_repo_key: linkedRemoteRepoKey ?? existing.linked_remote_repo_key,
            linked_number_or_iid: linkedNumberOrIid ?? existing.linked_number_or_iid
          })
          .where(eq(projectCardLinks.id, existing.id))
          .run()
        return db
          .select()
          .from(projectCardLinks)
          .where(eq(projectCardLinks.id, existing.id))
          .get() as CardLink
      }

      return existing
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const existing = db
    .select()
    .from(cardLinks)
    .where(and(eq(cardLinks.card_id, cardId), eq(cardLinks.linked_url, linkedUrl)))
    .limit(1)
    .get() as CardLink | undefined

  if (!existing) {
    return createCardLink(cardId, linkedType, linkedUrl, linkedRemoteRepoKey, linkedNumberOrIid)
  }

  const shouldUpdateNumber = !existing.linked_number_or_iid && linkedNumberOrIid
  const shouldUpdateRepoKey = !existing.linked_remote_repo_key && linkedRemoteRepoKey
  if (shouldUpdateNumber || shouldUpdateRepoKey) {
    db.update(cardLinks)
      .set({
        linked_remote_repo_key: linkedRemoteRepoKey ?? existing.linked_remote_repo_key,
        linked_number_or_iid: linkedNumberOrIid ?? existing.linked_number_or_iid
      })
      .where(eq(cardLinks.id, existing.id))
      .run()
    return db.select().from(cardLinks).where(eq(cardLinks.id, existing.id)).get() as CardLink
  }

  return existing
}
