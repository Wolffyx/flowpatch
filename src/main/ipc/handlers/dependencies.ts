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
  getDependentsOfCardWithCards,
  getDependenciesByProject,
  countDependenciesForCard,
  countDependentsOfCard,
  checkCanMoveToStatus,
  wouldCreateCycle,
  updateCardDependency,
  toggleDependency,
  deleteCardDependency,
  deleteDependencyBetweenCards,
  getCard,
  listProjects,
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
        // Try to get dependency from central DB first to find card_id
        let dependency = getCardDependency(dependencyId)
        if (!dependency) {
          // If not in central DB, it might be in project DB - search all projects
          const projects = listProjects()
          for (const project of projects) {
            dependency = getCardDependency(dependencyId, project.id)
            if (dependency) break
          }
        }
        
        // If we found a dependency, try to get it with projectId for correct DB resolution
        if (dependency) {
          const card = getCard(dependency.card_id)
          const projectId = card?.project_id
          if (projectId) {
            dependency = getCardDependency(dependencyId, projectId)
          }
        }
        
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
    ): Promise<{ dependencies: CardDependencyWithCard[]; error?: string }> => {
      logAction('dependencies:getForCard', { cardId })

      try {
        // Get the card first to determine projectId for correct DB resolution
        const card = getCard(cardId)
        const projectId = card?.project_id
        const dependencies = getDependenciesForCard(cardId, projectId)
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
        // Get the card first to determine projectId for correct DB resolution
        const card = getCard(cardId)
        const projectId = card?.project_id
        
        // Check which database will be used
        let dbType = 'unknown'
        let isLocalDb = false
        if (projectId) {
          try {
            const { resolveProjectDb } = require('../../db/db-resolver')
            const resolved = resolveProjectDb(projectId)
            isLocalDb = resolved.isLocalDb
            dbType = isLocalDb ? 'project-local' : 'central'
          } catch {
            dbType = 'central'
          }
        } else {
          dbType = 'central'
        }
        
        logAction('dependencies:getForCardWithCards:resolved', {
          cardId,
          projectId,
          cardFound: !!card,
          cardTitle: card?.title,
          dbType,
          isLocalDb
        })
        
        const dependencies = getDependenciesForCardWithCards(cardId, projectId)
        
        // Log detailed dependency information
        const dependencyDetails = dependencies.map((dep) => ({
          dependencyId: dep.id,
          dependsOnCardId: dep.depends_on_card_id,
          dependsOnCardTitle: dep.depends_on_card?.title || 'MISSING',
          dependsOnCardStatus: dep.depends_on_card?.status || 'MISSING',
          hasCardInfo: !!dep.depends_on_card
        }))
        
        logAction('dependencies:getForCardWithCards:result', {
          cardId,
          projectId,
          dbType,
          isLocalDb,
          dependencyCount: dependencies.length,
          dependencies: dependencyDetails,
          summary: dependencies.length > 0 
            ? `${dependencies.length} dependency(ies) found in ${dbType} DB`
            : `No dependencies found in ${dbType} DB`
        })
        
        return { dependencies }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logAction('dependencies:getForCardWithCards:error', {
          cardId,
          error: errorMsg,
          stack: err instanceof Error ? err.stack : undefined
        })
        return { dependencies: [], error: errorMsg }
      }
    }
  )

  // Get all cards that depend on a given card (with card info)
  ipcMain.handle(
    'dependencies:getDependentsOfCardWithCards',
    async (_e, cardId: string): Promise<{ dependencies: CardDependencyWithCard[]; error?: string }> => {
      logAction('dependencies:getDependentsOfCardWithCards', { cardId })

      try {
        // Get the card first to determine projectId for correct DB resolution
        const card = getCard(cardId)
        const projectId = card?.project_id
        
        // Check which database will be used
        let dbType = 'unknown'
        let isLocalDb = false
        if (projectId) {
          try {
            const { resolveProjectDb } = require('../../db/db-resolver')
            const resolved = resolveProjectDb(projectId)
            isLocalDb = resolved.isLocalDb
            dbType = isLocalDb ? 'project-local' : 'central'
          } catch {
            dbType = 'central'
          }
        } else {
          dbType = 'central'
        }
        
        logAction('dependencies:getDependentsOfCardWithCards:resolved', {
          cardId,
          projectId,
          cardFound: !!card,
          cardTitle: card?.title,
          dbType,
          isLocalDb
        })
        
        const dependencies = getDependentsOfCardWithCards(cardId, projectId)
        
        // Log detailed dependent information
        const dependentDetails = dependencies.map((dep) => ({
          dependencyId: dep.id,
          dependentCardId: dep.card_id,
          dependentCardTitle: dep.card?.title || 'MISSING',
          dependentCardStatus: dep.card?.status || 'MISSING',
          hasCardInfo: !!dep.card
        }))
        
        logAction('dependencies:getDependentsOfCardWithCards:result', {
          cardId,
          projectId,
          dbType,
          isLocalDb,
          dependentCount: dependencies.length,
          dependents: dependentDetails,
          summary: dependencies.length > 0 
            ? `${dependencies.length} dependent(s) found in ${dbType} DB`
            : `No dependents found in ${dbType} DB`
        })
        
        return { dependencies }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logAction('dependencies:getDependentsOfCardWithCards:error', {
          cardId,
          error: errorMsg,
          stack: err instanceof Error ? err.stack : undefined
        })
        return { dependencies: [], error: errorMsg }
      }
    }
  )

  // Get all cards that depend on a given card (without card info, for backward compatibility)
  ipcMain.handle(
    'dependencies:getDependents',
    async (_e, cardId: string): Promise<{ dependencies: CardDependency[]; error?: string }> => {
      logAction('dependencies:getDependents', { cardId })

      try {
        // Get the card first to determine projectId for correct DB resolution
        const card = getCard(cardId)
        const projectId = card?.project_id
        
        // Check which database will be used
        let dbType = 'unknown'
        let isLocalDb = false
        if (projectId) {
          try {
            const { resolveProjectDb } = require('../../db/db-resolver')
            const resolved = resolveProjectDb(projectId)
            isLocalDb = resolved.isLocalDb
            dbType = isLocalDb ? 'project-local' : 'central'
          } catch {
            dbType = 'central'
          }
        } else {
          dbType = 'central'
        }
        
        const dependencies = getDependentsOfCardWithCards(cardId, projectId)
        
        // Log detailed dependent information
        const dependentDetails = dependencies.map((dep) => ({
          dependencyId: dep.id,
          dependentCardId: dep.card_id,
          dependentCardTitle: (dep as CardDependencyWithCard).card?.title || 'MISSING',
          dependentCardStatus: (dep as CardDependencyWithCard).card?.status || 'MISSING',
          hasCardInfo: !!(dep as CardDependencyWithCard).card
        }))
        
        logAction('dependencies:getDependents:result', {
          cardId,
          projectId,
          dbType,
          isLocalDb,
          dependentCount: dependencies.length,
          dependents: dependentDetails,
          summary: dependencies.length > 0 
            ? `${dependencies.length} dependent(s) found in ${dbType} DB`
            : `No dependents found in ${dbType} DB`
        })
        
        return { dependencies }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logAction('dependencies:getDependents:error', {
          cardId,
          error: errorMsg,
          stack: err instanceof Error ? err.stack : undefined
        })
        return { dependencies: [], error: errorMsg }
      }
    }
  )

  // Get all dependencies for a project
  ipcMain.handle(
    'dependencies:getByProject',
    async (_e, projectId: string): Promise<{ dependencies: CardDependency[]; error?: string }> => {
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
        // Get the card first to determine projectId for correct DB resolution
        const card = getCard(cardId)
        const projectId = card?.project_id
        const count = countDependenciesForCard(cardId, projectId)
        const dependentsCount = countDependentsOfCard(cardId, projectId)
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
        // Get the card first to determine projectId for correct DB resolution
        const card = getCard(params.cardId)
        const projectId = card?.project_id
        return checkCanMoveToStatus(params.cardId, params.targetStatus, projectId)
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
        // Get the card first to determine projectId for correct DB resolution
        const card = getCard(params.cardId)
        const projectId = card?.project_id
        const result = wouldCreateCycle(params.cardId, params.dependsOnCardId, projectId)
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
        // Get the dependency first to find the card and determine projectId
        let dependency = getCardDependency(params.dependencyId)
        if (!dependency) {
          // If not in central DB, search project DBs
          const projects = listProjects()
          for (const project of projects) {
            dependency = getCardDependency(params.dependencyId, project.id)
            if (dependency) break
          }
        }
        
        // Get projectId from the card
        const projectId = dependency ? getCard(dependency.card_id)?.project_id : undefined
        const updatedDependency = updateCardDependency(params.dependencyId, params.data, projectId)
        if (updatedDependency) {
          notifyRenderer()
        }
        return { dependency: updatedDependency }
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
        // Get the dependency first to find the card and determine projectId
        let dependency = getCardDependency(params.dependencyId)
        if (!dependency) {
          // If not in central DB, search project DBs
          const projects = listProjects()
          for (const project of projects) {
            dependency = getCardDependency(params.dependencyId, project.id)
            if (dependency) break
          }
        }
        
        // Get projectId from the card
        const projectId = dependency ? getCard(dependency.card_id)?.project_id : undefined
        const success = toggleDependency(params.dependencyId, params.isActive, projectId)
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
        // Get the dependency first to find the card and determine projectId
        let dependency = getCardDependency(dependencyId)
        if (!dependency) {
          // If not in central DB, search project DBs
          const projects = require('../../db').listProjects()
          for (const project of projects) {
            dependency = getCardDependency(dependencyId, project.id)
            if (dependency) break
          }
        }
        
        // Get projectId from the card
        const projectId = dependency ? getCard(dependency.card_id)?.project_id : undefined
        const success = deleteCardDependency(dependencyId, projectId)
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
