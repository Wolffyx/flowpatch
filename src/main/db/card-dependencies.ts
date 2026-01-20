/**
 * Card Dependencies Database Operations
 *
 * CRUD operations for card dependency blocking.
 * Supports both central database (legacy) and project-local database.
 */

import { asc, count, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { cardDependencies, cards } from './schema'
import {
  cardDependencies as projectCardDependencies,
  cards as projectCards
} from './schema/project'
import { generateId } from '@shared/utils'
import type {
  CardDependency,
  CardDependencyWithCard,
  CardStatus,
  DependencyCheckResult
} from '@shared/types'
import { resolveProjectDb } from './db-resolver'

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
  const { db, isLocalDb } = resolveProjectDb(data.projectId)
  const id = generateId()
  const now = new Date().toISOString()

  // Default blocking statuses: ready and in_progress
  const blockingStatuses = data.blockingStatuses ?? ['ready', 'in_progress']
  const requiredStatus = data.requiredStatus ?? 'done'

  if (isLocalDb) {
    // Project DB - no project_id column
    db.insert(projectCardDependencies)
      .values({
        id,
        card_id: data.cardId,
        depends_on_card_id: data.dependsOnCardId,
        blocking_statuses_json: JSON.stringify(blockingStatuses),
        required_status: requiredStatus,
        is_active: 1,
        created_at: now,
        updated_at: now
      })
      .run()
  } else {
    // Central DB - includes project_id
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
  }

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

function rowToDependency(
  row: {
    id: string
    project_id?: string
    card_id: string
    depends_on_card_id: string
    blocking_statuses_json: string
    required_status: string
    is_active: number
    created_at: string
    updated_at: string
  },
  projectId?: string
): CardDependency {
  return {
    id: row.id,
    project_id: row.project_id ?? projectId ?? '',
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
 * @param dependencyId - The dependency ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getCardDependency(dependencyId: string, projectId?: string): CardDependency | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectCardDependencies)
        .where(eq(projectCardDependencies.id, dependencyId))
        .get()
      return row ? rowToDependency(row, projectId) : null
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const row = db.select().from(cardDependencies).where(eq(cardDependencies.id, dependencyId)).get()
  return row ? rowToDependency(row) : null
}

/**
 * Get all dependencies for a card (what this card depends on).
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getDependenciesForCard(cardId: string, projectId?: string): CardDependency[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectCardDependencies)
        .where(eq(projectCardDependencies.card_id, cardId))
        .orderBy(asc(projectCardDependencies.created_at))
        .all()
      return rows.map((r) => rowToDependency(r, projectId))
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const rows = db
    .select()
    .from(cardDependencies)
    .where(eq(cardDependencies.card_id, cardId))
    .orderBy(asc(cardDependencies.created_at))
    .all()
  return rows.map((r) => rowToDependency(r))
}

/**
 * Get all dependencies for a card with related card info.
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getDependenciesForCardWithCards(
  cardId: string,
  projectId?: string
): CardDependencyWithCard[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select({
          id: projectCardDependencies.id,
          card_id: projectCardDependencies.card_id,
          depends_on_card_id: projectCardDependencies.depends_on_card_id,
          blocking_statuses_json: projectCardDependencies.blocking_statuses_json,
          required_status: projectCardDependencies.required_status,
          is_active: projectCardDependencies.is_active,
          created_at: projectCardDependencies.created_at,
          updated_at: projectCardDependencies.updated_at,
          dep_card_id: projectCards.id,
          dep_card_title: projectCards.title,
          dep_card_status: projectCards.status
        })
        .from(projectCardDependencies)
        .leftJoin(projectCards, eq(projectCardDependencies.depends_on_card_id, projectCards.id))
        .where(eq(projectCardDependencies.card_id, cardId))
        .orderBy(asc(projectCardDependencies.created_at))
        .all()

      return rows.map((row) => {
        const dep = rowToDependency(row, projectId)
        if (row.dep_card_id) {
          return {
            ...dep,
            depends_on_card: {
              id: row.dep_card_id,
              project_id: projectId,
              title: row.dep_card_title!,
              status: row.dep_card_status as CardStatus
            }
          } as CardDependencyWithCard
        }
        return dep as CardDependencyWithCard
      })
    }
  }

  // Central DB fallback
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
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getDependentsOfCard(cardId: string, projectId?: string): CardDependency[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectCardDependencies)
        .where(eq(projectCardDependencies.depends_on_card_id, cardId))
        .orderBy(asc(projectCardDependencies.created_at))
        .all()
      return rows.map((r) => rowToDependency(r, projectId))
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const rows = db
    .select()
    .from(cardDependencies)
    .where(eq(cardDependencies.depends_on_card_id, cardId))
    .orderBy(asc(cardDependencies.created_at))
    .all()
  return rows.map((r) => rowToDependency(r))
}

/**
 * Get all cards that depend on a given card with related card info.
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getDependentsOfCardWithCards(
  cardId: string,
  projectId?: string
): CardDependencyWithCard[] {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select({
          id: projectCardDependencies.id,
          card_id: projectCardDependencies.card_id,
          depends_on_card_id: projectCardDependencies.depends_on_card_id,
          blocking_statuses_json: projectCardDependencies.blocking_statuses_json,
          required_status: projectCardDependencies.required_status,
          is_active: projectCardDependencies.is_active,
          created_at: projectCardDependencies.created_at,
          updated_at: projectCardDependencies.updated_at,
          dep_card_id: projectCards.id,
          dep_card_title: projectCards.title,
          dep_card_status: projectCards.status
        })
        .from(projectCardDependencies)
        .leftJoin(projectCards, eq(projectCardDependencies.card_id, projectCards.id))
        .where(eq(projectCardDependencies.depends_on_card_id, cardId))
        .orderBy(asc(projectCardDependencies.created_at))
        .all()

      return rows.map((row) => {
        const dep = rowToDependency(row, projectId)
        if (row.dep_card_id) {
          return {
            ...dep,
            card: {
              id: row.dep_card_id,
              project_id: projectId,
              title: row.dep_card_title!,
              status: row.dep_card_status as CardStatus
            }
          } as CardDependencyWithCard
        }
        return dep as CardDependencyWithCard
      })
    }
  }

  // Central DB fallback
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
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - return all dependencies (implicit project scope)
    const rows = db
      .select()
      .from(projectCardDependencies)
      .orderBy(asc(projectCardDependencies.created_at))
      .all()
    return rows.map((r) => rowToDependency(r, projectId))
  }

  // Central DB - filter by project_id
  const rows = db
    .select()
    .from(cardDependencies)
    .where(eq(cardDependencies.project_id, projectId))
    .orderBy(asc(cardDependencies.created_at))
    .all()
  return rows.map((r) => rowToDependency(r))
}

/**
 * Count dependencies for a card.
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function countDependenciesForCard(cardId: string, projectId?: string): number {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .select({ count: count() })
        .from(projectCardDependencies)
        .where(eq(projectCardDependencies.card_id, cardId))
        .get()
      return result?.count ?? 0
    }
  }

  // Central DB fallback
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
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function countDependentsOfCard(cardId: string, projectId?: string): number {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .select({ count: count() })
        .from(projectCardDependencies)
        .where(eq(projectCardDependencies.depends_on_card_id, cardId))
        .get()
      return result?.count ?? 0
    }
  }

  // Central DB fallback
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
 * @param cardId - The card ID
 * @param targetStatus - The target status
 * @param projectId - Optional project ID for direct DB resolution
 */
export function checkCanMoveToStatus(
  cardId: string,
  targetStatus: CardStatus,
  projectId?: string
): DependencyCheckResult {
  // Get all active dependencies for this card
  const dependencies = getDependenciesForCard(cardId, projectId).filter((d) => d.is_active === 1)

  if (dependencies.length === 0) {
    return { canMove: true, blockedBy: [] }
  }

  const blockedBy: CardDependencyWithCard[] = []

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      for (const dep of dependencies) {
        if (!dep.blocking_statuses.includes(targetStatus)) {
          continue
        }

        const depCard = db
          .select({
            id: projectCards.id,
            title: projectCards.title,
            status: projectCards.status
          })
          .from(projectCards)
          .where(eq(projectCards.id, dep.depends_on_card_id))
          .get()

        if (!depCard) continue

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
          blockedBy.push({
            ...dep,
            depends_on_card: {
              id: depCard.id,
              project_id: projectId,
              title: depCard.title,
              status: depCard.status as CardStatus
            }
          } as CardDependencyWithCard)
        }
      }

      if (blockedBy.length > 0) {
        const cardTitles = blockedBy.map((b) => b.depends_on_card?.title ?? 'Unknown').join(', ')
        return { canMove: false, blockedBy, reason: `Blocked by: ${cardTitles}` }
      }

      return { canMove: true, blockedBy: [] }
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  for (const dep of dependencies) {
    if (!dep.blocking_statuses.includes(targetStatus)) {
      continue
    }

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

    if (!depCard) continue

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
    return { canMove: false, blockedBy, reason: `Blocked by: ${cardTitles}` }
  }

  return { canMove: true, blockedBy: [] }
}

/**
 * Check if adding a dependency would create a cycle.
 * @param cardId - The card ID
 * @param dependsOnCardId - The dependency card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function wouldCreateCycle(
  cardId: string,
  dependsOnCardId: string,
  projectId?: string
): boolean {
  if (cardId === dependsOnCardId) {
    return true // Self-dependency is a cycle
  }

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
    if (projectId) {
      const { db, isLocalDb } = resolveProjectDb(projectId)
      if (isLocalDb) {
        const rows = db
          .select({ depends_on_card_id: projectCardDependencies.depends_on_card_id })
          .from(projectCardDependencies)
          .where(eq(projectCardDependencies.card_id, currentId))
          .all()

        for (const row of rows) {
          stack.push(row.depends_on_card_id)
        }
        continue
      }
    }

    // Central DB fallback
    const db = getDrizzle()
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
 * @param dependencyId - The dependency ID
 * @param data - The update data
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateCardDependency(
  dependencyId: string,
  data: UpdateCardDependencyData,
  projectId?: string
): CardDependency | null {
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

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .update(projectCardDependencies)
        .set(updateData)
        .where(eq(projectCardDependencies.id, dependencyId))
        .run()

      if (result.changes === 0) return null
      return getCardDependency(dependencyId, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * @param dependencyId - The dependency ID
 * @param isActive - Whether the dependency is active
 * @param projectId - Optional project ID for direct DB resolution
 */
export function toggleDependency(
  dependencyId: string,
  isActive: boolean,
  projectId?: string
): boolean {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .update(projectCardDependencies)
        .set({ is_active: isActive ? 1 : 0, updated_at: now })
        .where(eq(projectCardDependencies.id, dependencyId))
        .run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * @param dependencyId - The dependency ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteCardDependency(dependencyId: string, projectId?: string): boolean {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .delete(projectCardDependencies)
        .where(eq(projectCardDependencies.id, dependencyId))
        .run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db.delete(cardDependencies).where(eq(cardDependencies.id, dependencyId)).run()
  return result.changes > 0
}

/**
 * Delete all dependencies for a card (dependencies where this card is the dependent).
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteDependenciesForCard(cardId: string, projectId?: string): number {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .delete(projectCardDependencies)
        .where(eq(projectCardDependencies.card_id, cardId))
        .run()
      return result.changes
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db.delete(cardDependencies).where(eq(cardDependencies.card_id, cardId)).run()
  return result.changes
}

/**
 * Delete all dependencies where a card is the dependency (what depends on this card).
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteDependentsOfCard(cardId: string, projectId?: string): number {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db
        .delete(projectCardDependencies)
        .where(eq(projectCardDependencies.depends_on_card_id, cardId))
        .run()
      return result.changes
    }
  }

  // Central DB fallback
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
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    // Project DB - delete all (implicit project scope)
    const rows = db.select().from(projectCardDependencies).all()
    if (rows.length === 0) return 0

    for (const row of rows) {
      db.delete(projectCardDependencies).where(eq(projectCardDependencies.id, row.id)).run()
    }
    return rows.length
  }

  // Central DB - filter by project_id
  const result = db.delete(cardDependencies).where(eq(cardDependencies.project_id, projectId)).run()
  return result.changes
}

/**
 * Delete a specific dependency between two cards.
 * @param cardId - The card ID
 * @param dependsOnCardId - The dependency card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteDependencyBetweenCards(
  cardId: string,
  dependsOnCardId: string,
  projectId?: string
): boolean {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const rows = db
        .select()
        .from(projectCardDependencies)
        .where(eq(projectCardDependencies.card_id, cardId))
        .all()

      const toDelete = rows.find((r) => r.depends_on_card_id === dependsOnCardId)
      if (!toDelete) return false

      const result = db
        .delete(projectCardDependencies)
        .where(eq(projectCardDependencies.id, toDelete.id))
        .run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const rows = db.select().from(cardDependencies).where(eq(cardDependencies.card_id, cardId)).all()

  const toDelete = rows.find((r) => r.depends_on_card_id === dependsOnCardId)
  if (!toDelete) return false

  const result = db.delete(cardDependencies).where(eq(cardDependencies.id, toDelete.id)).run()
  return result.changes > 0
}
