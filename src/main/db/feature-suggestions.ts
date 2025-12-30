/**
 * Feature Suggestions Database Operations
 *
 * CRUD operations for feature suggestions and voting.
 */

import { generateId } from '@shared/utils'
import { getDb } from './connection'
import type {
  FeatureSuggestion,
  FeatureSuggestionVote,
  FeatureSuggestionStatus,
  FeatureSuggestionCategory
} from '@shared/types'

// ============================================================================
// Type Definitions
// ============================================================================

interface FeatureSuggestionRow {
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
}

interface FeatureSuggestionVoteRow {
  id: string
  suggestion_id: string
  voter_id: string | null
  vote_type: string
  created_at: string
}

function rowToSuggestion(row: FeatureSuggestionRow): FeatureSuggestion {
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

function rowToVote(row: FeatureSuggestionVoteRow): FeatureSuggestionVote {
  return {
    id: row.id,
    suggestion_id: row.suggestion_id,
    voter_id: row.voter_id ?? undefined,
    vote_type: row.vote_type as 'up' | 'down',
    created_at: row.created_at
  }
}

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
  const db = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO feature_suggestions (
      id, project_id, title, description, category, priority, vote_count, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    data.projectId,
    data.title,
    data.description,
    data.category ?? 'feature',
    data.priority ?? 0,
    0, // vote_count starts at 0
    'open', // status starts as open
    data.createdBy ?? null,
    now,
    now
  )

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

/**
 * Get a feature suggestion by ID.
 */
export function getFeatureSuggestion(suggestionId: string): FeatureSuggestion | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM feature_suggestions WHERE id = ?')
  const row = stmt.get(suggestionId) as FeatureSuggestionRow | undefined
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
  const db = getDb()

  const conditions: string[] = ['project_id = ?']
  const values: (string | number)[] = [projectId]

  if (options.status) {
    conditions.push('status = ?')
    values.push(options.status)
  }

  if (options.category) {
    conditions.push('category = ?')
    values.push(options.category)
  }

  const sortBy = options.sortBy ?? 'vote_count'
  const sortOrder = options.sortOrder ?? 'desc'
  const validSortColumns = ['vote_count', 'created_at', 'priority', 'updated_at']
  const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'vote_count'

  let sql = `SELECT * FROM feature_suggestions WHERE ${conditions.join(' AND ')} ORDER BY ${sortColumn} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`

  if (options.limit) {
    sql += ' LIMIT ?'
    values.push(options.limit)
    if (options.offset) {
      sql += ' OFFSET ?'
      values.push(options.offset)
    }
  }

  const stmt = db.prepare(sql)
  const rows = stmt.all(...values) as FeatureSuggestionRow[]
  return rows.map(rowToSuggestion)
}

/**
 * Count feature suggestions for a project.
 */
export function countFeatureSuggestions(
  projectId: string,
  status?: FeatureSuggestionStatus
): number {
  const db = getDb()

  if (status) {
    const stmt = db.prepare(
      'SELECT COUNT(*) as count FROM feature_suggestions WHERE project_id = ? AND status = ?'
    )
    const row = stmt.get(projectId, status) as { count: number }
    return row.count
  }

  const stmt = db.prepare('SELECT COUNT(*) as count FROM feature_suggestions WHERE project_id = ?')
  const row = stmt.get(projectId) as { count: number }
  return row.count
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
  const db = getDb()
  const now = new Date().toISOString()

  const updates: string[] = ['updated_at = ?']
  const values: (string | number)[] = [now]

  if (data.title !== undefined) {
    updates.push('title = ?')
    values.push(data.title)
  }
  if (data.description !== undefined) {
    updates.push('description = ?')
    values.push(data.description)
  }
  if (data.category !== undefined) {
    updates.push('category = ?')
    values.push(data.category)
  }
  if (data.priority !== undefined) {
    updates.push('priority = ?')
    values.push(data.priority)
  }
  if (data.status !== undefined) {
    updates.push('status = ?')
    values.push(data.status)
  }

  values.push(suggestionId)
  const stmt = db.prepare(`UPDATE feature_suggestions SET ${updates.join(', ')} WHERE id = ?`)
  const result = stmt.run(...values)

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
  const db = getDb()
  const now = new Date().toISOString()

  const stmt = db.prepare(
    'UPDATE feature_suggestions SET status = ?, updated_at = ? WHERE id = ?'
  )
  const result = stmt.run(status, now, suggestionId)
  return result.changes > 0
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete a feature suggestion.
 */
export function deleteFeatureSuggestion(suggestionId: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM feature_suggestions WHERE id = ?')
  const result = stmt.run(suggestionId)
  return result.changes > 0
}

/**
 * Delete all feature suggestions for a project.
 */
export function deleteFeatureSuggestionsByProject(projectId: string): number {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM feature_suggestions WHERE project_id = ?')
  const result = stmt.run(projectId)
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
  const db = getDb()
  const now = new Date().toISOString()

  // Check if suggestion exists
  const suggestion = getFeatureSuggestion(suggestionId)
  if (!suggestion) return null

  // Check for existing vote by this voter (use 'anonymous' if no voter ID)
  const effectiveVoterId = voterId ?? 'anonymous'
  const existingVote = db
    .prepare('SELECT * FROM feature_suggestion_votes WHERE suggestion_id = ? AND voter_id = ?')
    .get(suggestionId, effectiveVoterId) as FeatureSuggestionVoteRow | undefined

  if (existingVote) {
    // If same vote type, remove the vote (toggle off)
    if (existingVote.vote_type === voteType) {
      db.prepare('DELETE FROM feature_suggestion_votes WHERE id = ?').run(existingVote.id)

      // Update vote count
      const delta = voteType === 'up' ? -1 : 1
      db.prepare(
        'UPDATE feature_suggestions SET vote_count = vote_count + ?, updated_at = ? WHERE id = ?'
      ).run(delta, now, suggestionId)

      const updated = getFeatureSuggestion(suggestionId)
      return { voteCount: updated?.vote_count ?? 0, userVote: null }
    }

    // Different vote type - change the vote
    db.prepare(
      'UPDATE feature_suggestion_votes SET vote_type = ?, created_at = ? WHERE id = ?'
    ).run(voteType, now, existingVote.id)

    // Update vote count (swing of 2: remove old vote effect, add new)
    const delta = voteType === 'up' ? 2 : -2
    db.prepare(
      'UPDATE feature_suggestions SET vote_count = vote_count + ?, updated_at = ? WHERE id = ?'
    ).run(delta, now, suggestionId)

    const updated = getFeatureSuggestion(suggestionId)
    return { voteCount: updated?.vote_count ?? 0, userVote: voteType }
  }

  // No existing vote - create new vote
  const voteId = generateId()
  db.prepare(`
    INSERT INTO feature_suggestion_votes (id, suggestion_id, voter_id, vote_type, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(voteId, suggestionId, effectiveVoterId, voteType, now)

  // Update vote count
  const delta = voteType === 'up' ? 1 : -1
  db.prepare(
    'UPDATE feature_suggestions SET vote_count = vote_count + ?, updated_at = ? WHERE id = ?'
  ).run(delta, now, suggestionId)

  const updated = getFeatureSuggestion(suggestionId)
  return { voteCount: updated?.vote_count ?? 0, userVote: voteType }
}

/**
 * Get a user's vote on a suggestion.
 */
export function getUserVote(
  suggestionId: string,
  voterId?: string
): FeatureSuggestionVote | null {
  const db = getDb()
  const effectiveVoterId = voterId ?? 'anonymous'

  const stmt = db.prepare(
    'SELECT * FROM feature_suggestion_votes WHERE suggestion_id = ? AND voter_id = ?'
  )
  const row = stmt.get(suggestionId, effectiveVoterId) as FeatureSuggestionVoteRow | undefined
  return row ? rowToVote(row) : null
}

/**
 * Get all votes for a suggestion.
 */
export function getVotesForSuggestion(suggestionId: string): FeatureSuggestionVote[] {
  const db = getDb()
  const stmt = db.prepare(
    'SELECT * FROM feature_suggestion_votes WHERE suggestion_id = ? ORDER BY created_at DESC'
  )
  const rows = stmt.all(suggestionId) as FeatureSuggestionVoteRow[]
  return rows.map(rowToVote)
}

/**
 * Remove a user's vote from a suggestion.
 */
export function removeVote(suggestionId: string, voterId?: string): boolean {
  const db = getDb()
  const effectiveVoterId = voterId ?? 'anonymous'
  const now = new Date().toISOString()

  // Get the vote to know how to adjust count
  const vote = getUserVote(suggestionId, voterId)
  if (!vote) return false

  // Delete the vote
  const result = db
    .prepare('DELETE FROM feature_suggestion_votes WHERE suggestion_id = ? AND voter_id = ?')
    .run(suggestionId, effectiveVoterId)

  if (result.changes > 0) {
    // Adjust vote count
    const delta = vote.vote_type === 'up' ? -1 : 1
    db.prepare(
      'UPDATE feature_suggestions SET vote_count = vote_count + ?, updated_at = ? WHERE id = ?'
    ).run(delta, now, suggestionId)
    return true
  }

  return false
}
