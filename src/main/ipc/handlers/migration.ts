/**
 * IPC handlers for project data migration.
 * Handles: migrateProjectToLocal, getMigrationStatus, cleanupCentralData
 */

import { ipcMain } from 'electron'
import {
  getProject,
  migrateProjectToLocalDb,
  isProjectMigrated,
  getMigrationStatus,
  cleanupCentralData,
  hasDataInCentralDb,
  getCentralDataCounts,
  hasProjectDb
} from '../../db'
import { logAction } from '@shared/utils'
import type { MigrationResult } from '../../db'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerMigrationHandlers(notifyRenderer: () => void): void {
  /**
   * Get migration status for a project.
   */
  ipcMain.handle('getMigrationStatus', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }

    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }

    const status = getMigrationStatus(payload.projectId)
    const hasLocalDb = hasProjectDb(project.local_path)
    const hasCentralData = hasDataInCentralDb(payload.projectId)
    const centralCounts = hasCentralData ? getCentralDataCounts(payload.projectId) : {}

    return {
      projectId: payload.projectId,
      projectPath: project.local_path,
      status,
      isMigrated: status === 'migrated' || hasLocalDb, // Map to boolean for UI
      projectDbExists: hasLocalDb, // Map to expected property name
      hasLocalDb,
      hasCentralData,
      centralCounts
    }
  })

  /**
   * Migrate project data from central DB to local .flowpatch/project.db.
   * Supports streaming progress updates via 'migration-progress' events.
   */
  ipcMain.handle('migrateProjectToLocal', (event, payload: { projectId: string }) => {
    logAction('migrateProjectToLocal', payload)

    if (!payload?.projectId) return { error: 'Project ID required' }

    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }

    // Allow re-migration even if project DB exists (for recovery or data refresh)
    // The migration uses INSERT OR REPLACE, so existing data will be updated correctly
    const isReMigration = isProjectMigrated(project.local_path)

    // Perform migration with progress callbacks
    const result: MigrationResult = migrateProjectToLocalDb(
      payload.projectId,
      project.local_path,
      (progress) => {
        // Stream progress updates to renderer
        event.sender.send('migration-progress', {
          projectId: payload.projectId,
          progress
        })
      }
    )

    logAction('migrateProjectToLocal:result', {
      projectId: payload.projectId,
      success: result.success,
      tablesMigrated: result.tablesMigrated.length,
      duration: result.duration_ms,
      verified: result.verification?.passed
    })

    if (result.success) {
      notifyRenderer()
    }

    return {
      success: result.success,
      result,
      isReMigration,
      message: result.success
        ? isReMigration
          ? `Successfully re-migrated ${result.tablesMigrated.length} tables in ${result.duration_ms}ms`
          : `Successfully migrated ${result.tablesMigrated.length} tables in ${result.duration_ms}ms`
        : `Migration failed: ${result.errors.join(', ')}`
    }
  })

  /**
   * Clean up project data from central DB after migration.
   * This is optional and should be explicitly requested by the user.
   */
  ipcMain.handle('cleanupCentralProjectData', (_e, payload: { projectId: string }) => {
    logAction('cleanupCentralProjectData', payload)

    if (!payload?.projectId) return { error: 'Project ID required' }

    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }

    // Verify project is migrated before cleanup
    if (!isProjectMigrated(project.local_path)) {
      return {
        error: 'Project must be migrated before cleanup. Run migrateProjectToLocal first.'
      }
    }

    try {
      cleanupCentralData(payload.projectId)
      logAction('cleanupCentralProjectData:success', { projectId: payload.projectId })
      notifyRenderer()
      return { success: true, message: 'Central database data cleaned up successfully' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logAction('cleanupCentralProjectData:error', {
        projectId: payload.projectId,
        error: errorMessage
      })
      return { error: errorMessage }
    }
  })

  /**
   * Check if a project needs migration (has data in central DB).
   * With re-migration support, this returns true if there's any central data,
   * regardless of whether a local DB exists.
   */
  ipcMain.handle('checkMigrationNeeded', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }

    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }

    const hasLocalDb = hasProjectDb(project.local_path)
    const hasCentralData = hasDataInCentralDb(payload.projectId)

    return {
      projectId: payload.projectId,
      needsMigration: hasCentralData, // Allow migration/re-migration if there's central data
      hasLocalDb,
      hasCentralData,
      reason: hasCentralData
        ? hasLocalDb
          ? 'Re-migration available (data exists in both central and local DB)'
          : 'Migration needed (data exists only in central DB)'
        : 'No data in central database'
    }
  })

  /**
   * Get detailed counts of data in central DB for a project.
   */
  ipcMain.handle('getCentralDataCounts', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }

    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }

    const counts = getCentralDataCounts(payload.projectId)
    const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0)

    return {
      projectId: payload.projectId,
      counts,
      totalRecords
    }
  })
}
