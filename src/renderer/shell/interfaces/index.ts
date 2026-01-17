/**
 * Shell Interfaces Index
 *
 * Barrel export for all shell interfaces
 */

export type { TabState, TabManagerState } from './tab'
export type { LogEntry } from './log'
export type { ActivityState } from './activity'

// Re-export shell-api for side effects (global declaration)
import './shell-api'
