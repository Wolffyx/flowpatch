/**
 * Subtasks Table Schema
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cards } from './cards'

export const subtasks = sqliteTable(
  'subtasks',
  {
    id: text('id').primaryKey(),
    parent_card_id: text('parent_card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    estimated_minutes: integer('estimated_minutes'),
    sequence: integer('sequence').notNull().default(0),
    status: text('status').notNull().default('pending'),
    remote_issue_number: text('remote_issue_number'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    completed_at: text('completed_at')
  },
  (table) => [
    index('idx_subtasks_parent').on(table.parent_card_id),
    index('idx_subtasks_project').on(table.project_id),
    index('idx_subtasks_status').on(table.status)
  ]
)

export const subtasksRelations = relations(subtasks, ({ one }) => ({
  parentCard: one(cards, {
    fields: [subtasks.parent_card_id],
    references: [cards.id]
  }),
  project: one(projects, {
    fields: [subtasks.project_id],
    references: [projects.id]
  })
}))

export type Subtask = typeof subtasks.$inferSelect
export type NewSubtask = typeof subtasks.$inferInsert
