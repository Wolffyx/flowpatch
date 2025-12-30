/**
 * Card Dependencies Database Operations
 *
 * CRUD operations for card dependency blocking.
 */

import { generateId } from '@shared/utils'
import { getDb } from './connection'
import type {
  CardDependency,
  CardDependencyWithCard,
  CardStatus,
  DependencyCheckResult
} from '@shared/types'

// ============================================================================
// Type Definitions
// ============================================================================

interface CardDependencyRow {
  id: string
  project_id: string
  card_id: string
  depends_on_card_id: string
  blocking_statuses_json: string
  required_status: string
  is_active: number
  created_at: string
  updated_at: string
}

interface CardRow {
  id: string
  project_id: string
  title: string
  status: string
}

function rowToDependency(row: CardDependencyRow): CardDependency {
  return {
    id: row.id,
    project_id: row.project_id,
    card_id: row.card_id,
    depends_on_card_id: row.depends_on_card_id,
    blocking_statuses: JSON.parse(row.blocking_statuses_json) as CardStatus[],
    required_status: row.required_status as CardStatus,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

// ============================================================================
// Create Operations
// ============================================================================

export interface CreateCardDependencyData {
  projectId: string
  cardId: string
  dependsOnCardId: string
  blockingStatuses?: CardStatus[]
  requiredStatus?: CardStatus
}

/**
 * Create a new card dependency.
 */
export function createCardDependency(data: CreateCardDependencyData): CardDependency {
  const db = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  // Default blocking statuses: ready and in_progress
  const blockingStatuses = data.blockingStatuses ?? ['ready', 'in_progress']
  const requiredStatus = data.requiredStatus ?? 'done'

  const stmt = db.prepare(`
    INSERT INTO card_dependencies (
      id, project_id, card_id, depends_on_card_id, blocking_statuses_json, required_status, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    data.projectId,
    data.cardId,
    data.dependsOnCardId,
    JSON.stringify(blockingStatuses),
    requiredStatus,
    1, // is_active = true
    now,
    now
  )

  return {
    id,
    project_id: data.projectId,
    card_id: data.cardId,
    depends_on_card_id: data.dependsOnCardId,
    blocking_statuses: blockingStatuses,
    required_status: requiredStatus,
    is_active: 1,
    created_at: now,
    updated_at: now
  }
}

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Get a card dependency by ID.
 */
export function getCardDependency(dependencyId: string): CardDependency | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM card_dependencies WHERE id = ?')
  const row = stmt.get(dependencyId) as CardDependencyRow | undefined
  return row ? rowToDependency(row) : null
}

/**
 * Get all dependencies for a card (what this card depends on).
 */
export function getDependenciesForCard(cardId: string): CardDependency[] {
  const db = getDb()
  const stmt = db.prepare(
    'SELECT * FROM card_dependencies WHERE card_id = ? ORDER BY created_at ASC'
  )
  const rows = stmt.all(cardId) as CardDependencyRow[]
  return rows.map(rowToDependency)
}

/**
 * Get all dependencies for a card with related card info.
 */
export function getDependenciesForCardWithCards(cardId: string): CardDependencyWithCard[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT
      d.*,
      c.id as dep_card_id, c.project_id as dep_card_project_id, c.title as dep_card_title, c.status as dep_card_status
    FROM card_dependencies d
    LEFT JOIN cards c ON d.depends_on_card_id = c.id
    WHERE d.card_id = ?
    ORDER BY d.created_at ASC
  `)

  const rows = stmt.all(cardId) as (CardDependencyRow & {
    dep_card_id: string | null
    dep_card_project_id: string | null
    dep_card_title: string | null
    dep_card_status: string | null
  })[]

  return rows.map((row) => {
    const dep = rowToDependency(row)
    if (row.dep_card_id) {
      return {
        ...dep,
        depends_on_card: {
          id: row.dep_card_id,
          project_id: row.dep_card_project_id!,
          title: row.dep_card_title!,
          status: row.dep_card_status as CardStatus
        }
      } as CardDependencyWithCard
    }
    return dep as CardDependencyWithCard
  })
}

/**
 * Get all cards that depend on a given card (what depends on this card).
 */
export function getDependentsOfCard(cardId: string): CardDependency[] {
  const db = getDb()
  const stmt = db.prepare(
    'SELECT * FROM card_dependencies WHERE depends_on_card_id = ? ORDER BY created_at ASC'
  )
  const rows = stmt.all(cardId) as CardDependencyRow[]
  return rows.map(rowToDependency)
}

/**
 * Get all dependencies for a project.
 */
export function getDependenciesByProject(projectId: string): CardDependency[] {
  const db = getDb()
  const stmt = db.prepare(
    'SELECT * FROM card_dependencies WHERE project_id = ? ORDER BY created_at ASC'
  )
  const rows = stmt.all(projectId) as CardDependencyRow[]
  return rows.map(rowToDependency)
}

/**
 * Count dependencies for a card.
 */
export function countDependenciesForCard(cardId: string): number {
  const db = getDb()
  const stmt = db.prepare('SELECT COUNT(*) as count FROM card_dependencies WHERE card_id = ?')
  const row = stmt.get(cardId) as { count: number }
  return row.count
}

/**
 * Count cards that depend on a given card.
 */
export function countDependentsOfCard(cardId: string): number {
  const db = getDb()
  const stmt = db.prepare(
    'SELECT COUNT(*) as count FROM card_dependencies WHERE depends_on_card_id = ?'
  )
  const row = stmt.get(cardId) as { count: number }
  return row.count
}

// ============================================================================
// Dependency Checking
// ============================================================================

/**
 * Check if a card can move to a specific status based on its dependencies.
 */
export function checkCanMoveToStatus(
  cardId: string,
  targetStatus: CardStatus
): DependencyCheckResult {
  const db = getDb()

  // Get all active dependencies for this card
  const dependencies = getDependenciesForCard(cardId).filter((d) => d.is_active === 1)

  if (dependencies.length === 0) {
    return { canMove: true, blockedBy: [] }
  }

  const blockedBy: CardDependencyWithCard[] = []

  for (const dep of dependencies) {
    // Check if this dependency blocks the target status
    if (!dep.blocking_statuses.includes(targetStatus)) {
      continue
    }

    // Get the status of the dependency card
    const depCardStmt = db.prepare('SELECT id, project_id, title, status FROM cards WHERE id = ?')
    const depCard = depCardStmt.get(dep.depends_on_card_id) as CardRow | undefined

    if (!depCard) {
      // Dependency card doesn't exist - skip
      continue
    }

    // Check if the dependency card has reached the required status
    const statusOrder: CardStatus[] = [
      'draft',
      'ready',
      'in_progress',
      'in_review',
      'testing',
      'done'
    ]
    const depCardStatusIndex = statusOrder.indexOf(depCard.status as CardStatus)
    const requiredStatusIndex = statusOrder.indexOf(dep.required_status)

    if (depCardStatusIndex < requiredStatusIndex) {
      // Dependency not met - card is blocking
      blockedBy.push({
        ...dep,
        depends_on_card: {
          id: depCard.id,
          project_id: depCard.project_id,
          title: depCard.title,
          status: depCard.status as CardStatus
        }
      } as CardDependencyWithCard)
    }
  }

  if (blockedBy.length > 0) {
    const cardTitles = blockedBy.map((b) => b.depends_on_card?.title ?? 'Unknown').join(', ')
    return {
      canMove: false,
      blockedBy,
      reason: `Blocked by: ${cardTitles}`
    }
  }

  return { canMove: true, blockedBy: [] }
}

/**
 * Check if adding a dependency would create a cycle.
 */
export function wouldCreateCycle(cardId: string, dependsOnCardId: string): boolean {
  if (cardId === dependsOnCardId) {
    return true // Self-dependency is a cycle
  }

  const db = getDb()
  const visited = new Set<string>()
  const stack = [dependsOnCardId]

  while (stack.length > 0) {
    const currentId = stack.pop()!

    if (currentId === cardId) {
      return true // Found a path back to the original card
    }

    if (visited.has(currentId)) {
      continue
    }
    visited.add(currentId)

    // Get all cards that currentId depends on
    const stmt = db.prepare('SELECT depends_on_card_id FROM card_dependencies WHERE card_id = ?')
    const rows = stmt.all(currentId) as { depends_on_card_id: string }[]

    for (const row of rows) {
      stack.push(row.depends_on_card_id)
    }
  }

  return false
}

// ============================================================================
// Update Operations
// ============================================================================

export interface UpdateCardDependencyData {
  blockingStatuses?: CardStatus[]
  requiredStatus?: CardStatus
  isActive?: boolean
}

/**
 * Update a card dependency.
 */
export function updateCardDependency(
  dependencyId: string,
  data: UpdateCardDependencyData
): CardDependency | null {
  const db = getDb()
  const now = new Date().toISOString()

  const updates: string[] = ['updated_at = ?']
  const values: (string | number)[] = [now]

  if (data.blockingStatuses !== undefined) {
    updates.push('blocking_statuses_json = ?')
    values.push(JSON.stringify(data.blockingStatuses))
  }
  if (data.requiredStatus !== undefined) {
    updates.push('required_status = ?')
    values.push(data.requiredStatus)
  }
  if (data.isActive !== undefined) {
    updates.push('is_active = ?')
    values.push(data.isActive ? 1 : 0)
  }

  values.push(dependencyId)
  const stmt = db.prepare(`UPDATE card_dependencies SET ${updates.join(', ')} WHERE id = ?`)
  const result = stmt.run(...values)

  if (result.changes === 0) return null
  return getCardDependency(dependencyId)
}

/**
 * Toggle a dependency's active state.
 */
export function toggleDependency(dependencyId: string, isActive: boolean): boolean {
  const db = getDb()
  const now = new Date().toISOString()

  const stmt = db.prepare(
    'UPDATE card_dependencies SET is_active = ?, updated_at = ? WHERE id = ?'
  )
  const result = stmt.run(isActive ? 1 : 0, now, dependencyId)
  return result.changes > 0
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete a card dependency.
 */
export function deleteCardDependency(dependencyId: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM card_dependencies WHERE id = ?')
  const result = stmt.run(dependencyId)
  return result.changes > 0
}

/**
 * Delete all dependencies for a card (dependencies where this card is the dependent).
 */
export function deleteDependenciesForCard(cardId: string): number {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM card_dependencies WHERE card_id = ?')
  const result = stmt.run(cardId)
  return result.changes
}

/**
 * Delete all dependencies where a card is the dependency (what depends on this card).
 */
export function deleteDependentsOfCard(cardId: string): number {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM card_dependencies WHERE depends_on_card_id = ?')
  const result = stmt.run(cardId)
  return result.changes
}

/**
 * Delete all dependencies for a project.
 */
export function deleteDependenciesByProject(projectId: string): number {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM card_dependencies WHERE project_id = ?')
  const result = stmt.run(projectId)
  return result.changes
}

/**
 * Delete a specific dependency between two cards.
 */
export function deleteDependencyBetweenCards(cardId: string, dependsOnCardId: string): boolean {
  const db = getDb()
  const stmt = db.prepare(
    'DELETE FROM card_dependencies WHERE card_id = ? AND depends_on_card_id = ?'
  )
  const result = stmt.run(cardId, dependsOnCardId)
  return result.changes > 0
}
