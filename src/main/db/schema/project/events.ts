/**
 * Events Table Schema (Project DB)
 */

import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { cards } from './cards'

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    card_id: text('card_id').references(() => cards.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload_json: text('payload_json'),
    created_at: text('created_at').notNull()
  },
  (table) => [
    index('idx_events_card_id').on(table.card_id),
    index('idx_events_created_at').on(table.created_at)
  ]
)

export const eventsRelations = relations(events, ({ one }) => ({
  card: one(cards, {
    fields: [events.card_id],
    references: [cards.id]
  })
}))

export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
