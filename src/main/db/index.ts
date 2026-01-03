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
  updateCardConflictStatus,
  clearCardConflictStatus,
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

// Plan Approvals
export {
  getPlanApproval,
  getPlanApprovalByJob,
  getPendingApprovals,
  getAllPendingApprovals,
  createPlanApproval,
  approvePlan,
  rejectPlan,
  skipApproval,
  deletePlanApproval,
  deletePlanApprovalsByJob
} from './plan-approvals'
export type { PlanApprovalCreate } from './plan-approvals'

// Follow-up Instructions
export {
  getFollowUpInstruction,
  getFollowUpInstructionsByJob,
  getPendingFollowUpInstructions,
  getPendingInstructionsByProject,
  getPendingInstructionsByCard,
  createFollowUpInstruction,
  markInstructionProcessing,
  markInstructionApplied,
  markInstructionRejected,
  deleteFollowUpInstruction,
  deleteFollowUpInstructionsByJob,
  countPendingInstructions,
  getNextPendingInstruction
} from './follow-up-instructions'
export type { FollowUpInstructionCreate } from './follow-up-instructions'

// Usage Tracking
export {
  createUsageRecord,
  getUsageRecords,
  getUsageRecordsByJob,
  getUsageStatsByTool,
  getUsageSummary,
  getDailyUsage,
  getMonthlyUsage,
  getTotalUsage,
  getToolLimits,
  getAllToolLimits,
  setToolLimits,
  getUsageWithLimits,
  deleteOldUsageRecords
} from './usage'
export type { UsageRecordCreate } from './usage'

// Agent Chat
export {
  createChatMessage,
  getChatMessage,
  getChatMessagesByJob,
  getChatMessagesByCard,
  getChatMessagesByProject,
  getRecentChatContext,
  getUnreadCount,
  getChatSummary,
  updateMessageStatus,
  markAllAsRead,
  updateMessageContent,
  deleteChatMessage,
  deleteChatMessagesByJob,
  deleteOldChatMessages,
  buildChatContextForPrompt
} from './agent-chat'

// AI Profiles
export {
  createAIProfile,
  getAIProfile,
  getAIProfilesByProject,
  getDefaultAIProfile,
  getAIProfileByName,
  countAIProfiles,
  updateAIProfile,
  setDefaultAIProfile,
  deleteAIProfile,
  deleteAIProfilesByProject,
  duplicateAIProfile
} from './ai-profiles'
export type { CreateAIProfileData, UpdateAIProfileData } from './ai-profiles'

// Feature Suggestions
export {
  createFeatureSuggestion,
  getFeatureSuggestion,
  getFeatureSuggestionsByProject,
  countFeatureSuggestions,
  updateFeatureSuggestion,
  updateFeatureSuggestionStatus,
  deleteFeatureSuggestion,
  deleteFeatureSuggestionsByProject,
  voteOnSuggestion,
  getUserVote,
  getVotesForSuggestion,
  removeVote
} from './feature-suggestions'
export type {
  CreateFeatureSuggestionData,
  UpdateFeatureSuggestionData,
  GetFeatureSuggestionsOptions
} from './feature-suggestions'

// Card Dependencies
export {
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
  deleteDependenciesForCard,
  deleteDependentsOfCard,
  deleteDependenciesByProject,
  deleteDependencyBetweenCards
} from './card-dependencies'
export type {
  CreateCardDependencyData,
  UpdateCardDependencyData
} from './card-dependencies'

// Utility re-export for backward compatibility
export { generateId as cryptoRandomId } from '@shared/utils'
