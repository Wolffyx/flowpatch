/**
 * Window management for the Electron app.
 * Handles creation and configuration of the main BrowserWindow.
 */

import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerShellHandlers } from './ipc/shellHandlers'

let mainWindow: BrowserWindow | null = null

/**
 * Create the main application window.
 */
export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false, // Custom title bar for tabs
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0b0c',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/shell.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Register shell IPC handlers (includes tab manager initialization)
  registerShellHandlers(mainWindow)

  // Load the shell renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/shell/index.html`)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/shell/index.html'))
  }

  return mainWindow
}

/**
 * Get the main window instance.
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * Check if the main window exists and is not destroyed.
 */
export function isMainWindowValid(): boolean {
  return mainWindow !== null && !mainWindow.isDestroyed()
}
