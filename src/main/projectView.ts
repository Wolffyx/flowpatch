/**
 * Project View Manager using WebContentsView.
 *
 * This module manages the isolated project renderer within the shell window.
 * It handles:
 * - WebContentsView creation with proper security settings
 * - View positioning and resizing
 * - View lifecycle (open, close, reload)
 * - Communication between shell and project views
 */

import { BrowserWindow, WebContentsView } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

// ============================================================================
// Types
// ============================================================================

export interface ProjectViewState {
  projectId: string
  projectKey: string
  projectPath: string
}

export interface ViewBounds {
  headerHeight: number
  statusBarHeight: number
  sidebarWidth: number
}

// ============================================================================
// State
// ============================================================================

let projectView: WebContentsView | null = null
let currentState: ProjectViewState | null = null
let mainWindowRef: BrowserWindow | null = null

// Default layout bounds
const DEFAULT_BOUNDS: ViewBounds = {
  headerHeight: 48,
  statusBarHeight: 32,
  sidebarWidth: 0 // Sidebar is part of shell, not offsetting project view
}

let viewBounds = { ...DEFAULT_BOUNDS }

// ============================================================================
// View Creation
// ============================================================================

/**
 * Create the project WebContentsView with security settings.
 */
function createView(): WebContentsView {
  const preloadPath = join(__dirname, '../preload/project.js')

  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  // Handle new window requests (open in external browser)
  view.webContents.setWindowOpenHandler(({ url }) => {
    const { shell } = require('electron')
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return view
}

/**
 * Load the project renderer content.
 */
async function loadProjectRenderer(view: WebContentsView): Promise<void> {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    // Development: load from dev server
    await view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/project/index.html`)
  } else {
    // Production: load from built files
    await view.webContents.loadFile(join(__dirname, '../renderer/project/index.html'))
  }
}

// ============================================================================
// View Positioning
// ============================================================================

/**
 * Calculate and apply view bounds based on window size.
 */
function updateViewBounds(mainWindow: BrowserWindow): void {
  if (!projectView) return

  const contentBounds = mainWindow.getContentBounds()

  projectView.setBounds({
    x: viewBounds.sidebarWidth,
    y: viewBounds.headerHeight,
    width: contentBounds.width - viewBounds.sidebarWidth,
    height: contentBounds.height - viewBounds.headerHeight - viewBounds.statusBarHeight
  })
}

/**
 * Set custom view bounds (e.g., when sidebar is shown/hidden).
 */
export function setViewBounds(bounds: Partial<ViewBounds>): void {
  viewBounds = { ...viewBounds, ...bounds }
  if (mainWindowRef && projectView) {
    updateViewBounds(mainWindowRef)
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the project view manager.
 * Call this once when the main window is created.
 */
export function initProjectView(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  // Handle window resize
  mainWindow.on('resize', () => {
    updateViewBounds(mainWindow)
  })

  // Handle window maximize/unmaximize
  mainWindow.on('maximize', () => {
    setTimeout(() => updateViewBounds(mainWindow), 0)
  })
  mainWindow.on('unmaximize', () => {
    setTimeout(() => updateViewBounds(mainWindow), 0)
  })
}

/**
 * Open a project in the WebContentsView.
 *
 * If a project is already open, it will be closed first.
 */
export async function openProjectView(
  mainWindow: BrowserWindow,
  state: ProjectViewState
): Promise<void> {
  // Close existing view if any
  if (projectView) {
    await closeProjectView(mainWindow)
  }

  // Create new view
  projectView = createView()
  currentState = state

  // Add to main window
  mainWindow.contentView.addChildView(projectView)

  // Position the view
  updateViewBounds(mainWindow)

  // Load content
  await loadProjectRenderer(projectView)

  // Send project info to the renderer
  projectView.webContents.send('projectOpened', {
    projectId: state.projectId,
    projectKey: state.projectKey,
    projectPath: state.projectPath
  })
}

/**
 * Close the current project view.
 */
export async function closeProjectView(mainWindow: BrowserWindow): Promise<void> {
  if (!projectView) return

  // Notify renderer of close
  projectView.webContents.send('projectClosing')

  // Remove from window
  mainWindow.contentView.removeChildView(projectView)

  // Destroy the view
  projectView.webContents.close()
  projectView = null
  currentState = null
}

/**
 * Reload the project view.
 */
export async function reloadProjectView(): Promise<void> {
  if (!projectView) return

  await projectView.webContents.reload()

  // Re-send project info after reload
  if (currentState) {
    projectView.webContents.send('projectOpened', {
      projectId: currentState.projectId,
      projectKey: currentState.projectKey,
      projectPath: currentState.projectPath
    })
  }
}

/**
 * Get the current project view.
 */
export function getProjectView(): WebContentsView | null {
  return projectView
}

/**
 * Get the current project state.
 */
export function getCurrentProjectState(): ProjectViewState | null {
  return currentState
}

/**
 * Check if a project view is currently open.
 */
export function isProjectViewOpen(): boolean {
  return projectView !== null
}

/**
 * Send a message to the project renderer.
 */
export function sendToProject(channel: string, ...args: unknown[]): void {
  if (projectView) {
    projectView.webContents.send(channel, ...args)
  }
}

/**
 * Focus the project view.
 */
export function focusProjectView(): void {
  if (projectView) {
    projectView.webContents.focus()
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Cleanup when the main window is closing.
 */
export function cleanupProjectView(): void {
  if (projectView && mainWindowRef) {
    try {
      mainWindowRef.contentView.removeChildView(projectView)
      projectView.webContents.close()
    } catch {
      // Window might already be destroyed
    }
  }
  projectView = null
  currentState = null
  mainWindowRef = null
}
