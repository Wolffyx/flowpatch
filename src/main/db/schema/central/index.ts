/**
 * Central Database Schema Index
 *
 * Re-exports all schemas for the central database ({userData}/kanban/kanban.db).
 * This database stores:
 * - Project registry (list of known projects)
 * - Global app settings (theme, API keys, window state)
 * - Global AI tool limits
 */

export * from './projects'
export * from './settings'
export * from './ai-tool-limits'
