/**
 * Card Link Database Operations
 */

import { and, desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { cardLinks, cards } from './schema'
import { generateId } from '@shared/utils'
import type { CardLink } from '@shared/types'

export type { CardLink }

/**
 * List links for a card.
 */
export function listCardLinks(cardId: string): CardLink[] {
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
  const db = getDrizzle()
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
 */
export function createCardLink(
  cardId: string,
  linkedType: 'pr' | 'mr',
  linkedUrl: string,
  linkedRemoteRepoKey?: string,
  linkedNumberOrIid?: string
): CardLink {
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()
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
 */
export function ensureCardLink(
  cardId: string,
  linkedType: 'pr' | 'mr',
  linkedUrl: string,
  linkedRemoteRepoKey?: string,
  linkedNumberOrIid?: string
): CardLink {
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
