/**
 * Vitest setup file for main process tests.
 * Mocks Electron APIs and sets up test database.
 */
import { vi } from 'vitest'

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      switch (name) {
        case 'userData':
          return '/tmp/flowpatch-test'
        case 'temp':
          return '/tmp'
        default:
          return `/tmp/${name}`
      }
    }),
    getName: vi.fn(() => 'FlowPatch'),
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false,
    quit: vi.fn(),
    on: vi.fn(),
    once: vi.fn()
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn()
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    webContents: {
      send: vi.fn(),
      on: vi.fn()
    },
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false)
  })),
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn()
  }
}))

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true
  },
  electronApp: {
    setAppUserModelId: vi.fn()
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  }
}))

// Global test utilities
beforeEach(() => {
  vi.clearAllMocks()
})
