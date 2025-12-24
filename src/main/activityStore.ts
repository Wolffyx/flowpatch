/**
 * Activity Store for tracking busy state and active runs.
 *
 * This module provides:
 * - Per-project activity tracking
 * - Global busy state aggregation
 * - Activity change subscriptions for UI updates
 *
 * Integrates with the existing WorkerPool to track active workers.
 */

import { broadcastToRenderers } from './ipc/broadcast'

// ============================================================================
// Types
// ============================================================================

export interface ProjectActivity {
  projectId: string
  activeRuns: number
  isBusy: boolean
  lastUpdated: string
}

export interface GlobalActivity {
  totalActiveRuns: number
  isBusy: boolean
  busyProjects: string[]
}

// ============================================================================
// State
// ============================================================================

// Per-project activity state
const projectActivities = new Map<string, ProjectActivity>()

// Subscription callbacks
type ActivityCallback = (activity: ProjectActivity) => void
type GlobalActivityCallback = (activity: GlobalActivity) => void

const projectSubscribers = new Map<string, Set<ActivityCallback>>()
const globalSubscribers = new Set<GlobalActivityCallback>()

// ============================================================================
// Activity Updates
// ============================================================================

/**
 * Update activity for a specific project.
 * Called by WorkerPool when worker count changes.
 */
export function updateProjectActivity(projectId: string, activeRuns: number): void {
  const activity: ProjectActivity = {
    projectId,
    activeRuns,
    isBusy: activeRuns > 0,
    lastUpdated: new Date().toISOString()
  }

  projectActivities.set(projectId, activity)

  // Notify project-specific subscribers
  const subscribers = projectSubscribers.get(projectId)
  if (subscribers) {
    for (const callback of subscribers) {
      try {
        callback(activity)
      } catch (e) {
        console.error('[ActivityStore] Error in project subscriber:', e)
      }
    }
  }

  // Notify global subscribers
  const globalActivity = getGlobalActivity()
  for (const callback of globalSubscribers) {
    try {
      callback(globalActivity)
    } catch (e) {
      console.error('[ActivityStore] Error in global subscriber:', e)
    }
  }

  // Broadcast to renderers
  broadcastToRenderers('activityUpdated', activity)
}

/**
 * Mark a project as idle (no active runs).
 */
export function clearProjectActivity(projectId: string): void {
  updateProjectActivity(projectId, 0)
}

// ============================================================================
// Activity Queries
// ============================================================================

/**
 * Get activity for a specific project.
 */
export function getProjectActivity(projectId: string): ProjectActivity {
  return (
    projectActivities.get(projectId) ?? {
      projectId,
      activeRuns: 0,
      isBusy: false,
      lastUpdated: new Date().toISOString()
    }
  )
}

/**
 * Get global activity aggregated across all projects.
 */
export function getGlobalActivity(): GlobalActivity {
  let totalActiveRuns = 0
  const busyProjects: string[] = []

  for (const [projectId, activity] of projectActivities) {
    totalActiveRuns += activity.activeRuns
    if (activity.isBusy) {
      busyProjects.push(projectId)
    }
  }

  return {
    totalActiveRuns,
    isBusy: totalActiveRuns > 0,
    busyProjects
  }
}

/**
 * Check if a specific project is busy.
 */
export function isProjectBusy(projectId: string): boolean {
  return getProjectActivity(projectId).isBusy
}

/**
 * Check if any project is busy.
 */
export function isAnyProjectBusy(): boolean {
  return getGlobalActivity().isBusy
}

// ============================================================================
// Subscriptions
// ============================================================================

/**
 * Subscribe to activity changes for a specific project.
 * Returns an unsubscribe function.
 */
export function subscribeToProject(projectId: string, callback: ActivityCallback): () => void {
  if (!projectSubscribers.has(projectId)) {
    projectSubscribers.set(projectId, new Set())
  }
  projectSubscribers.get(projectId)!.add(callback)

  // Immediately call with current state
  callback(getProjectActivity(projectId))

  return () => {
    projectSubscribers.get(projectId)?.delete(callback)
  }
}

/**
 * Subscribe to global activity changes.
 * Returns an unsubscribe function.
 */
export function subscribeToGlobal(callback: GlobalActivityCallback): () => void {
  globalSubscribers.add(callback)

  // Immediately call with current state
  callback(getGlobalActivity())

  return () => {
    globalSubscribers.delete(callback)
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Remove activity tracking for a project.
 * Called when a project is closed or deleted.
 */
export function removeProjectActivity(projectId: string): void {
  projectActivities.delete(projectId)
  projectSubscribers.delete(projectId)

  // Notify global subscribers of the change
  const globalActivity = getGlobalActivity()
  for (const callback of globalSubscribers) {
    try {
      callback(globalActivity)
    } catch (e) {
      console.error('[ActivityStore] Error in global subscriber:', e)
    }
  }
}

/**
 * Clear all activity state.
 * Called on app shutdown.
 */
export function clearAllActivity(): void {
  projectActivities.clear()
  projectSubscribers.clear()
  globalSubscribers.clear()
}
