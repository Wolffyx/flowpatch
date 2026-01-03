/**
 * Feature Suggestions Database Operations
 *
 * CRUD operations for feature suggestions and voting.
 */

import { and, count, desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { featureSuggestions, featureSuggestionVotes } from './schema'
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
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

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

function rowToSuggestion(row: {
  id: string
  project_id: string
  title: string
  description: string
  category: string
  priority: number
  vote_count: number
  status: string
  created_by: string | null
  created_at: string
  updated_at: string
}): FeatureSuggestion {
  return {
    id: row.id,
    project_id: row.project_id,
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
export function getFeatureSuggestion(suggestionId: string): FeatureSuggestion | null {
  const db = getDrizzle()
  const row = db
    .select()
    .from(featureSuggestions)
    .where(eq(featureSuggestions.id, suggestionId))
    .get()
  return row ? rowToSuggestion(row) : null
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
  const db = getDrizzle()

  // Build base query - we'll handle conditions dynamically
  let rows = db
    .select()
    .from(featureSuggestions)
    .where(eq(featureSuggestions.project_id, projectId))
    .all()

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

  return rows.map(rowToSuggestion)
}

/**
 * Count feature suggestions for a project.
 */
export function countFeatureSuggestions(
  projectId: string,
  status?: FeatureSuggestionStatus
): number {
  const db = getDrizzle()

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
  suggestionId: string,
  data: UpdateFeatureSuggestionData
): FeatureSuggestion | null {
  const db = getDrizzle()
  const now = new Date().toISOString()

  const updateData: Record<string, unknown> = { updated_at: now }

  if (data.title !== undefined) updateData.title = data.title
  if (data.description !== undefined) updateData.description = data.description
  if (data.category !== undefined) updateData.category = data.category
  if (data.priority !== undefined) updateData.priority = data.priority
  if (data.status !== undefined) updateData.status = data.status

  const result = db
    .update(featureSuggestions)
    .set(updateData)
    .where(eq(featureSuggestions.id, suggestionId))
    .run()

  if (result.changes === 0) return null
  return getFeatureSuggestion(suggestionId)
}

/**
 * Update the status of a feature suggestion.
 */
export function updateFeatureSuggestionStatus(
  suggestionId: string,
  status: FeatureSuggestionStatus
): boolean {
  const db = getDrizzle()
  const now = new Date().toISOString()

  const result = db
    .update(featureSuggestions)
    .set({ status, updated_at: now })
    .where(eq(featureSuggestions.id, suggestionId))
    .run()
  return result.changes > 0
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete a feature suggestion.
 */
export function deleteFeatureSuggestion(suggestionId: string): boolean {
  const db = getDrizzle()
  const result = db
    .delete(featureSuggestions)
    .where(eq(featureSuggestions.id, suggestionId))
    .run()
  return result.changes > 0
}

/**
 * Delete all feature suggestions for a project.
 */
export function deleteFeatureSuggestionsByProject(projectId: string): number {
  const db = getDrizzle()
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
  suggestionId: string,
  voteType: 'up' | 'down',
  voterId?: string
): { voteCount: number; userVote: 'up' | 'down' | null } | null {
  const db = getDrizzle()
  const now = new Date().toISOString()

  // Check if suggestion exists
  const suggestion = getFeatureSuggestion(suggestionId)
  if (!suggestion) return null

  // Check for existing vote by this voter (use 'anonymous' if no voter ID)
  const effectiveVoterId = voterId ?? 'anonymous'
  const existingVote = db
    .select()
    .from(featureSuggestionVotes)
    .where(
      and(
        eq(featureSuggestionVotes.suggestion_id, suggestionId),
        eq(featureSuggestionVotes.voter_id, effectiveVoterId)
      )
    )
    .get()

  if (existingVote) {
    // If same vote type, remove the vote (toggle off)
    if (existingVote.vote_type === voteType) {
      db.delete(featureSuggestionVotes).where(eq(featureSuggestionVotes.id, existingVote.id)).run()

      // Update vote count
      const delta = voteType === 'up' ? -1 : 1
      db.update(featureSuggestions)
        .set({
          vote_count: suggestion.vote_count + delta,
          updated_at: now
        })
        .where(eq(featureSuggestions.id, suggestionId))
        .run()

      const updated = getFeatureSuggestion(suggestionId)
      return { voteCount: updated?.vote_count ?? 0, userVote: null }
    }

    // Different vote type - change the vote
    db.update(featureSuggestionVotes)
      .set({ vote_type: voteType, created_at: now })
      .where(eq(featureSuggestionVotes.id, existingVote.id))
      .run()

    // Update vote count (swing of 2: remove old vote effect, add new)
    const delta = voteType === 'up' ? 2 : -2
    db.update(featureSuggestions)
      .set({
        vote_count: suggestion.vote_count + delta,
        updated_at: now
      })
      .where(eq(featureSuggestions.id, suggestionId))
      .run()

    const updated = getFeatureSuggestion(suggestionId)
    return { voteCount: updated?.vote_count ?? 0, userVote: voteType }
  }

  // No existing vote - create new vote
  const voteId = generateId()
  db.insert(featureSuggestionVotes)
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
  db.update(featureSuggestions)
    .set({
      vote_count: suggestion.vote_count + delta,
      updated_at: now
    })
    .where(eq(featureSuggestions.id, suggestionId))
    .run()

  const updated = getFeatureSuggestion(suggestionId)
  return { voteCount: updated?.vote_count ?? 0, userVote: voteType }
}

/**
 * Get a user's vote on a suggestion.
 */
export function getUserVote(suggestionId: string, voterId?: string): FeatureSuggestionVote | null {
  const db = getDrizzle()
  const effectiveVoterId = voterId ?? 'anonymous'

  const row = db
    .select()
    .from(featureSuggestionVotes)
    .where(
      and(
        eq(featureSuggestionVotes.suggestion_id, suggestionId),
        eq(featureSuggestionVotes.voter_id, effectiveVoterId)
      )
    )
    .get()
  return row ? rowToVote(row) : null
}

/**
 * Get all votes for a suggestion.
 */
export function getVotesForSuggestion(suggestionId: string): FeatureSuggestionVote[] {
  const db = getDrizzle()
  const rows = db
    .select()
    .from(featureSuggestionVotes)
    .where(eq(featureSuggestionVotes.suggestion_id, suggestionId))
    .orderBy(desc(featureSuggestionVotes.created_at))
    .all()
  return rows.map(rowToVote)
}

/**
 * Remove a user's vote from a suggestion.
 */
export function removeVote(suggestionId: string, voterId?: string): boolean {
  const db = getDrizzle()
  const effectiveVoterId = voterId ?? 'anonymous'
  const now = new Date().toISOString()

  // Get the vote to know how to adjust count
  const vote = getUserVote(suggestionId, voterId)
  if (!vote) return false

  // Delete the vote
  const result = db
    .delete(featureSuggestionVotes)
    .where(
      and(
        eq(featureSuggestionVotes.suggestion_id, suggestionId),
        eq(featureSuggestionVotes.voter_id, effectiveVoterId)
      )
    )
    .run()

  if (result.changes > 0) {
    // Adjust vote count
    const suggestion = getFeatureSuggestion(suggestionId)
    if (suggestion) {
      const delta = vote.vote_type === 'up' ? -1 : 1
      db.update(featureSuggestions)
        .set({
          vote_count: suggestion.vote_count + delta,
          updated_at: now
        })
        .where(eq(featureSuggestions.id, suggestionId))
        .run()
    }
    return true
  }

  return false
}
