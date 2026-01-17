/**
 * Playwright Electron App Fixture
 *
 * Provides a test fixture for launching the FlowPatch Electron app
 * with an isolated test database.
 */
import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { resolve } from 'path'

/**
 * Extended test fixtures for Electron app testing.
 */
interface ElectronFixtures {
  /** The Electron application instance */
  electronApp: ElectronApplication
  /** The main window page */
  mainWindow: Page
}

/**
 * Custom test that provides Electron app fixtures.
 */
export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    // Launch Electron app with test environment
    const electronApp = await electron.launch({
      args: [resolve(__dirname, '../../../out/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        FLOWPATCH_TEST_MODE: 'true',
        // Use separate userData directory for tests
        FLOWPATCH_USER_DATA: resolve(__dirname, '../../../.test-data')
      }
    })

    await use(electronApp)

    // Cleanup
    await electronApp.close()
  },

  mainWindow: async ({ electronApp }, use) => {
    // Wait for the main window to be ready
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Wait for app to be fully loaded
    await window.waitForSelector('[data-testid="app-loaded"]', {
      timeout: 30000,
      state: 'attached'
    }).catch(() => {
      // If no test id, wait a bit for the app to settle
      return window.waitForTimeout(2000)
    })

    await use(window)
  }
})

/**
 * Re-export expect from Playwright.
 */
export { expect } from '@playwright/test'

/**
 * Helper to get all windows from the Electron app.
 */
export async function getAllWindows(electronApp: ElectronApplication): Promise<Page[]> {
  return electronApp.windows()
}

/**
 * Helper to find a window by URL pattern.
 */
export async function findWindowByUrl(
  electronApp: ElectronApplication,
  urlPattern: string | RegExp
): Promise<Page | undefined> {
  const windows = await getAllWindows(electronApp)
  return windows.find((w) => {
    const url = w.url()
    if (typeof urlPattern === 'string') {
      return url.includes(urlPattern)
    }
    return urlPattern.test(url)
  })
}

/**
 * Helper to wait for a specific window to open.
 */
export async function waitForWindow(
  electronApp: ElectronApplication,
  urlPattern: string | RegExp,
  timeout = 10000
): Promise<Page> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const window = await findWindowByUrl(electronApp, urlPattern)
    if (window) {
      await window.waitForLoadState('domcontentloaded')
      return window
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  throw new Error(`Window matching ${urlPattern} not found within ${timeout}ms`)
}
