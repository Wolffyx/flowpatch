/**
 * Application type for E2E testing
 * - electron: Electron desktop app using _electron.launch()
 * - web: Web app with dev server (e.g., Vite, Next.js, CRA)
 * - static: Static HTML/JS app using file:// protocol
 * - auto: Auto-detect based on project structure
 */
export type AppType = 'electron' | 'web' | 'static' | 'auto'

/**
 * Test persistence mode
 * - persistent: Tests are committed with the PR
 * - temporary: Tests are cleaned up after card completion
 */
export type TestPersistence = 'persistent' | 'temporary'

/**
 * Dev server configuration for web apps
 */
export interface DevServerConfig {
  /** Command to start the dev server (auto-detected from package.json if not specified) */
  startCommand?: string
  /** Port to use (auto-detected if not specified) */
  port?: number
  /** Host (defaults to 'localhost') */
  host?: string
  /** Health check URL path (defaults to '/') */
  healthCheckPath?: string
  /** Timeout for server startup in ms (defaults to 30000) */
  startupTimeoutMs?: number
  /** Environment variables to pass to the dev server */
  env?: Record<string, string>
}

export interface E2ETestConfig {
  enabled: boolean
  framework: 'playwright'
  maxRetries: number
  timeoutMinutes: number
  testCommand?: string
  createTestsIfMissing: boolean
  testDirectories?: string[]
  fixToolPriority: 'claude-first'

  /** Application type for E2E testing (defaults to 'auto') */
  appType?: AppType
  /** Test persistence mode (defaults to 'persistent') */
  testPersistence?: TestPersistence
  /** Dev server configuration (for 'web' appType) */
  devServer?: DevServerConfig
  /** Base URL for browser tests (auto-detected from devServer if not specified) */
  baseUrl?: string
  /** Directory for temporary tests (when testPersistence is 'temporary') */
  tempTestDirectory?: string
}
