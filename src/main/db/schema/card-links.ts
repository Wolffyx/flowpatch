/**
 * Card Links Table Schema
 */

import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { cards } from './cards'

export const cardLinks = sqliteTable(
  'card_links',
  {
    id: text('id').primaryKey(),
    card_id: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    linked_type: text('linked_type').notNull(),
    linked_url: text('linked_url').notNull(),
    linked_remote_repo_key: text('linked_remote_repo_key'),
    linked_number_or_iid: text('linked_number_or_iid'),
    created_at: text('created_at').notNull()
  },
  (table) => [index('idx_card_links_card_id').on(table.card_id)]
)

export const cardLinksRelations = relations(cardLinks, ({ one }) => ({
  card: one(cards, {
    fields: [cardLinks.card_id],
    references: [cards.id]
  })
}))

export type CardLink = typeof cardLinks.$inferSelect
export type NewCardLink = typeof cardLinks.$inferInsert
