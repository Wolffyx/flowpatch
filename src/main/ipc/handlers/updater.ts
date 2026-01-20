/**
 * IPC handlers for auto-updater operations.
 */

import { ipcMain } from 'electron'
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateStatus,
  getAppVersion
} from '../../services/auto-updater'

export function registerUpdaterHandlers(): void {
  // Get current update status
  ipcMain.handle('updater:getStatus', () => {
    return getUpdateStatus()
  })

  // Get current app version
  ipcMain.handle('updater:getVersion', () => {
    return getAppVersion()
  })

  // Manually check for updates
  ipcMain.handle('updater:checkForUpdates', () => {
    checkForUpdates()
    return { success: true }
  })

  // Download the available update
  ipcMain.handle('updater:downloadUpdate', () => {
    downloadUpdate()
    return { success: true }
  })

  // Install update and restart
  ipcMain.handle('updater:installUpdate', () => {
    installUpdate()
    return { success: true }
  })
}
