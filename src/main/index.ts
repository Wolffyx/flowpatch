/**
 * FlowPatch Main Process Entry Point
 *
 * This is the main entry point for the Electron application.
 * It handles app lifecycle, window creation, and initializes services.
 *
 * IPC handlers are registered in ./ipc/handlers/
 */

import { app, BrowserWindow, ipcMain, shell, globalShortcut } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDb, listProjects } from './db'
import { createWindow } from './window'
import { registerAllHandlers } from './ipc/handlers'
import { startEnabledWorkerLoops, stopAllWorkerLoops } from './worker/loop'
import { startCleanupScheduler, stopCleanupScheduler } from './services/worktree-cleanup-scheduler'
import { startIndexScheduler, stopIndexScheduler } from './services/flowpatch-index-scheduler'
import { stopAllSyncSchedulers } from './sync/scheduler'
import { reconcileAllProjects } from './services/worktree-reconciler'
import { initializeSecurity, cleanupSecurity } from './security'

// ============================================================================
// App Initialization
// ============================================================================

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.flowpatch')

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

  // Initialize security module (must be done before registering handlers)
  initializeSecurity(mainWindow)

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

  // Dev-only: Register Ctrl+Shift+R to trigger reset dialog
  if (is.dev) {
    globalShortcut.register('CommandOrControl+Shift+R', () => {
      mainWindow.webContents.send('dev:triggerReset')
    })
  }
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
  stopAllSyncSchedulers()
  stopCleanupScheduler()
  stopIndexScheduler()
  cleanupSecurity()

  // Unregister dev shortcut
  if (is.dev) {
    globalShortcut.unregister('CommandOrControl+Shift+R')
  }
})
