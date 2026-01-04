/**
 * Tab Manager for Chrome-like tab system.
 *
 * Manages multiple project tabs, each with its own WebContentsView:
 * - Create/close tabs
 * - Switch between tabs
 * - Tab ordering and drag-drop
 * - Tab persistence for session restore
 */

import { BrowserWindow, WebContentsView, Menu } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getAppSetting, setAppSetting } from './db'
import { registerTrustedWebContents } from './security'

// ============================================================================
// Types
// ============================================================================

export interface Tab {
  id: string
  projectId: string
  projectKey: string
  projectPath: string
  projectName: string
  view: WebContentsView
  isLoading: boolean
  didFinishLoadHandler?: () => void
}

export interface TabState {
  id: string
  projectId: string
  projectKey: string
  projectPath: string
  projectName: string
}

export interface TabManagerState {
  tabs: TabState[]
  activeTabId: string | null
}

// ============================================================================
// Configuration
// ============================================================================

const TAB_BAR_HEIGHT = 36
const STATUS_BAR_HEIGHT = 0

// ============================================================================
// State
// ============================================================================

const tabs = new Map<string, Tab>()
let activeTabId: string | null = null
let mainWindowRef: BrowserWindow | null = null
let tabCounter = 0
let logsPanelHeight = 0 // Height reserved for logs panel
let isModalOpen = false // Track if a modal dialog is open

// ============================================================================
// View Creation
// ============================================================================

function createProjectView(): WebContentsView {
  const preloadPath = join(__dirname, '../preload/project.js')

  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  // Prevent white flashes while the project renderer loads (API varies by Electron version).
  const setViewBackground = (color: string) => {
    const maybeView = view as unknown as { setBackgroundColor?: (c: string) => void }
    if (typeof maybeView.setBackgroundColor === 'function') {
      maybeView.setBackgroundColor(color)
      return
    }
    const maybeWebContents = view.webContents as unknown as {
      setBackgroundColor?: (c: string) => void
    }
    if (typeof maybeWebContents.setBackgroundColor === 'function') {
      maybeWebContents.setBackgroundColor(color)
    }
  }
  setViewBackground('#0b0b0c')

  // Handle new window requests (window.open)
  view.webContents.setWindowOpenHandler(({ url }) => {
    const { shell } = require('electron')
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Handle navigation to external URLs (clicking <a> tags)
  view.webContents.on('will-navigate', (event, url) => {
    // Allow navigation within the app
    const appUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : 'file://'
    if (appUrl && url.startsWith(appUrl)) {
      return
    }
    // Open external URLs in default browser
    event.preventDefault()
    const { shell } = require('electron')
    shell.openExternal(url)
  })

  if (is.dev) {
    view.webContents.on('before-input-event', (event, input) => {
      const isF12 = input.type === 'keyDown' && input.key === 'F12'
      const isCtrlShiftI =
        input.type === 'keyDown' && input.key.toLowerCase() === 'i' && input.control && input.shift

      if (!isF12 && !isCtrlShiftI) return
      event.preventDefault()

      if (view.webContents.isDevToolsOpened()) {
        view.webContents.closeDevTools()
      } else {
        view.webContents.openDevTools({ mode: 'detach' })
      }
    })

    view.webContents.on('context-menu', (_event, params) => {
      if (!mainWindowRef || mainWindowRef.isDestroyed()) return

      Menu.buildFromTemplate([
        {
          label: 'Inspect Element',
          click: () => {
            view.webContents.openDevTools({ mode: 'detach' })
            view.webContents.inspectElement(params.x, params.y)
          }
        }
      ]).popup({ window: mainWindowRef })
    })
  }

  return view
}

async function loadProjectRenderer(view: WebContentsView): Promise<void> {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    await view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/project/index.html`)
  } else {
    await view.webContents.loadFile(join(__dirname, '../renderer/project/index.html'))
  }
}

// ============================================================================
// Tab Positioning
// ============================================================================

function updateTabBounds(tab: Tab): void {
  if (!mainWindowRef) return

  const contentBounds = mainWindowRef.getContentBounds()
  const isActive = tab.id === activeTabId

  // Calculate height accounting for logs panel
  const availableHeight =
    contentBounds.height - TAB_BAR_HEIGHT - STATUS_BAR_HEIGHT - logsPanelHeight

  if (isActive && !isModalOpen) {
    // Active tab is visible (unless modal is open)
    tab.view.setBounds({
      x: 0,
      y: TAB_BAR_HEIGHT,
      width: contentBounds.width,
      height: availableHeight
    })
    tab.view.setVisible(true)
  } else {
    // Inactive tabs or when modal is open - hide them
    tab.view.setBounds({
      x: 0,
      y: TAB_BAR_HEIGHT,
      width: contentBounds.width,
      height: availableHeight
    })
    tab.view.setVisible(false)
  }
}

function updateAllTabBounds(): void {
  for (const tab of tabs.values()) {
    updateTabBounds(tab)
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the tab manager.
 */
export function initTabManager(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  // Handle window resize
  mainWindow.on('resize', () => {
    updateAllTabBounds()
  })

  mainWindow.on('maximize', () => {
    setTimeout(updateAllTabBounds, 0)
  })

  mainWindow.on('unmaximize', () => {
    setTimeout(updateAllTabBounds, 0)
  })
}

/**
 * Generate a unique tab ID.
 */
function generateTabId(): string {
  return `tab_${Date.now()}_${tabCounter++}`
}

/**
 * Create a new tab for a project.
 */
export async function createTab(
  projectId: string,
  projectKey: string,
  projectPath: string,
  projectName: string
): Promise<Tab> {
  if (!mainWindowRef) {
    throw new Error('Tab manager not initialized')
  }

  const tabId = generateTabId()
  const view = createProjectView()

  const tab: Tab = {
    id: tabId,
    projectId,
    projectKey,
    projectPath,
    projectName,
    view,
    isLoading: true
  }

  // If the renderer reloads (e.g., Vite full reload during HMR), it loses the
  // initial project context. Re-send the project's identity after each load.
  tab.didFinishLoadHandler = () => {
    view.webContents.send('projectOpened', {
      projectId,
      projectKey,
      projectPath
    })
  }
  view.webContents.on('did-finish-load', tab.didFinishLoadHandler)

  tabs.set(tabId, tab)

  // Register this tab's WebContents as trusted for security
  registerTrustedWebContents(view.webContents)

  // Add view to window
  mainWindowRef.contentView.addChildView(view)
  // Ensure newly-created views don't briefly show with incorrect bounds.
  tab.view.setVisible(false)
  updateTabBounds(tab)

  // Load content
  await loadProjectRenderer(view)

  tab.isLoading = false

  // Activate this tab
  await activateTab(tabId)

  // Notify shell of tab change
  notifyTabsChanged()

  // Persist tabs
  persistTabs()

  return tab
}

/**
 * Close a tab.
 */
export async function closeTab(tabId: string): Promise<void> {
  const tab = tabs.get(tabId)
  if (!tab || !mainWindowRef) return

  if (tab.didFinishLoadHandler) {
    tab.view.webContents.removeListener('did-finish-load', tab.didFinishLoadHandler)
  }

  // Notify renderer
  tab.view.webContents.send('projectClosing')

  // Remove from window
  mainWindowRef.contentView.removeChildView(tab.view)

  // Destroy view
  tab.view.webContents.close()

  // Remove from tabs
  tabs.delete(tabId)

  // If this was the active tab, activate another
  if (activeTabId === tabId) {
    const remainingTabs = Array.from(tabs.keys())
    if (remainingTabs.length > 0) {
      await activateTab(remainingTabs[remainingTabs.length - 1])
    } else {
      activeTabId = null
    }
  }

  notifyTabsChanged()
  persistTabs()
}

/**
 * Activate a tab (make it visible).
 */
export async function activateTab(tabId: string): Promise<void> {
  const tab = tabs.get(tabId)
  if (!tab) return

  // Hide previous active tab
  if (activeTabId && activeTabId !== tabId) {
    const prevTab = tabs.get(activeTabId)
    if (prevTab) {
      prevTab.view.setVisible(false)
    }
  }

  activeTabId = tabId
  // Persist active project immediately so restart restores last-focused tab,
  // even if the app quits without calling cleanupTabManager().
  setAppSetting(ACTIVE_TAB_KEY, tab.projectId)

  // Show and position this tab
  updateTabBounds(tab)
  tab.view.webContents.focus()

  notifyTabsChanged()
}

/**
 * Get all tabs.
 */
export function getAllTabs(): TabState[] {
  return Array.from(tabs.values()).map((tab) => ({
    id: tab.id,
    projectId: tab.projectId,
    projectKey: tab.projectKey,
    projectPath: tab.projectPath,
    projectName: tab.projectName
  }))
}

/**
 * Get the active tab ID.
 */
export function getActiveTabId(): string | null {
  return activeTabId
}

/**
 * Deactivate all tabs (hide them so home view shows through).
 * Used when user clicks + button or home button.
 */
export function deactivateAllTabs(): void {
  // Hide the currently active tab
  if (activeTabId) {
    const tab = tabs.get(activeTabId)
    if (tab) {
      tab.view.setVisible(false)
    }
  }

  // Set active to null
  activeTabId = null

  // Notify shell that no tab is active
  notifyTabsChanged()
}

/**
 * Get a tab by ID.
 */
export function getTab(tabId: string): Tab | undefined {
  return tabs.get(tabId)
}

/**
 * Get tab by project ID.
 */
export function getTabByProjectId(projectId: string): Tab | undefined {
  for (const tab of tabs.values()) {
    if (tab.projectId === projectId) {
      return tab
    }
  }
  return undefined
}

/**
 * Check if a project is already open in a tab.
 */
export function isProjectOpen(projectId: string): boolean {
  return getTabByProjectId(projectId) !== undefined
}

/**
 * Move a tab to a new position.
 */
export function moveTab(tabId: string, newIndex: number): void {
  const tabArray = Array.from(tabs.entries())
  const currentIndex = tabArray.findIndex(([id]) => id === tabId)

  if (currentIndex === -1 || currentIndex === newIndex) return

  const [removed] = tabArray.splice(currentIndex, 1)
  tabArray.splice(newIndex, 0, removed)

  tabs.clear()
  for (const [id, tab] of tabArray) {
    tabs.set(id, tab)
  }

  notifyTabsChanged()
  persistTabs()
}

/**
 * Close all tabs.
 */
export async function closeAllTabs(): Promise<void> {
  const tabIds = Array.from(tabs.keys())
  for (const tabId of tabIds) {
    await closeTab(tabId)
  }
}

/**
 * Close tabs to the right of a tab.
 */
export async function closeTabsToRight(tabId: string): Promise<void> {
  const tabArray = Array.from(tabs.keys())
  const index = tabArray.indexOf(tabId)
  if (index === -1) return

  const toClose = tabArray.slice(index + 1)
  for (const id of toClose) {
    await closeTab(id)
  }
}

/**
 * Close other tabs (all except the specified one).
 */
export async function closeOtherTabs(tabId: string): Promise<void> {
  const tabArray = Array.from(tabs.keys())
  for (const id of tabArray) {
    if (id !== tabId) {
      await closeTab(id)
    }
  }
}

/**
 * Duplicate a tab.
 */
export async function duplicateTab(tabId: string): Promise<Tab | null> {
  const tab = tabs.get(tabId)
  if (!tab) return null

  return createTab(tab.projectId, tab.projectKey, tab.projectPath, tab.projectName)
}

// ============================================================================
// Notifications
// ============================================================================

function notifyTabsChanged(): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return

  const state: TabManagerState = {
    tabs: getAllTabs(),
    activeTabId
  }

  mainWindowRef.webContents.send('tabsChanged', state)
}

// ============================================================================
// Persistence
// ============================================================================

const TABS_STORAGE_KEY = 'tabs:openTabs'
const ACTIVE_TAB_KEY = 'tabs:activeTab'

function persistTabs(): void {
  const tabStates = getAllTabs()
  setAppSetting(TABS_STORAGE_KEY, JSON.stringify(tabStates))
  if (activeTabId) {
    const activeTab = tabs.get(activeTabId)
    if (activeTab) {
      setAppSetting(ACTIVE_TAB_KEY, activeTab.projectId)
    }
  }
}

/**
 * Restore tabs from previous session.
 */
export async function restoreTabs(): Promise<void> {
  const stored = getAppSetting(TABS_STORAGE_KEY)
  if (!stored) return

  try {
    const tabStates: TabState[] = JSON.parse(stored)
    const lastActiveProjectId = getAppSetting(ACTIVE_TAB_KEY)

    for (const state of tabStates) {
      await createTab(state.projectId, state.projectKey, state.projectPath, state.projectName)
    }

    // Activate the previously active tab
    if (lastActiveProjectId) {
      const tab = getTabByProjectId(lastActiveProjectId)
      if (tab) {
        await activateTab(tab.id)
      }
    }
  } catch (error) {
    console.error('Failed to restore tabs:', error)
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Cleanup when app is closing.
 */
export function cleanupTabManager(): void {
  persistTabs()

  for (const tab of tabs.values()) {
    try {
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.contentView.removeChildView(tab.view)
      }
      tab.view.webContents.close()
    } catch {
      // Window might already be destroyed
    }
  }

  tabs.clear()
  activeTabId = null
  mainWindowRef = null
}

// ============================================================================
// Send to Active Tab
// ============================================================================

/**
 * Send a message to the active tab.
 */
export function sendToActiveTab(channel: string, ...args: unknown[]): void {
  if (!activeTabId) return

  const tab = tabs.get(activeTabId)
  if (tab && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.send(channel, ...args)
  }
}

/**
 * Send a message to all tabs.
 */
export function sendToAllTabs(channel: string, ...args: unknown[]): void {
  for (const tab of tabs.values()) {
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.send(channel, ...args)
    }
  }
}

/**
 * Send a message to a specific tab.
 */
export function sendToTab(tabId: string, channel: string, ...args: unknown[]): void {
  const tab = tabs.get(tabId)
  if (tab && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.send(channel, ...args)
  }
}

/**
 * Get project ID from webContents ID.
 * Used by IPC handlers to determine which project a request is for.
 */
export function getProjectIdFromWebContents(webContentsId: number): string | null {
  for (const tab of tabs.values()) {
    if (tab.view.webContents.id === webContentsId) {
      return tab.projectId
    }
  }
  return null
}

/**
 * Get tab from webContents ID.
 */
export function getTabFromWebContents(webContentsId: number): Tab | null {
  for (const tab of tabs.values()) {
    if (tab.view.webContents.id === webContentsId) {
      return tab
    }
  }
  return null
}

// ============================================================================
// Modal and Panel State
// ============================================================================

/**
 * Set the logs panel height (0 if closed).
 * Updates tab bounds to accommodate the panel.
 */
export function setLogsPanelHeight(height: number): void {
  logsPanelHeight = height
  updateAllTabBounds()
}

/**
 * Set whether a modal dialog is open.
 * When open, hides all tabs so dialogs are visible.
 */
export function setModalOpen(open: boolean): void {
  isModalOpen = open
  updateAllTabBounds()
}
