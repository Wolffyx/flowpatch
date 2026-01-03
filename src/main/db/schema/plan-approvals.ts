/**
 * Plan Approvals Table Schema
 */

import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import { cards } from './cards'
import { jobs } from './jobs'

export const planApprovals = sqliteTable(
  'plan_approvals',
  {
    id: text('id').primaryKey(),
    job_id: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    card_id: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    plan: text('plan').notNull(),
    planning_mode: text('planning_mode').notNull(),
    status: text('status').notNull().default('pending'),
    reviewer_notes: text('reviewer_notes'),
    created_at: text('created_at').notNull(),
    reviewed_at: text('reviewed_at')
  },
  (table) => [
    index('idx_plan_approvals_job').on(table.job_id),
    index('idx_plan_approvals_card').on(table.card_id),
    index('idx_plan_approvals_project').on(table.project_id),
    index('idx_plan_approvals_status').on(table.status)
  ]
)

export const planApprovalsRelations = relations(planApprovals, ({ one }) => ({
  job: one(jobs, {
    fields: [planApprovals.job_id],
    references: [jobs.id]
  }),
  card: one(cards, {
    fields: [planApprovals.card_id],
    references: [cards.id]
  }),
  project: one(projects, {
    fields: [planApprovals.project_id],
    references: [projects.id]
  })
}))

export type PlanApproval = typeof planApprovals.$inferSelect
export type NewPlanApproval = typeof planApprovals.$inferInsert
