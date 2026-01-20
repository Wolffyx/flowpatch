/**
 * Feature Suggestions Database Operations
 *
 * CRUD operations for feature suggestions and voting.
 */

import { and, count, desc, eq } from 'drizzle-orm'
import { featureSuggestions, featureSuggestionVotes } from './schema'
import {
  featureSuggestions as projectFeatureSuggestions,
  featureSuggestionVotes as projectFeatureSuggestionVotes
} from './schema/project'
import { resolveProjectDb } from './db-resolver'
import { generateId } from '@shared/utils'
import type {
  FeatureSuggestion,
  FeatureSuggestionVote,
  FeatureSuggestionStatus,
  FeatureSuggestionCategory
} from '@shared/types'

// ============================================================================
// Create Operations
// ============================================================================

export interface CreateFeatureSuggestionData {
  projectId: string
  title: string
  description: string
  category?: FeatureSuggestionCategory
  priority?: number
  createdBy?: string
}

/**
 * Create a new feature suggestion.
 */
export function createFeatureSuggestion(data: CreateFeatureSuggestionData): FeatureSuggestion {
  const { db, isLocalDb } = resolveProjectDb(data.projectId)
  const id = generateId()
  const now = new Date().toISOString()

  if (isLocalDb) {
    db.insert(projectFeatureSuggestions)
      .values({
        id,
        title: data.title,
        description: data.description,
        category: data.category ?? 'feature',
        priority: data.priority ?? 0,
        vote_count: 0,
        status: 'open',
        created_by: data.createdBy ?? null,
        created_at: now,
        updated_at: now
      })
      .run()
  } else {
    db.insert(featureSuggestions)
      .values({
        id,
        project_id: data.projectId,
        title: data.title,
        description: data.description,
        category: data.category ?? 'feature',
        priority: data.priority ?? 0,
        vote_count: 0,
        status: 'open',
        created_by: data.createdBy ?? null,
        created_at: now,
        updated_at: now
      })
      .run()
  }

  return {
    id,
    project_id: data.projectId,
    title: data.title,
    description: data.description,
    category: data.category ?? 'feature',
    priority: data.priority ?? 0,
    vote_count: 0,
    status: 'open',
    created_by: data.createdBy,
    created_at: now,
    updated_at: now
  }
}

// ============================================================================
// Read Operations
// ============================================================================

function rowToSuggestion(
  row: {
    id: string
    project_id?: string
    title: string
    description: string
    category: string
    priority: number
    vote_count: number
    status: string
    created_by: string | null
    created_at: string
    updated_at: string
  },
  projectId: string
): FeatureSuggestion {
  return {
    id: row.id,
    project_id: row.project_id ?? projectId,
    title: row.title,
    description: row.description,
    category: row.category as FeatureSuggestionCategory,
    priority: row.priority,
    vote_count: row.vote_count,
    status: row.status as FeatureSuggestionStatus,
    created_by: row.created_by ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function rowToVote(row: {
  id: string
  suggestion_id: string
  voter_id: string | null
  vote_type: string
  created_at: string
}): FeatureSuggestionVote {
  return {
    id: row.id,
    suggestion_id: row.suggestion_id,
    voter_id: row.voter_id ?? undefined,
    vote_type: row.vote_type as 'up' | 'down',
    created_at: row.created_at
  }
}

/**
 * Get a feature suggestion by ID.
 */
export function getFeatureSuggestion(
  projectId: string,
  suggestionId: string
): FeatureSuggestion | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const row = db
      .select()
      .from(projectFeatureSuggestions)
      .where(eq(projectFeatureSuggestions.id, suggestionId))
      .get()
    return row ? rowToSuggestion(row, projectId) : null
  }

  const row = db
    .select()
    .from(featureSuggestions)
    .where(
      and(eq(featureSuggestions.id, suggestionId), eq(featureSuggestions.project_id, projectId))
    )
    .get()
  return row ? rowToSuggestion(row, projectId) : null
}

export interface GetFeatureSuggestionsOptions {
  status?: FeatureSuggestionStatus
  category?: FeatureSuggestionCategory
  sortBy?: 'vote_count' | 'created_at' | 'priority' | 'updated_at'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/**
 * Get all feature suggestions for a project.
 */
export function getFeatureSuggestionsByProject(
  projectId: string,
  options: GetFeatureSuggestionsOptions = {}
): FeatureSuggestion[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  let rows: Array<{
    id: string
    project_id?: string
    title: string
    description: string
    category: string
    priority: number
    vote_count: number
    status: string
    created_by: string | null
    created_at: string
    updated_at: string
  }>

  if (isLocalDb) {
    rows = db.select().from(projectFeatureSuggestions).all()
  } else {
    rows = db
      .select()
      .from(featureSuggestions)
      .where(eq(featureSuggestions.project_id, projectId))
      .all()
  }

  // Apply additional filters
  if (options.status) {
    rows = rows.filter((r) => r.status === options.status)
  }

  if (options.category) {
    rows = rows.filter((r) => r.category === options.category)
  }

  // Sort
  const sortBy = options.sortBy ?? 'vote_count'
  const sortOrder = options.sortOrder ?? 'desc'

  rows.sort((a, b) => {
    let comparison = 0
    switch (sortBy) {
      case 'vote_count':
        comparison = a.vote_count - b.vote_count
        break
      case 'priority':
        comparison = a.priority - b.priority
        break
      case 'created_at':
        comparison = a.created_at.localeCompare(b.created_at)
        break
      case 'updated_at':
        comparison = a.updated_at.localeCompare(b.updated_at)
        break
    }
    return sortOrder === 'desc' ? -comparison : comparison
  })

  // Apply pagination
  if (options.offset) {
    rows = rows.slice(options.offset)
  }
  if (options.limit) {
    rows = rows.slice(0, options.limit)
  }

  return rows.map((r) => rowToSuggestion(r, projectId))
}

/**
 * Count feature suggestions for a project.
 */
export function countFeatureSuggestions(
  projectId: string,
  status?: FeatureSuggestionStatus
): number {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    if (status) {
      const result = db
        .select({ count: count() })
        .from(projectFeatureSuggestions)
        .where(eq(projectFeatureSuggestions.status, status))
        .get()
      return result?.count ?? 0
    }

    const result = db.select({ count: count() }).from(projectFeatureSuggestions).get()
    return result?.count ?? 0
  }

  if (status) {
    const result = db
      .select({ count: count() })
      .from(featureSuggestions)
      .where(
        and(eq(featureSuggestions.project_id, projectId), eq(featureSuggestions.status, status))
      )
      .get()
    return result?.count ?? 0
  }

  const result = db
    .select({ count: count() })
    .from(featureSuggestions)
    .where(eq(featureSuggestions.project_id, projectId))
    .get()
  return result?.count ?? 0
}

// ============================================================================
// Update Operations
// ============================================================================

export interface UpdateFeatureSuggestionData {
  title?: string
  description?: string
  category?: FeatureSuggestionCategory
  priority?: number
  status?: FeatureSuggestionStatus
}

/**
 * Update a feature suggestion.
 */
export function updateFeatureSuggestion(
  projectId: string,
  suggestionId: string,
  data: UpdateFeatureSuggestionData
): FeatureSuggestion | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const now = new Date().toISOString()

  const updateData: Record<string, unknown> = { updated_at: now }

  if (data.title !== undefined) updateData.title = data.title
  if (data.description !== undefined) updateData.description = data.description
  if (data.category !== undefined) updateData.category = data.category
  if (data.priority !== undefined) updateData.priority = data.priority
  if (data.status !== undefined) updateData.status = data.status

  if (isLocalDb) {
    const result = db
      .update(projectFeatureSuggestions)
      .set(updateData)
      .where(eq(projectFeatureSuggestions.id, suggestionId))
      .run()

    if (result.changes === 0) return null
  } else {
    const result = db
      .update(featureSuggestions)
      .set(updateData)
      .where(
        and(eq(featureSuggestions.id, suggestionId), eq(featureSuggestions.project_id, projectId))
      )
      .run()

    if (result.changes === 0) return null
  }

  return getFeatureSuggestion(projectId, suggestionId)
}

/**
 * Update the status of a feature suggestion.
 */
export function updateFeatureSuggestionStatus(
  projectId: string,
  suggestionId: string,
  status: FeatureSuggestionStatus
): boolean {
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const now = new Date().toISOString()

  if (isLocalDb) {
    const result = db
      .update(projectFeatureSuggestions)
      .set({ status, updated_at: now })
      .where(eq(projectFeatureSuggestions.id, suggestionId))
      .run()
    return result.changes > 0
  }

  const result = db
    .update(featureSuggestions)
    .set({ status, updated_at: now })
    .where(
      and(eq(featureSuggestions.id, suggestionId), eq(featureSuggestions.project_id, projectId))
    )
    .run()
  return result.changes > 0
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete a feature suggestion.
 */
export function deleteFeatureSuggestion(projectId: string, suggestionId: string): boolean {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const result = db
      .delete(projectFeatureSuggestions)
      .where(eq(projectFeatureSuggestions.id, suggestionId))
      .run()
    return result.changes > 0
  }

  const result = db
    .delete(featureSuggestions)
    .where(
      and(eq(featureSuggestions.id, suggestionId), eq(featureSuggestions.project_id, projectId))
    )
    .run()
  return result.changes > 0
}

/**
 * Delete all feature suggestions for a project.
 */
export function deleteFeatureSuggestionsByProject(projectId: string): number {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const result = db.delete(projectFeatureSuggestions).run()
    return result.changes
  }

  const result = db
    .delete(featureSuggestions)
    .where(eq(featureSuggestions.project_id, projectId))
    .run()
  return result.changes
}

// ============================================================================
// Voting Operations
// ============================================================================

/**
 * Vote on a feature suggestion.
 * Returns the updated vote count, or null if voting failed.
 */
export function voteOnSuggestion(
  projectId: string,
  suggestionId: string,
  voteType: 'up' | 'down',
  voterId?: string
): { voteCount: number; userVote: 'up' | 'down' | null } | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const now = new Date().toISOString()

  // Check if suggestion exists
  const suggestion = getFeatureSuggestion(projectId, suggestionId)
  if (!suggestion) return null

  // Check for existing vote by this voter (use 'anonymous' if no voter ID)
  const effectiveVoterId = voterId ?? 'anonymous'

  const suggestionsTable = isLocalDb ? projectFeatureSuggestions : featureSuggestions
  const votesTable = isLocalDb ? projectFeatureSuggestionVotes : featureSuggestionVotes

  const existingVote = db
    .select()
    .from(votesTable)
    .where(
      and(eq(votesTable.suggestion_id, suggestionId), eq(votesTable.voter_id, effectiveVoterId))
    )
    .get()

  if (existingVote) {
    // If same vote type, remove the vote (toggle off)
    if (existingVote.vote_type === voteType) {
      db.delete(votesTable).where(eq(votesTable.id, existingVote.id)).run()

      // Update vote count
      const delta = voteType === 'up' ? -1 : 1
      db.update(suggestionsTable)
        .set({
          vote_count: suggestion.vote_count + delta,
          updated_at: now
        })
        .where(eq(suggestionsTable.id, suggestionId))
        .run()

      const updated = getFeatureSuggestion(projectId, suggestionId)
      return { voteCount: updated?.vote_count ?? 0, userVote: null }
    }

    // Different vote type - change the vote
    db.update(votesTable)
      .set({ vote_type: voteType, created_at: now })
      .where(eq(votesTable.id, existingVote.id))
      .run()

    // Update vote count (swing of 2: remove old vote effect, add new)
    const delta = voteType === 'up' ? 2 : -2
    db.update(suggestionsTable)
      .set({
        vote_count: suggestion.vote_count + delta,
        updated_at: now
      })
      .where(eq(suggestionsTable.id, suggestionId))
      .run()

    const updated = getFeatureSuggestion(projectId, suggestionId)
    return { voteCount: updated?.vote_count ?? 0, userVote: voteType }
  }

  // No existing vote - create new vote
  const voteId = generateId()
  db.insert(votesTable)
    .values({
      id: voteId,
      suggestion_id: suggestionId,
      voter_id: effectiveVoterId,
      vote_type: voteType,
      created_at: now
    })
    .run()

  // Update vote count
  const delta = voteType === 'up' ? 1 : -1
  db.update(suggestionsTable)
    .set({
      vote_count: suggestion.vote_count + delta,
      updated_at: now
    })
    .where(eq(suggestionsTable.id, suggestionId))
    .run()

  const updated = getFeatureSuggestion(projectId, suggestionId)
  return { voteCount: updated?.vote_count ?? 0, userVote: voteType }
}

/**
 * Get a user's vote on a suggestion.
 */
export function getUserVote(
  projectId: string,
  suggestionId: string,
  voterId?: string
): FeatureSuggestionVote | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const effectiveVoterId = voterId ?? 'anonymous'

  const votesTable = isLocalDb ? projectFeatureSuggestionVotes : featureSuggestionVotes

  const row = db
    .select()
    .from(votesTable)
    .where(
      and(eq(votesTable.suggestion_id, suggestionId), eq(votesTable.voter_id, effectiveVoterId))
    )
    .get()
  return row ? rowToVote(row) : null
}

/**
 * Get all votes for a suggestion.
 */
export function getVotesForSuggestion(
  projectId: string,
  suggestionId: string
): FeatureSuggestionVote[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  const votesTable = isLocalDb ? projectFeatureSuggestionVotes : featureSuggestionVotes

  const rows = db
    .select()
    .from(votesTable)
    .where(eq(votesTable.suggestion_id, suggestionId))
    .orderBy(desc(votesTable.created_at))
    .all()
  return rows.map(rowToVote)
}

/**
 * Remove a user's vote from a suggestion.
 */
export function removeVote(projectId: string, suggestionId: string, voterId?: string): boolean {
  const { db, isLocalDb } = resolveProjectDb(projectId)
  const effectiveVoterId = voterId ?? 'anonymous'
  const now = new Date().toISOString()

  // Get the vote to know how to adjust count
  const vote = getUserVote(projectId, suggestionId, voterId)
  if (!vote) return false

  const suggestionsTable = isLocalDb ? projectFeatureSuggestions : featureSuggestions
  const votesTable = isLocalDb ? projectFeatureSuggestionVotes : featureSuggestionVotes

  // Delete the vote
  const result = db
    .delete(votesTable)
    .where(
      and(eq(votesTable.suggestion_id, suggestionId), eq(votesTable.voter_id, effectiveVoterId))
    )
    .run()

  if (result.changes > 0) {
    // Adjust vote count
    const suggestion = getFeatureSuggestion(projectId, suggestionId)
    if (suggestion) {
      const delta = vote.vote_type === 'up' ? -1 : 1
      db.update(suggestionsTable)
        .set({
          vote_count: suggestion.vote_count + delta,
          updated_at: now
        })
        .where(eq(suggestionsTable.id, suggestionId))
        .run()
    }
    return true
  }

  return false
}
