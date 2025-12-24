/**
 * Patchwork Main Process Entry Point
 *
 * This is the main entry point for the Electron application.
 * It handles app lifecycle, window creation, and initializes services.
 *
 * IPC handlers are registered in ./ipc/handlers/
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { initDb, listProjects } from './db'
import { createWindow } from './window'
import { registerAllHandlers } from './ipc/handlers'
import { startEnabledWorkerLoops, stopAllWorkerLoops } from './worker/loop'
import { startCleanupScheduler, stopCleanupScheduler } from './services/worktree-cleanup-scheduler'
import { startIndexScheduler, stopIndexScheduler } from './services/patchwork-index-scheduler'
import { reconcileAllProjects } from './services/worktree-reconciler'

// ============================================================================
// App Initialization
// ============================================================================

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.patchwork')

  // Initialize database
  initDb()

  // Watch for new windows
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Open external links
  ipcMain.on('openExternal', (_e, url: string) => {
    if (url && typeof url === 'string') {
      shell.openExternal(url)
    }
  })

  // Create main window
  const mainWindow = createWindow()

  // Register all IPC handlers
  registerAllHandlers(mainWindow)

  // Background indexing for all linked repos + always-on file watching
  startIndexScheduler()

  // Start worker loops for all projects that have worker enabled
  startEnabledWorkerLoops()

  // Start worktree cleanup scheduler
  startCleanupScheduler()

  // Reconcile worktrees on startup
  reconcileAllProjects(listProjects()).catch((err) => {
    console.error('Failed to reconcile worktrees on startup:', err)
  })

  // Handle macOS dock click
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ============================================================================
// App Cleanup
// ============================================================================

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Stop all worker loops and cleanup scheduler on app quit
app.on('before-quit', () => {
  stopAllWorkerLoops()
  stopCleanupScheduler()
  stopIndexScheduler()
})
