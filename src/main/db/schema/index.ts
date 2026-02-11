/**
 * Drizzle Schema Index
 *
 * Re-exports all table schemas and relations.
 *
 * ARCHITECTURE:
 * - Central DB ({userData}/kanban/kanban.db): Global settings, project registry
 * - Project DB (.flowpatch/project.db): Cards, jobs, events, etc. per-project
 *
 * For new code:
 * - Use `import * as centralSchema from './schema/central'` for central DB
 * - Use `import * as projectSchema from './schema/project'` for project DB
 *
 * Legacy exports below maintain backward compatibility with existing code.
 *
 * NOTE: Namespaced re-exports (export * as X) are NOT included here because
 * they interfere with Drizzle's table extraction. Import them directly:
 * - import * as centralSchema from './schema/central'
 * - import * as projectSchema from './schema/project'
 */

// ============================================================================
// LEGACY EXPORTS (for backward compatibility)
// These export the original schemas from the root schema files.
// New code should use direct imports from ./central or ./project.
// ============================================================================

// Central DB tables (these remain in the central database)
export * from './projects'
export * from './settings'
export * from './ai-tool-limits'

// Project DB tables (these will move to project databases)
// Exported here for backward compatibility during migration
export * from './cards'
export * from './card-links'
export * from './card-dependencies'
export * from './events'
export * from './jobs'
export * from './sync-state'
export * from './worktrees'
export * from './subtasks'
export * from './worker-slots'
export * from './worker-progress'
export * from './plan-approvals'
export * from './follow-up-instructions'
export * from './usage'
export * from './agent-chat'
export * from './ai-profiles'
export * from './feature-suggestions'
export * from './card-comments'
