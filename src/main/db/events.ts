/**
 * Event Database Operations
 */

import { getDb } from './connection'
import { generateId } from '@shared/utils'
import type { Event, EventType } from '@shared/types'

export type { Event, EventType }

/**
 * List events for a project.
 */
export function listEvents(projectId: string, limit = 100): Event[] {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
  )
  return stmt.all(projectId, limit) as Event[]
}

/**
 * List events for a card.
 */
export function listCardEvents(cardId: string, limit = 50): Event[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM events WHERE card_id = ? ORDER BY created_at DESC LIMIT ?')
  return stmt.all(cardId, limit) as Event[]
}

/**
 * Create an event.
 */
export function createEvent(
  projectId: string,
  type: EventType,
  cardId?: string,
  payload?: unknown
): Event {
  const d = getDb()
  const id = generateId()
  const now = new Date().toISOString()
  d.prepare(
    `
    INSERT INTO events (id, project_id, card_id, type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(id, projectId, cardId ?? null, type, payload ? JSON.stringify(payload) : null, now)
  return d.prepare('SELECT * FROM events WHERE id = ?').get(id) as Event
}
