/**
 * Worker Pipeline Managers
 *
 * Re-exports all manager classes for the worker pipeline.
 */

// Log management
export { LogManager } from './log-manager'
export type { LogManagerConfig } from './log-manager'

// Plan generation
export { PlanManager } from './plan-manager'

// Plan approval and follow-up instructions
export { ApprovalManager } from './approval-manager'
export type { ApprovalContext } from './approval-manager'

// Card status transitions
export { CardStatusManager } from './card-status-manager'
export type { CardStatusContext } from './card-status-manager'

// Branch operations
export { BranchManager } from './branch-manager'
export type { BranchManagerConfig } from './branch-manager'

// Worktree management
export { WorktreePipelineManager } from './worktree-pipeline-manager'
export type { WorktreePipelineConfig } from './worktree-pipeline-manager'

// Lifecycle management
export { LifecycleManager } from './lifecycle-manager'
export type { LifecycleConfig } from './lifecycle-manager'

// Task decomposition
export { DecompositionManager } from './decomposition-manager'
export type { DecompositionManagerConfig } from './decomposition-manager'

// Iterative AI execution
export { IterativeAIManager } from './iterative-ai-manager'
export type { IterativeAIConfig } from './iterative-ai-manager'
