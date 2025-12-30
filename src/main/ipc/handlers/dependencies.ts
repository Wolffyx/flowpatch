/**
 * IPC handlers for card dependency operations.
 * Handles: create, read, update, delete, check dependencies
 */

import { ipcMain } from 'electron'
import {
  createCardDependency,
  getCardDependency,
  getDependenciesForCard,
  getDependenciesForCardWithCards,
  getDependentsOfCard,
  getDependenciesByProject,
  countDependenciesForCard,
  countDependentsOfCard,
  checkCanMoveToStatus,
  wouldCreateCycle,
  updateCardDependency,
  toggleDependency,
  deleteCardDependency,
  deleteDependencyBetweenCards,
  type CreateCardDependencyData,
  type UpdateCardDependencyData
} from '../../db'
import { logAction } from '@shared/utils'
import type {
  CardDependency,
  CardDependencyWithCard,
  CardStatus,
  DependencyCheckResult
} from '@shared/types'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerDependencyHandlers(notifyRenderer: () => void): void {
  // Create a new card dependency
  ipcMain.handle(
    'dependencies:create',
    async (
      _e,
      params: CreateCardDependencyData
    ): Promise<{ dependency: CardDependency | null; error?: string }> => {
      logAction('dependencies:create', {
        cardId: params.cardId,
        dependsOnCardId: params.dependsOnCardId
      })

      try {
        // Check for self-dependency
        if (params.cardId === params.dependsOnCardId) {
          return { dependency: null, error: 'A card cannot depend on itself' }
        }

        // Check for cycles
        if (wouldCreateCycle(params.cardId, params.dependsOnCardId)) {
          return {
            dependency: null,
            error: 'This dependency would create a circular reference'
          }
        }

        const dependency = createCardDependency(params)
        notifyRenderer()
        return { dependency }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        // Handle unique constraint violation
        if (errorMsg.includes('UNIQUE constraint')) {
          return { dependency: null, error: 'This dependency already exists' }
        }
        return { dependency: null, error: errorMsg }
      }
    }
  )

  // Get a single dependency by ID
  ipcMain.handle(
    'dependencies:get',
    async (
      _e,
      dependencyId: string
    ): Promise<{ dependency: CardDependency | null; error?: string }> => {
      logAction('dependencies:get', { dependencyId })

      try {
        const dependency = getCardDependency(dependencyId)
        return { dependency }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { dependency: null, error: errorMsg }
      }
    }
  )

  // Get all dependencies for a card (what this card depends on)
  ipcMain.handle(
    'dependencies:getForCard',
    async (
      _e,
      cardId: string
    ): Promise<{ dependencies: CardDependency[]; error?: string }> => {
      logAction('dependencies:getForCard', { cardId })

      try {
        const dependencies = getDependenciesForCard(cardId)
        return { dependencies }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { dependencies: [], error: errorMsg }
      }
    }
  )

  // Get all dependencies for a card with related card info
  ipcMain.handle(
    'dependencies:getForCardWithCards',
    async (
      _e,
      cardId: string
    ): Promise<{ dependencies: CardDependencyWithCard[]; error?: string }> => {
      logAction('dependencies:getForCardWithCards', { cardId })

      try {
        const dependencies = getDependenciesForCardWithCards(cardId)
        return { dependencies }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { dependencies: [], error: errorMsg }
      }
    }
  )

  // Get all cards that depend on a given card
  ipcMain.handle(
    'dependencies:getDependents',
    async (
      _e,
      cardId: string
    ): Promise<{ dependencies: CardDependency[]; error?: string }> => {
      logAction('dependencies:getDependents', { cardId })

      try {
        const dependencies = getDependentsOfCard(cardId)
        return { dependencies }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { dependencies: [], error: errorMsg }
      }
    }
  )

  // Get all dependencies for a project
  ipcMain.handle(
    'dependencies:getByProject',
    async (
      _e,
      projectId: string
    ): Promise<{ dependencies: CardDependency[]; error?: string }> => {
      logAction('dependencies:getByProject', { projectId })

      try {
        const dependencies = getDependenciesByProject(projectId)
        return { dependencies }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { dependencies: [], error: errorMsg }
      }
    }
  )

  // Count dependencies for a card
  ipcMain.handle(
    'dependencies:countForCard',
    async (
      _e,
      cardId: string
    ): Promise<{ count: number; dependentsCount: number; error?: string }> => {
      logAction('dependencies:countForCard', { cardId })

      try {
        const count = countDependenciesForCard(cardId)
        const dependentsCount = countDependentsOfCard(cardId)
        return { count, dependentsCount }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { count: 0, dependentsCount: 0, error: errorMsg }
      }
    }
  )

  // Check if a card can move to a specific status
  ipcMain.handle(
    'dependencies:checkCanMove',
    async (
      _e,
      params: { cardId: string; targetStatus: CardStatus }
    ): Promise<DependencyCheckResult> => {
      logAction('dependencies:checkCanMove', {
        cardId: params.cardId,
        targetStatus: params.targetStatus
      })

      try {
        return checkCanMoveToStatus(params.cardId, params.targetStatus)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { canMove: true, blockedBy: [], reason: errorMsg }
      }
    }
  )

  // Check if adding a dependency would create a cycle
  ipcMain.handle(
    'dependencies:checkCycle',
    async (
      _e,
      params: { cardId: string; dependsOnCardId: string }
    ): Promise<{ wouldCreateCycle: boolean; error?: string }> => {
      logAction('dependencies:checkCycle', {
        cardId: params.cardId,
        dependsOnCardId: params.dependsOnCardId
      })

      try {
        const result = wouldCreateCycle(params.cardId, params.dependsOnCardId)
        return { wouldCreateCycle: result }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { wouldCreateCycle: false, error: errorMsg }
      }
    }
  )

  // Update a dependency
  ipcMain.handle(
    'dependencies:update',
    async (
      _e,
      params: { dependencyId: string; data: UpdateCardDependencyData }
    ): Promise<{ dependency: CardDependency | null; error?: string }> => {
      logAction('dependencies:update', { dependencyId: params.dependencyId })

      try {
        const dependency = updateCardDependency(params.dependencyId, params.data)
        if (dependency) {
          notifyRenderer()
        }
        return { dependency }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { dependency: null, error: errorMsg }
      }
    }
  )

  // Toggle dependency active state
  ipcMain.handle(
    'dependencies:toggle',
    async (
      _e,
      params: { dependencyId: string; isActive: boolean }
    ): Promise<{ success: boolean; error?: string }> => {
      logAction('dependencies:toggle', {
        dependencyId: params.dependencyId,
        isActive: params.isActive
      })

      try {
        const success = toggleDependency(params.dependencyId, params.isActive)
        if (success) {
          notifyRenderer()
        }
        return { success }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { success: false, error: errorMsg }
      }
    }
  )

  // Delete a dependency by ID
  ipcMain.handle(
    'dependencies:delete',
    async (_e, dependencyId: string): Promise<{ success: boolean; error?: string }> => {
      logAction('dependencies:delete', { dependencyId })

      try {
        const success = deleteCardDependency(dependencyId)
        if (success) {
          notifyRenderer()
        }
        return { success }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { success: false, error: errorMsg }
      }
    }
  )

  // Delete a dependency between two specific cards
  ipcMain.handle(
    'dependencies:deleteBetween',
    async (
      _e,
      params: { cardId: string; dependsOnCardId: string }
    ): Promise<{ success: boolean; error?: string }> => {
      logAction('dependencies:deleteBetween', {
        cardId: params.cardId,
        dependsOnCardId: params.dependsOnCardId
      })

      try {
        const success = deleteDependencyBetweenCards(params.cardId, params.dependsOnCardId)
        if (success) {
          notifyRenderer()
        }
        return { success }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { success: false, error: errorMsg }
      }
    }
  )
}
