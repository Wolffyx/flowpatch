/**
 * Event Database Operations
 */

import { desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { events } from './schema'
import { generateId } from '@shared/utils'
import type { Event, EventType } from '@shared/types'

export type { Event, EventType }

/**
 * List events for a project.
 */
export function listEvents(projectId: string, limit = 100): Event[] {
  const db = getDrizzle()
  return db
    .select()
    .from(events)
    .where(eq(events.project_id, projectId))
    .orderBy(desc(events.created_at))
    .limit(limit)
    .all() as Event[]
}

/**
 * List events for a card.
 */
export function listCardEvents(cardId: string, limit = 50): Event[] {
  const db = getDrizzle()
  return db
    .select()
    .from(events)
    .where(eq(events.card_id, cardId))
    .orderBy(desc(events.created_at))
    .limit(limit)
    .all() as Event[]
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
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()
  db.insert(events)
    .values({
      id,
      project_id: projectId,
      card_id: cardId ?? null,
      type,
      payload_json: payload ? JSON.stringify(payload) : null,
      created_at: now
    })
    .run()
  return db.select().from(events).where(eq(events.id, id)).get() as Event
}
