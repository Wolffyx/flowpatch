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
import { getProjectDrizzle, hasProjectDb, getProjectDbPath, initProjectDb } from './project-db'
import { eq } from 'drizzle-orm'
import * as schema from './schema'
import * as projectSchema from './schema/project'
import { logAction } from '@shared/utils'
import { existsSync } from 'fs'
import { getResolvedBool } from '../settingsStore'
import { hasDataInCentralDb, migrateProjectToLocalDb } from './migration/project-migration'

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
 * Checks the storage.useLocalDb setting first:
 * - If true: Uses project-local DB (creates it if needed)
 * - If false: Always uses central DB
 *
 * For backward compatibility, if no setting is found and project DB exists,
 * uses project-local DB (migrated projects).
 */
export function resolveProjectDb(projectId: string): ResolvedDb {
  const projectPath = getProjectPath(projectId)
  
  logAction('resolveProjectDb:start', {
    projectId,
    projectPath: projectPath || 'null',
    cached: projectPathCache.has(projectId)
  })

  // If project not found, use central DB
  if (!projectPath) {
    logAction('resolveProjectDb:no_path', {
      projectId,
      reason: 'Project path not found in central DB'
    })
    return {
      db: getDrizzle(),
      isLocalDb: false,
      projectPath: null
    }
  }

  // Check storage preference setting
  const useLocalDb = getResolvedBool(projectId, 'storage.useLocalDb')
  
  logAction('resolveProjectDb:setting_check', {
    projectId,
    useLocalDb,
    projectPath
  })

  // If setting says to use central DB, always use central DB
  if (!useLocalDb) {
    logAction('resolveProjectDb:using_central_by_setting', {
      projectId,
      reason: 'storage.useLocalDb setting is false'
    })
    return {
      db: getDrizzle(),
      isLocalDb: false,
      projectPath: null
    }
  }

  // Setting says to use local DB - check if it exists
  const dbPath = getProjectDbPath(projectPath)
  const dbExists = hasProjectDb(projectPath)
  const fileSystemExists = existsSync(dbPath)
  
  logAction('resolveProjectDb:check', {
    projectId,
    projectPath,
    dbPath,
    dbExists,
    fileSystemExists,
    mismatch: dbExists !== fileSystemExists
  })

  // If project DB doesn't exist but setting says to use local DB, create it automatically
  if (!dbExists) {
    // Check if central DB has data for this project that needs to be migrated
    const hasCentralData = hasDataInCentralDb(projectId)

    logAction('resolveProjectDb:auto_creating_db', {
      projectId,
      projectPath,
      dbPath,
      hasCentralData,
      reason: 'storage.useLocalDb is true but project DB does not exist - creating automatically'
    })

    if (hasCentralData) {
      // Auto-migrate data from central DB to project DB
      // This ensures cards are NEVER lost during storage transition
      logAction('resolveProjectDb:auto_migrating', {
        projectId,
        projectPath,
        reason: 'Central DB has data for this project - auto-migrating to preserve data'
      })

      const migrationResult = migrateProjectToLocalDb(projectId, projectPath)

      logAction('resolveProjectDb:migration_complete', {
        projectId,
        projectPath,
        success: migrationResult.success,
        tablesMigrated: migrationResult.tablesMigrated,
        recordsCopied: migrationResult.recordsCopied,
        errors: migrationResult.errors,
        warnings: migrationResult.warnings
      })

      if (!migrationResult.success) {
        // Migration failed - fall back to central DB to preserve data
        logAction('resolveProjectDb:migration_failed_fallback', {
          projectId,
          projectPath,
          errors: migrationResult.errors,
          reason: 'Migration failed - falling back to central DB to preserve data access'
        })
        return {
          db: getDrizzle(),
          isLocalDb: false,
          projectPath: null
        }
      }
    } else {
      // No existing data - safe to create empty project DB
      // Cards will be synced from remote
      initProjectDb(projectPath)

      logAction('resolveProjectDb:db_created', {
        projectId,
        projectPath,
        dbPath,
        note: 'No central data - created empty project DB'
      })
    }
  }

  // Use project-local DB
  logAction('resolveProjectDb:using_project_db', {
    projectId,
    projectPath,
    dbPath
  })
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
