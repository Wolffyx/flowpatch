/**
 * Store Module
 *
 * Re-exports all store hooks for convenient importing.
 */

// Main composite hook (backward compatible)
export { useAppStore } from './useAppStore'
export type { AppStore, ProjectData } from './useAppStore'

// Domain-specific hooks
export { useProjects } from './useProjects'
export type { UseProjectsResult, PendingRemoteSelection } from './useProjects'

export { useCards } from './useCards'
export type { UseCardsResult, UseCardsOptions } from './useCards'

export { useWorker } from './useWorker'
export type { UseWorkerResult, UseWorkerOptions } from './useWorker'

export { useSync } from './useSync'
export type { UseSyncResult, UseSyncOptions } from './useSync'

export { useUISettings } from './useUISettings'
export type { UseUISettingsResult, UseUISettingsOptions } from './useUISettings'
