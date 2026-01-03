/**
 * Feature Suggestions Table Schema
 */

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'

export const featureSuggestions = sqliteTable(
  'feature_suggestions',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull().default('feature'),
    priority: integer('priority').notNull().default(0),
    vote_count: integer('vote_count').notNull().default(0),
    status: text('status').notNull().default('open'),
    created_by: text('created_by'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull()
  },
  (table) => [
    index('idx_feature_suggestions_project').on(table.project_id),
    index('idx_feature_suggestions_status').on(table.status),
    index('idx_feature_suggestions_category').on(table.category),
    index('idx_feature_suggestions_votes').on(table.vote_count)
  ]
)

export const featureSuggestionsRelations = relations(featureSuggestions, ({ one, many }) => ({
  project: one(projects, {
    fields: [featureSuggestions.project_id],
    references: [projects.id]
  }),
  votes: many(featureSuggestionVotes)
}))

export const featureSuggestionVotes = sqliteTable(
  'feature_suggestion_votes',
  {
    id: text('id').primaryKey(),
    suggestion_id: text('suggestion_id')
      .notNull()
      .references(() => featureSuggestions.id, { onDelete: 'cascade' }),
    voter_id: text('voter_id'),
    vote_type: text('vote_type').notNull(),
    created_at: text('created_at').notNull()
  },
  (table) => [
    index('idx_feature_votes_suggestion').on(table.suggestion_id),
    uniqueIndex('idx_feature_votes_unique').on(table.suggestion_id, table.voter_id)
  ]
)

export const featureSuggestionVotesRelations = relations(featureSuggestionVotes, ({ one }) => ({
  suggestion: one(featureSuggestions, {
    fields: [featureSuggestionVotes.suggestion_id],
    references: [featureSuggestions.id]
  })
}))

export type FeatureSuggestion = typeof featureSuggestions.$inferSelect
export type NewFeatureSuggestion = typeof featureSuggestions.$inferInsert
export type FeatureSuggestionVote = typeof featureSuggestionVotes.$inferSelect
export type NewFeatureSuggestionVote = typeof featureSuggestionVotes.$inferInsert
