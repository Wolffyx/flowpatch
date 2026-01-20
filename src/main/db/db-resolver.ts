/**
 * Database Resolver
 *
 * Provides functions to resolve which database to use for a given project.
 * This enables gradual migration from the central database to project-local databases.
 *
 * Usage:
 * - Call `resolveProjectDb(projectId)` to get the appropriate database for a project
 * - It automatically checks if the project is migrated and returns the correct DB
 * - For non-migrated projects, it returns the central DB (legacy behavior)
 * - For migrated projects, it returns the project-local DB
 */

import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { getDrizzle } from './drizzle'
import { getProjectDrizzle, hasProjectDb } from './project-db'
import { eq } from 'drizzle-orm'
import * as schema from './schema'
import * as projectSchema from './schema/project'

// Cache for project paths to avoid repeated lookups
const projectPathCache = new Map<string, string>()

/**
 * Get the local path for a project from the central database.
 */
export function getProjectPath(projectId: string): string | null {
  // Check cache first
  const cached = projectPathCache.get(projectId)
  if (cached) return cached

  const db = getDrizzle()
  const project = db
    .select({ local_path: schema.projects.local_path })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get()

  if (project?.local_path) {
    projectPathCache.set(projectId, project.local_path)
    return project.local_path
  }

  return null
}

/**
 * Check if a project is migrated to local storage.
 */
export function isProjectUsingLocalDb(projectId: string): boolean {
  const projectPath = getProjectPath(projectId)
  if (!projectPath) return false

  // Check if project.db exists
  return hasProjectDb(projectPath)
}

/**
 * Get the migration status from the central database.
 */
export function getProjectMigrationFlag(projectId: string): boolean {
  const db = getDrizzle()
  const project = db
    .select({ local_db_migrated: schema.projects.local_db_migrated })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get()

  return project?.local_db_migrated === 1
}

/**
 * Database resolution result.
 */
export interface ResolvedDb {
  /** The database instance to use */
  db: BetterSQLite3Database<typeof schema> | BetterSQLite3Database<typeof projectSchema>
  /** Whether this is a project-local database */
  isLocalDb: boolean
  /** The project path (only set if isLocalDb is true) */
  projectPath: string | null
}

/**
 * Resolve which database to use for a project.
 *
 * Returns the project-local database if the project is migrated,
 * otherwise returns the central database.
 */
export function resolveProjectDb(projectId: string): ResolvedDb {
  const projectPath = getProjectPath(projectId)

  // If project not found or not migrated, use central DB
  if (!projectPath || !hasProjectDb(projectPath)) {
    return {
      db: getDrizzle(),
      isLocalDb: false,
      projectPath: null
    }
  }

  // Use project-local DB
  return {
    db: getProjectDrizzle(projectPath),
    isLocalDb: true,
    projectPath
  }
}

/**
 * Resolve database by project path directly.
 * Use this when you already have the project path.
 */
export function resolveProjectDbByPath(projectPath: string): ResolvedDb {
  if (hasProjectDb(projectPath)) {
    return {
      db: getProjectDrizzle(projectPath),
      isLocalDb: true,
      projectPath
    }
  }

  // Fall back to central DB
  return {
    db: getDrizzle(),
    isLocalDb: false,
    projectPath: null
  }
}

/**
 * Clear the project path cache.
 * Call this when a project is deleted or its path changes.
 */
export function clearProjectPathCache(projectId?: string): void {
  if (projectId) {
    projectPathCache.delete(projectId)
  } else {
    projectPathCache.clear()
  }
}

/**
 * Update the project path cache.
 * Call this when a project's path is known.
 */
export function cacheProjectPath(projectId: string, projectPath: string): void {
  projectPathCache.set(projectId, projectPath)
}

/**
 * Get cached project paths (for debugging).
 */
export function getCachedProjectPaths(): Map<string, string> {
  return new Map(projectPathCache)
}
