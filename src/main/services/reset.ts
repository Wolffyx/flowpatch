/**
 * App Reset Service
 *
 * Orchestrates full app reset to return to fresh install state.
 * Resets database, in-memory caches, and settings while preserving
 * project files and repositories.
 */

import { app } from 'electron'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { stopAllWorkerLoops } from '../worker/loop'
import { stopAllSyncSchedulers } from '../sync/scheduler'
import { stopCleanupScheduler } from './worktree-cleanup-scheduler'
import { stopIndexScheduler } from './flowpatch-index-scheduler'
import { closeAllTabs } from '../tabManager'
import { clearAllCaches } from '../worker/cache'
import { clearAllLogs } from '../logStore'
import { closeDrizzle } from '../db/drizzle'

export interface ResetResult {
  success: boolean
  error?: string
}

/**
 * Perform full app reset.
 *
 * Order of operations:
 * 1. Stop all running processes (workers, sync, schedulers)
 * 2. Close all tabs
 * 3. Clear in-memory caches
 * 4. Close and delete database
 * 5. Restart app
 *
 * Does NOT touch project files or .flowpatch directories.
 */
export async function performFullReset(): Promise<ResetResult> {
  try {
    console.log('[reset] Starting full app reset...')

    // 1. Stop all running processes
    console.log('[reset] Stopping worker loops...')
    stopAllWorkerLoops()

    console.log('[reset] Stopping sync schedulers...')
    stopAllSyncSchedulers()

    console.log('[reset] Stopping cleanup scheduler...')
    stopCleanupScheduler()

    console.log('[reset] Stopping index scheduler...')
    stopIndexScheduler()

    // 2. Close all tabs
    console.log('[reset] Closing all tabs...')
    await closeAllTabs()

    // 3. Clear in-memory caches
    console.log('[reset] Clearing caches...')
    clearAllCaches()
    clearAllLogs()

    // 4. Close database connection
    console.log('[reset] Closing database connection...')
    closeDrizzle()

    // 5. Delete database files
    console.log('[reset] Deleting database files...')
    const dbDir = join(app.getPath('userData'), 'kanban')
    const dbFile = join(dbDir, 'kanban.db')
    const walFile = join(dbDir, 'kanban.db-wal')
    const shmFile = join(dbDir, 'kanban.db-shm')

    if (existsSync(dbFile)) {
      unlinkSync(dbFile)
      console.log('[reset] Deleted kanban.db')
    }
    if (existsSync(walFile)) {
      unlinkSync(walFile)
      console.log('[reset] Deleted kanban.db-wal')
    }
    if (existsSync(shmFile)) {
      unlinkSync(shmFile)
      console.log('[reset] Deleted kanban.db-shm')
    }

    console.log('[reset] Reset complete, restarting app...')

    // 6. Restart the app
    app.relaunch()
    app.exit(0)

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[reset] Reset failed:', errorMessage)
    return { success: false, error: errorMessage }
  }
}
