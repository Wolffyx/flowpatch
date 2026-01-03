/**
 * Events Table Schema
 */

import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cards } from './cards'

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    card_id: text('card_id').references(() => cards.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload_json: text('payload_json'),
    created_at: text('created_at').notNull()
  },
  (table) => [
    index('idx_events_project_id').on(table.project_id),
    index('idx_events_card_id').on(table.card_id),
    index('idx_events_created_at').on(table.created_at)
  ]
)

export const eventsRelations = relations(events, ({ one }) => ({
  project: one(projects, {
    fields: [events.project_id],
    references: [projects.id]
  }),
  card: one(cards, {
    fields: [events.card_id],
    references: [cards.id]
  })
}))

export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
