/**
 * Card Dependencies Database Operations
 *
 * CRUD operations for card dependency blocking.
 */

import { asc, count, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { cardDependencies, cards } from './schema'
import { generateId } from '@shared/utils'
import type {
  CardDependency,
  CardDependencyWithCard,
  CardStatus,
  DependencyCheckResult
} from '@shared/types'

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
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

  // Default blocking statuses: ready and in_progress
  const blockingStatuses = data.blockingStatuses ?? ['ready', 'in_progress']
  const requiredStatus = data.requiredStatus ?? 'done'

  db.insert(cardDependencies)
    .values({
      id,
      project_id: data.projectId,
      card_id: data.cardId,
      depends_on_card_id: data.dependsOnCardId,
      blocking_statuses_json: JSON.stringify(blockingStatuses),
      required_status: requiredStatus,
      is_active: 1,
      created_at: now,
      updated_at: now
    })
    .run()

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

function rowToDependency(row: {
  id: string
  project_id: string
  card_id: string
  depends_on_card_id: string
  blocking_statuses_json: string
  required_status: string
  is_active: number
  created_at: string
  updated_at: string
}): CardDependency {
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

/**
 * Get a card dependency by ID.
 */
export function getCardDependency(dependencyId: string): CardDependency | null {
  const db = getDrizzle()
  const row = db.select().from(cardDependencies).where(eq(cardDependencies.id, dependencyId)).get()
  return row ? rowToDependency(row) : null
}

/**
 * Get all dependencies for a card (what this card depends on).
 */
export function getDependenciesForCard(cardId: string): CardDependency[] {
  const db = getDrizzle()
  const rows = db
    .select()
    .from(cardDependencies)
    .where(eq(cardDependencies.card_id, cardId))
    .orderBy(asc(cardDependencies.created_at))
    .all()
  return rows.map(rowToDependency)
}

/**
 * Get all dependencies for a card with related card info.
 */
export function getDependenciesForCardWithCards(cardId: string): CardDependencyWithCard[] {
  const db = getDrizzle()
  const rows = db
    .select({
      id: cardDependencies.id,
      project_id: cardDependencies.project_id,
      card_id: cardDependencies.card_id,
      depends_on_card_id: cardDependencies.depends_on_card_id,
      blocking_statuses_json: cardDependencies.blocking_statuses_json,
      required_status: cardDependencies.required_status,
      is_active: cardDependencies.is_active,
      created_at: cardDependencies.created_at,
      updated_at: cardDependencies.updated_at,
      dep_card_id: cards.id,
      dep_card_project_id: cards.project_id,
      dep_card_title: cards.title,
      dep_card_status: cards.status
    })
    .from(cardDependencies)
    .leftJoin(cards, eq(cardDependencies.depends_on_card_id, cards.id))
    .where(eq(cardDependencies.card_id, cardId))
    .orderBy(asc(cardDependencies.created_at))
    .all()

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
  const db = getDrizzle()
  const rows = db
    .select()
    .from(cardDependencies)
    .where(eq(cardDependencies.depends_on_card_id, cardId))
    .orderBy(asc(cardDependencies.created_at))
    .all()
  return rows.map(rowToDependency)
}

/**
 * Get all cards that depend on a given card with related card info.
 */
export function getDependentsOfCardWithCards(cardId: string): CardDependencyWithCard[] {
  const db = getDrizzle()
  const rows = db
    .select({
      id: cardDependencies.id,
      project_id: cardDependencies.project_id,
      card_id: cardDependencies.card_id,
      depends_on_card_id: cardDependencies.depends_on_card_id,
      blocking_statuses_json: cardDependencies.blocking_statuses_json,
      required_status: cardDependencies.required_status,
      is_active: cardDependencies.is_active,
      created_at: cardDependencies.created_at,
      updated_at: cardDependencies.updated_at,
      dep_card_id: cards.id,
      dep_card_project_id: cards.project_id,
      dep_card_title: cards.title,
      dep_card_status: cards.status
    })
    .from(cardDependencies)
    .leftJoin(cards, eq(cardDependencies.card_id, cards.id))
    .where(eq(cardDependencies.depends_on_card_id, cardId))
    .orderBy(asc(cardDependencies.created_at))
    .all()

  return rows.map((row) => {
    const dep = rowToDependency(row)
    if (row.dep_card_id) {
      return {
        ...dep,
        card: {
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
 * Get all dependencies for a project.
 */
export function getDependenciesByProject(projectId: string): CardDependency[] {
  const db = getDrizzle()
  const rows = db
    .select()
    .from(cardDependencies)
    .where(eq(cardDependencies.project_id, projectId))
    .orderBy(asc(cardDependencies.created_at))
    .all()
  return rows.map(rowToDependency)
}

/**
 * Count dependencies for a card.
 */
export function countDependenciesForCard(cardId: string): number {
  const db = getDrizzle()
  const result = db
    .select({ count: count() })
    .from(cardDependencies)
    .where(eq(cardDependencies.card_id, cardId))
    .get()
  return result?.count ?? 0
}

/**
 * Count cards that depend on a given card.
 */
export function countDependentsOfCard(cardId: string): number {
  const db = getDrizzle()
  const result = db
    .select({ count: count() })
    .from(cardDependencies)
    .where(eq(cardDependencies.depends_on_card_id, cardId))
    .get()
  return result?.count ?? 0
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
  const db = getDrizzle()

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
    const depCard = db
      .select({
        id: cards.id,
        project_id: cards.project_id,
        title: cards.title,
        status: cards.status
      })
      .from(cards)
      .where(eq(cards.id, dep.depends_on_card_id))
      .get()

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

  const db = getDrizzle()
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
    const rows = db
      .select({ depends_on_card_id: cardDependencies.depends_on_card_id })
      .from(cardDependencies)
      .where(eq(cardDependencies.card_id, currentId))
      .all()

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
  const db = getDrizzle()
  const now = new Date().toISOString()

  const updateData: Record<string, unknown> = { updated_at: now }

  if (data.blockingStatuses !== undefined) {
    updateData.blocking_statuses_json = JSON.stringify(data.blockingStatuses)
  }
  if (data.requiredStatus !== undefined) {
    updateData.required_status = data.requiredStatus
  }
  if (data.isActive !== undefined) {
    updateData.is_active = data.isActive ? 1 : 0
  }

  const result = db
    .update(cardDependencies)
    .set(updateData)
    .where(eq(cardDependencies.id, dependencyId))
    .run()

  if (result.changes === 0) return null
  return getCardDependency(dependencyId)
}

/**
 * Toggle a dependency's active state.
 */
export function toggleDependency(dependencyId: string, isActive: boolean): boolean {
  const db = getDrizzle()
  const now = new Date().toISOString()

  const result = db
    .update(cardDependencies)
    .set({ is_active: isActive ? 1 : 0, updated_at: now })
    .where(eq(cardDependencies.id, dependencyId))
    .run()
  return result.changes > 0
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete a card dependency.
 */
export function deleteCardDependency(dependencyId: string): boolean {
  const db = getDrizzle()
  const result = db.delete(cardDependencies).where(eq(cardDependencies.id, dependencyId)).run()
  return result.changes > 0
}

/**
 * Delete all dependencies for a card (dependencies where this card is the dependent).
 */
export function deleteDependenciesForCard(cardId: string): number {
  const db = getDrizzle()
  const result = db.delete(cardDependencies).where(eq(cardDependencies.card_id, cardId)).run()
  return result.changes
}

/**
 * Delete all dependencies where a card is the dependency (what depends on this card).
 */
export function deleteDependentsOfCard(cardId: string): number {
  const db = getDrizzle()
  const result = db
    .delete(cardDependencies)
    .where(eq(cardDependencies.depends_on_card_id, cardId))
    .run()
  return result.changes
}

/**
 * Delete all dependencies for a project.
 */
export function deleteDependenciesByProject(projectId: string): number {
  const db = getDrizzle()
  const result = db
    .delete(cardDependencies)
    .where(eq(cardDependencies.project_id, projectId))
    .run()
  return result.changes
}

/**
 * Delete a specific dependency between two cards.
 */
export function deleteDependencyBetweenCards(cardId: string, dependsOnCardId: string): boolean {
  const db = getDrizzle()
  // Get the dependency first
  const rows = db
    .select()
    .from(cardDependencies)
    .where(eq(cardDependencies.card_id, cardId))
    .all()

  const toDelete = rows.find((r) => r.depends_on_card_id === dependsOnCardId)
  if (!toDelete) return false

  const result = db.delete(cardDependencies).where(eq(cardDependencies.id, toDelete.id)).run()
  return result.changes > 0
}
