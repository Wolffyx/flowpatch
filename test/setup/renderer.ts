/**
 * Vitest setup file for renderer process tests.
 * Mocks IPC renderer and sets up React Testing Library.
 */
import { vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Mock window.electron.ipcRenderer for renderer tests
const mockIpcRenderer = {
  invoke: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  send: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn()
}

// Setup window.electron mock
Object.defineProperty(window, 'electron', {
  value: {
    ipcRenderer: mockIpcRenderer,
    process: {
      platform: 'win32',
      versions: {
        node: '20.0.0',
        electron: '39.0.0'
      }
    }
  },
  writable: true
})

// Mock matchMedia for components that use it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

// Cleanup after each test
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Export mock for test access
export { mockIpcRenderer }
