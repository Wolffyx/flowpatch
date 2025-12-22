import { BrowserWindow } from 'electron'
import { getProjectView } from '../projectView'
import { sendToAllTabs } from '../tabManager'

/**
 * Broadcast a message to all renderers including:
 * - All BrowserWindows (shell)
 * - The WebContentsView (project renderer)
 */
export function broadcastToRenderers(channel: string, ...args: unknown[]): void {
  // Send to all windows
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }

  // Send to all project tabs (WebContentsViews)
  sendToAllTabs(channel, ...args)

  // Send to project view if it exists
  const projectView = getProjectView()
  if (projectView && !projectView.webContents.isDestroyed()) {
    projectView.webContents.send(channel, ...args)
  }
}

/**
 * Send a message only to the shell renderer (main window)
 */
export function sendToShell(channel: string, ...args: unknown[]): void {
  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

/**
 * Send a message only to the project renderer
 */
export function sendToProjectRenderer(channel: string, ...args: unknown[]): void {
  const projectView = getProjectView()
  if (projectView && !projectView.webContents.isDestroyed()) {
    projectView.webContents.send(channel, ...args)
  }
}
