/**
 * Card Dependencies Table Schema
 */

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cards } from './cards'

export const cardDependencies = sqliteTable(
  'card_dependencies',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    card_id: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    depends_on_card_id: text('depends_on_card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    blocking_statuses_json: text('blocking_statuses_json').notNull().default('["ready","in_progress"]'),
    required_status: text('required_status').notNull().default('done'),
    is_active: integer('is_active').notNull().default(1),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    index('idx_card_deps_project').on(table.project_id),
    index('idx_card_deps_card').on(table.card_id),
    index('idx_card_deps_depends_on').on(table.depends_on_card_id),
    index('idx_card_deps_active').on(table.card_id, table.is_active),
    uniqueIndex('idx_card_deps_unique').on(table.card_id, table.depends_on_card_id)
  ]
)

export const cardDependenciesRelations = relations(cardDependencies, ({ one }) => ({
  project: one(projects, {
    fields: [cardDependencies.project_id],
    references: [projects.id]
  }),
  card: one(cards, {
    fields: [cardDependencies.card_id],
    references: [cards.id],
    relationName: 'cardDependencies'
  }),
  dependsOnCard: one(cards, {
    fields: [cardDependencies.depends_on_card_id],
    references: [cards.id],
    relationName: 'cardDependents'
  })
}))

export type CardDependency = typeof cardDependencies.$inferSelect
export type NewCardDependency = typeof cardDependencies.$inferInsert
