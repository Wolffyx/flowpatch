/**
 * Event Database Operations
 *
 * Supports both central database (legacy) and project-local database.
 */

import { desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { events } from './schema'
import { events as projectEvents } from './schema/project'
import { generateId } from '@shared/utils'
import type { Event, EventType } from '@shared/types'
import { resolveProjectDb } from './db-resolver'

export type { Event, EventType }

/**
 * List events for a project.
 */
export function listEvents(projectId: string, limit = 100): Event[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - no project_id filter needed (implicit)
    const rows = db
      .select()
      .from(projectEvents)
      .orderBy(desc(projectEvents.created_at))
      .limit(limit)
      .all()
    // Add project_id to match Event type
    return rows.map((r) => ({ ...r, project_id: projectId })) as Event[]
  }

  // Central DB - filter by project_id
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
 * @param cardId - The card ID
 * @param limit - Maximum number of events to return
 * @param projectId - Optional project ID for direct DB resolution
 */
export function listCardEvents(cardId: string, limit = 50, projectId?: string): Event[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectEvents)
        .where(eq(projectEvents.card_id, cardId))
        .orderBy(desc(projectEvents.created_at))
        .limit(limit)
        .all()
      return rows.map((r) => ({ ...r, project_id: projectId })) as Event[]
    }
  }

  // Central DB fallback
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
 * Safely stringify an object, handling circular references.
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }
    // Handle Error objects specially
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      }
    }
    return value
  })
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
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const id = generateId()
  const now = new Date().toISOString()

  // Use safe stringify to handle any circular references in payload
  const payloadJson = payload ? safeStringify(payload) : null

  if (isLocalDb) {
    // Project DB - no project_id column
    db.insert(projectEvents)
      .values({
        id,
        card_id: cardId ?? null,
        type,
        payload_json: payloadJson,
        created_at: now
      })
      .run()
    const row = db.select().from(projectEvents).where(eq(projectEvents.id, id)).get()
    return { ...row!, project_id: projectId } as Event
  }

  // Central DB - includes project_id
  db.insert(events)
    .values({
      id,
      project_id: projectId,
      card_id: cardId ?? null,
      type,
      payload_json: payloadJson,
      created_at: now
    })
    .run()
  return db.select().from(events).where(eq(events.id, id)).get() as Event
}
