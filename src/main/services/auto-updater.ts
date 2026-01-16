/**
 * Auto-Updater Service
 *
 * Handles checking for updates, downloading, and installing.
 * Broadcasts update status to renderers via IPC.
 */

import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { sendToShell } from '../ipc/broadcast'

// ============================================================================
// Types
// ============================================================================

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  releaseDate?: string
  downloadProgress?: number
  error?: string
}

// ============================================================================
// State
// ============================================================================

let currentStatus: UpdateStatus = { state: 'idle' }
let checkIntervalId: NodeJS.Timeout | null = null
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

// ============================================================================
// Internal Helpers
// ============================================================================

function updateStatus(status: Partial<UpdateStatus>): void {
  currentStatus = { ...currentStatus, ...status }
  sendToShell('updater:statusChanged', currentStatus)
}

function formatReleaseNotes(info: UpdateInfo): string | undefined {
  if (!info.releaseNotes) return undefined
  if (typeof info.releaseNotes === 'string') return info.releaseNotes
  // Array of release notes (multi-version)
  return info.releaseNotes
    .map((note) => (typeof note === 'string' ? note : note.note))
    .filter(Boolean)
    .join('\n\n')
}

// ============================================================================
// Updater Configuration
// ============================================================================

function configureUpdater(): void {
  // Don't auto-download - let user decide
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // Configure logging in development
  if (is.dev) {
    autoUpdater.logger = console
  }

  // Event handlers
  autoUpdater.on('checking-for-update', () => {
    updateStatus({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    updateStatus({
      state: 'available',
      version: info.version,
      releaseNotes: formatReleaseNotes(info),
      releaseDate: info.releaseDate
    })
  })

  autoUpdater.on('update-not-available', () => {
    updateStatus({ state: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    updateStatus({
      state: 'downloading',
      downloadProgress: Math.round(progress.percent)
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    updateStatus({
      state: 'downloaded',
      version: info.version
    })
  })

  autoUpdater.on('error', (error: Error) => {
    updateStatus({
      state: 'error',
      error: error.message
    })
    // Reset to idle after error so user can retry
    setTimeout(() => updateStatus({ state: 'idle' }), 5000)
  })
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the auto-updater service.
 * Should be called during app startup.
 */
export function initAutoUpdater(): void {
  // Skip in development mode
  if (is.dev) {
    console.log('[AutoUpdater] Skipping in development mode')
    return
  }

  configureUpdater()

  // Check for updates on startup (after a short delay)
  setTimeout(() => {
    checkForUpdates()
  }, 10_000) // 10 seconds after startup

  // Set up periodic checks
  startPeriodicChecks()
}

/**
 * Start periodic update checks.
 */
export function startPeriodicChecks(): void {
  if (is.dev) return
  if (checkIntervalId) clearInterval(checkIntervalId)
  checkIntervalId = setInterval(() => {
    checkForUpdates()
  }, CHECK_INTERVAL_MS)
}

/**
 * Stop periodic update checks.
 */
export function stopPeriodicChecks(): void {
  if (checkIntervalId) {
    clearInterval(checkIntervalId)
    checkIntervalId = null
  }
}

/**
 * Manually check for updates.
 */
export function checkForUpdates(): void {
  if (is.dev) {
    console.log('[AutoUpdater] Skipping check in development mode')
    // In dev mode, simulate the check for testing UI
    updateStatus({ state: 'checking' })
    setTimeout(() => updateStatus({ state: 'not-available' }), 1000)
    return
  }
  autoUpdater.checkForUpdates()
}

/**
 * Download the available update.
 */
export function downloadUpdate(): void {
  if (currentStatus.state !== 'available') {
    console.warn('[AutoUpdater] No update available to download')
    return
  }
  autoUpdater.downloadUpdate()
}

/**
 * Install the downloaded update and restart the app.
 */
export function installUpdate(): void {
  if (currentStatus.state !== 'downloaded') {
    console.warn('[AutoUpdater] No update downloaded to install')
    return
  }
  autoUpdater.quitAndInstall()
}

/**
 * Get the current update status.
 */
export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

/**
 * Get the current app version.
 */
export function getAppVersion(): string {
  return app.getVersion()
}
