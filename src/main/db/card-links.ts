/**
 * Card Link Database Operations
 */

import { getDb } from './connection'
import { generateId } from '@shared/utils'
import type { CardLink } from '@shared/types'

export type { CardLink }

/**
 * List links for a card.
 */
export function listCardLinks(cardId: string): CardLink[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM card_links WHERE card_id = ? ORDER BY created_at DESC')
  return stmt.all(cardId) as CardLink[]
}

/**
 * List links for all cards in a project.
 */
export function listCardLinksByProject(projectId: string): CardLink[] {
  const d = getDb()
  const stmt = d.prepare(`
    SELECT cl.* FROM card_links cl
    INNER JOIN cards c ON cl.card_id = c.id
    WHERE c.project_id = ?
    ORDER BY cl.created_at DESC
  `)
  return stmt.all(projectId) as CardLink[]
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
  const d = getDb()
  const id = generateId()
  const now = new Date().toISOString()
  d.prepare(
    `
    INSERT INTO card_links (id, card_id, linked_type, linked_url, linked_remote_repo_key, linked_number_or_iid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    cardId,
    linkedType,
    linkedUrl,
    linkedRemoteRepoKey ?? null,
    linkedNumberOrIid ?? null,
    now
  )
  return d.prepare('SELECT * FROM card_links WHERE id = ?').get(id) as CardLink
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
  const d = getDb()
  const existing = d
    .prepare('SELECT * FROM card_links WHERE card_id = ? AND linked_url = ? LIMIT 1')
    .get(cardId, linkedUrl) as CardLink | undefined

  if (!existing) {
    return createCardLink(cardId, linkedType, linkedUrl, linkedRemoteRepoKey, linkedNumberOrIid)
  }

  const shouldUpdateNumber = !existing.linked_number_or_iid && linkedNumberOrIid
  const shouldUpdateRepoKey = !existing.linked_remote_repo_key && linkedRemoteRepoKey
  if (shouldUpdateNumber || shouldUpdateRepoKey) {
    d.prepare(
      'UPDATE card_links SET linked_remote_repo_key = ?, linked_number_or_iid = ? WHERE id = ?'
    ).run(
      linkedRemoteRepoKey ?? existing.linked_remote_repo_key,
      linkedNumberOrIid ?? existing.linked_number_or_iid,
      existing.id
    )
    return d.prepare('SELECT * FROM card_links WHERE id = ?').get(existing.id) as CardLink
  }

  return existing
}
