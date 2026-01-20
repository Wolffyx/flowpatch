/**
 * Project Database Schema Index
 *
 * Re-exports all schemas for the project database (.flowpatch/project.db).
 * This database stores all project-specific data:
 * - Cards and their relationships
 * - Jobs, events, and worktrees
 * - Worker state and progress
 * - Usage records and chat messages
 */

// Core tables
export * from './cards'
export * from './card-links'
export * from './card-dependencies'

// Activity tables
export * from './events'
export * from './jobs'
export * from './worktrees'
export * from './subtasks'

// Worker tables
export * from './worker-slots'
export * from './worker-progress'
export * from './plan-approvals'
export * from './follow-up-instructions'

// AI and usage tables
export * from './usage'
export * from './agent-chat'
export * from './ai-profiles'

// Feature and sync tables
export * from './feature-suggestions'
export * from './sync-state'
