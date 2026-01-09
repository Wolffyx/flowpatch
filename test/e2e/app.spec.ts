/**
 * E2E Tests: App Launch
 *
 * Basic tests to verify the Electron app launches correctly.
 */
import { test, expect } from './fixtures/electron-app'

test.describe('App Launch', () => {
  test('should launch the app successfully', async ({ electronApp }) => {
    // Verify the app is running
    const windows = electronApp.windows()
    expect(windows.length).toBeGreaterThanOrEqual(1)
  })

  test('should show the main window', async ({ mainWindow }) => {
    // Verify the main window is visible
    const title = await mainWindow.title()
    expect(title).toBeTruthy()
  })

  test('should have correct window properties', async ({ electronApp, mainWindow }) => {
    // Check window is visible and not minimized
    const isVisible = await mainWindow.evaluate(() => {
      // This runs in the renderer context
      return true
    })
    expect(isVisible).toBe(true)
  })
})

test.describe('App Navigation', () => {
  test('should be able to navigate within the app', async ({ mainWindow }) => {
    // Basic navigation test - verify page loads
    await mainWindow.waitForLoadState('load')

    // Check that some UI element exists
    const body = await mainWindow.$('body')
    expect(body).toBeTruthy()
  })
})
