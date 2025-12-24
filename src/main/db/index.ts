/**
 * Database Module
 *
 * Re-exports all database operations from their respective modules.
 * This provides a single import point for all database functionality.
 */

// Connection
export { initDb, getDb } from './connection'

// Projects
export {
  listProjects,
  getProject,
  upsertProject,
  deleteProject,
  updateProjectWorkerEnabled,
  updateProjectSyncTime,
  updateProjectPolicyJson
} from './projects'
export type { Project } from './projects'

// Cards
export {
  listCards,
  getCard,
  getCardByRemote,
  upsertCard,
  createLocalTestCard,
  updateCardStatus,
  updateCardLabels,
  getStatusLabelFromPolicy,
  getAllStatusLabelsFromPolicy,
  updateCardSyncState,
  deleteCard,
  getNextReadyCard,
  getNextReadyCards
} from './cards'
export type { Card, CardStatus } from './cards'

// Jobs
export {
  listJobs,
  listRecentJobs,
  getJob,
  createJob,
  updateJobState,
  updateJobResult,
  acquireJobLease,
  renewJobLease,
  getNextQueuedJob,
  getRunningJobs,
  hasActiveWorkerJob,
  getActiveWorkerJob,
  getActiveWorkerJobForCard,
  cancelJob,
  getActiveWorkerJobCount
} from './jobs'
export type { Job, JobState, JobType } from './jobs'

// Events
export { listEvents, listCardEvents, createEvent } from './events'
export type { Event, EventType } from './events'

// Card Links
export { listCardLinks, listCardLinksByProject, createCardLink, ensureCardLink } from './card-links'
export type { CardLink } from './card-links'

// Settings
export { getAppSetting, setAppSetting, deleteAppSetting } from './settings'

// Sync State
export { getSyncCursor, setSyncCursor } from './sync-state'

// Worktrees
export {
  listWorktrees,
  listWorktreesByStatus,
  getWorktree,
  getWorktreeByPath,
  getWorktreeByBranch,
  getWorktreeByCard,
  getWorktreeByJob,
  createWorktree,
  updateWorktreeStatus,
  updateWorktreeJob,
  deleteWorktree,
  acquireWorktreeLock,
  renewWorktreeLock,
  releaseWorktreeLock,
  getExpiredWorktreeLocks,
  countActiveWorktrees
} from './worktrees'
export type { Worktree, WorktreeStatus, WorktreeCreate } from './worktrees'

// Subtasks
export {
  listSubtasks,
  listSubtasksByProject,
  getSubtask,
  createSubtask,
  updateSubtaskStatus,
  getNextPendingSubtask,
  deleteSubtask,
  deleteSubtasksByCard
} from './subtasks'
export type { Subtask, SubtaskStatus, SubtaskCreate } from './subtasks'

// Worker Slots
export {
  listWorkerSlots,
  getWorkerSlot,
  initializeWorkerSlots,
  acquireWorkerSlot,
  updateWorkerSlot,
  releaseWorkerSlot,
  getIdleSlotCount,
  getRunningSlotCount
} from './worker-slots'
export type { WorkerSlot, WorkerSlotStatus } from './worker-slots'

// Worker Progress
export {
  getWorkerProgress,
  getWorkerProgressByJob,
  createWorkerProgress,
  updateWorkerProgress,
  clearWorkerProgress
} from './worker-progress'
export type { WorkerProgress, WorkerProgressCreate } from './worker-progress'

// Utility re-export for backward compatibility
export { generateId as cryptoRandomId } from '@shared/utils'
