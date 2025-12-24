/**
 * IPC Handler Registration
 *
 * This module consolidates all IPC handler registrations into a single entry point.
 * Each handler module is responsible for registering its own handlers.
 */

import type { BrowserWindow } from 'electron'
import { registerRepoHandlers } from './repo'
import { registerProjectHandlers } from './project'
import { registerCardHandlers } from './card'
import { registerWorkerHandlers } from './worker'
import { registerSyncHandlers } from './sync'
import { registerSettingsHandlers } from './settings'
import { registerAIHandlers } from './ai'
import { registerOnboardingHandlers } from './onboarding'
import { registerWorktreeHandlers } from './worktree'
import { sendToAllTabs } from '../../tabManager'

let mainWindowRef: BrowserWindow | null = null

/**
 * Notify all renderers (main window + project tabs) of state changes.
 */
export function notifyRenderer(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('stateUpdated')
  }
  // Also notify all project tabs (WebContentsViews)
  sendToAllTabs('stateUpdated')
}

/**
 * Register all IPC handlers.
 * Should be called once during app initialization.
 */
export function registerAllHandlers(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  // Register handlers by domain
  registerRepoHandlers()
  registerProjectHandlers(notifyRenderer)
  registerCardHandlers(notifyRenderer)
  registerWorkerHandlers(notifyRenderer)
  registerSyncHandlers(notifyRenderer)
  registerSettingsHandlers()
  registerAIHandlers()
  registerOnboardingHandlers(notifyRenderer)
  registerWorktreeHandlers(notifyRenderer)
}

// Re-export individual registrations for granular use
export {
  registerRepoHandlers,
  registerProjectHandlers,
  registerCardHandlers,
  registerWorkerHandlers,
  registerSyncHandlers,
  registerSettingsHandlers,
  registerAIHandlers,
  registerOnboardingHandlers,
  registerWorktreeHandlers
}

// Re-export onboarding helpers used by repo handlers
export { setOnboardingBool, getOnboardingBool } from './onboarding'
