/**
 * Worker Status Store
 *
 * Single source of truth for worker status per project.
 * All UI components should read from this store via IPC.
 */

import { broadcastToRenderers } from '../ipc/broadcast'
import type { WorkerStatus, WorkerState, WorkerError } from '../../shared/types'

// Single source of truth for worker status per project
const statusByProject = new Map<string, WorkerStatus>()

// Maximum number of errors to keep in history
const MAX_ERROR_HISTORY = 10

/**
 * Get the current worker status for a project.
 * Returns a default idle status if no status is set.
 */
export function getWorkerStatus(projectId: string): WorkerStatus {
  return (
    statusByProject.get(projectId) ?? {
      state: 'idle',
      updatedAt: new Date().toISOString()
    }
  )
}

/**
 * Set the worker status for a project and broadcast to all renderers.
 * Automatically tracks error history when transitioning to 'failed' state.
 */
export function setWorkerStatus(
  projectId: string,
  update: Partial<WorkerStatus> & { state: WorkerState }
): void {
  const defaultStatus: WorkerStatus = {
    state: 'idle',
    updatedAt: new Date().toISOString()
  }
  const current = statusByProject.get(projectId) ?? defaultStatus

  // Build error history entry if transitioning to failed
  let errorHistory = current.errorHistory ?? []
  if (update.state === 'failed' && update.lastError) {
    const newError: WorkerError = {
      error: update.lastError,
      cardId: update.activeCardId ?? current.activeCardId,
      cardTitle: update.activeCardTitle ?? current.activeCardTitle,
      jobId: update.activeJobId ?? current.activeJobId,
      phase: update.currentPhase ?? current.currentPhase,
      timestamp: new Date().toISOString()
    }
    errorHistory = [newError, ...errorHistory].slice(0, MAX_ERROR_HISTORY)
  }

  const newStatus: WorkerStatus = {
    ...current,
    ...update,
    errorHistory,
    // Track last failed card for retry functionality
    lastFailedCardId:
      update.state === 'failed'
        ? (update.activeCardId ?? current.activeCardId)
        : current.lastFailedCardId,
    updatedAt: new Date().toISOString()
  }
  statusByProject.set(projectId, newStatus)

  // Broadcast to all renderers
  broadcastToRenderers('worker:statusChanged', { projectId, status: newStatus })
}

/**
 * Clear the worker status for a project (e.g., when project is closed).
 */
export function clearWorkerStatus(projectId: string): void {
  statusByProject.delete(projectId)
  broadcastToRenderers('worker:statusChanged', {
    projectId,
    status: { state: 'idle' as WorkerState, updatedAt: new Date().toISOString() }
  })
}

/**
 * Get all worker statuses (for debugging/admin purposes).
 */
export function getAllWorkerStatuses(): Map<string, WorkerStatus> {
  return new Map(statusByProject)
}

/**
 * Clear error status back to idle.
 * Preserves error history for reference.
 */
export function clearErrorStatus(projectId: string): void {
  const current = statusByProject.get(projectId)
  if (current?.state === 'failed') {
    const newStatus: WorkerStatus = {
      ...current,
      state: 'idle',
      lastError: undefined,
      lastFailedCardId: undefined,
      activeCardId: undefined,
      activeCardTitle: undefined,
      activeJobId: undefined,
      currentPhase: undefined,
      // Note: errorHistory is preserved
      updatedAt: new Date().toISOString()
    }
    statusByProject.set(projectId, newStatus)
    broadcastToRenderers('worker:statusChanged', { projectId, status: newStatus })
  }
}

/**
 * Get error history for a project.
 */
export function getErrorHistory(projectId: string): WorkerError[] {
  return statusByProject.get(projectId)?.errorHistory ?? []
}

/**
 * Clear error history for a project.
 */
export function clearErrorHistory(projectId: string): void {
  const current = statusByProject.get(projectId)
  if (current) {
    const newStatus: WorkerStatus = {
      ...current,
      errorHistory: [],
      updatedAt: new Date().toISOString()
    }
    statusByProject.set(projectId, newStatus)
    broadcastToRenderers('worker:statusChanged', { projectId, status: newStatus })
  }
}
