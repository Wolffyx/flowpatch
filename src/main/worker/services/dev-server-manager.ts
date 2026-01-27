/**
 * Dev Server Manager
 *
 * Manages the lifecycle of development servers for web application E2E testing.
 * Handles auto-detection of start commands, server startup with health checks,
 * and graceful shutdown.
 */

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createServer, type Server } from 'net'

import type { DevServerConfig } from '../../../shared/types/interfaces/e2e-test'

type LogFn = (message: string, meta?: { source: string; stream: 'stdout' | 'stderr' }) => void

export interface DevServerStartResult {
  success: boolean
  port?: number
  url?: string
  error?: string
}

export interface DevServerStatus {
  isRunning: boolean
  port?: number
  url?: string
  pid?: number
}

const DEFAULT_HOST = 'localhost'
const DEFAULT_PORT = 3000
const DEFAULT_HEALTH_CHECK_PATH = '/'
const DEFAULT_STARTUP_TIMEOUT_MS = 30000
const HEALTH_CHECK_INTERVAL_MS = 500
const HEALTH_CHECK_MAX_BACKOFF_MS = 2000
const SHUTDOWN_TIMEOUT_MS = 5000

export class DevServerManager {
  private process: ChildProcess | null = null
  private port: number | null = null
  private host: string
  private url: string | null = null
  private config: DevServerConfig
  private cwd: string
  private log: LogFn
  private isShuttingDown = false

  constructor(config: DevServerConfig, cwd: string, log: LogFn) {
    this.config = config
    this.cwd = cwd
    this.log = log
    this.host = config.host ?? DEFAULT_HOST
  }

  /**
   * Auto-detect the dev server start command from package.json.
   * Checks for: dev, start, serve scripts in that order.
   */
  async detectStartCommand(): Promise<string | null> {
    const packageJsonPath = join(this.cwd, 'package.json')

    if (!existsSync(packageJsonPath)) {
      this.log('No package.json found, cannot auto-detect start command')
      return null
    }

    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      const scripts = packageJson.scripts || {}

      // Priority order for dev server scripts
      const scriptPriority = ['dev', 'start', 'serve', 'preview']

      for (const scriptName of scriptPriority) {
        if (scripts[scriptName]) {
          const command = `npm run ${scriptName}`
          this.log(`Auto-detected start command: ${command}`)
          return command
        }
      }

      this.log('No dev server script found in package.json')
      return null
    } catch (error) {
      this.log(`Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /**
   * Find an available port, starting from the preferred port.
   */
  async detectAvailablePort(preferred?: number): Promise<number> {
    const startPort = preferred ?? this.config.port ?? DEFAULT_PORT

    for (let port = startPort; port < startPort + 100; port++) {
      const isAvailable = await this.isPortAvailable(port)
      if (isAvailable) {
        return port
      }
    }

    // Fallback: let the OS assign a port
    return 0
  }

  /**
   * Check if a port is available.
   */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server: Server = createServer()

      server.once('error', () => {
        resolve(false)
      })

      server.once('listening', () => {
        server.close(() => {
          resolve(true)
        })
      })

      server.listen(port, this.host)
    })
  }

  /**
   * Start the dev server.
   */
  async start(): Promise<DevServerStartResult> {
    if (this.process) {
      return {
        success: true,
        port: this.port!,
        url: this.url!
      }
    }

    // Get start command
    let startCommand = this.config.startCommand
    if (!startCommand) {
      startCommand = await this.detectStartCommand()
      if (!startCommand) {
        return {
          success: false,
          error: 'Could not determine dev server start command. Please specify devServer.startCommand in your config.'
        }
      }
    }

    // Find available port
    this.port = await this.detectAvailablePort()
    this.url = `http://${this.host}:${this.port}`

    this.log(`Starting dev server: ${startCommand}`)
    this.log(`Target URL: ${this.url}`)

    try {
      // Parse command and args
      const [command, ...args] = this.parseCommand(startCommand)

      // Build environment with port configuration
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...this.config.env,
        PORT: String(this.port),
        HOST: this.host,
        // Common framework-specific env vars
        VITE_PORT: String(this.port),
        NEXT_PORT: String(this.port)
      }

      // Spawn the process
      this.process = spawn(command, args, {
        cwd: this.cwd,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      })

      // Log stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const message = data.toString().trim()
        if (message) {
          this.log(message, { source: 'dev-server', stream: 'stdout' })
        }
      })

      // Log stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const message = data.toString().trim()
        if (message) {
          this.log(message, { source: 'dev-server', stream: 'stderr' })
        }
      })

      // Handle process exit
      this.process.on('exit', (code) => {
        if (!this.isShuttingDown) {
          this.log(`Dev server exited unexpectedly with code ${code}`)
        }
        this.process = null
      })

      this.process.on('error', (err) => {
        this.log(`Dev server error: ${err.message}`)
      })

      // Wait for server to be ready
      const timeoutMs = this.config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
      const isReady = await this.waitForReady(timeoutMs)

      if (!isReady) {
        await this.stop()
        return {
          success: false,
          error: `Dev server did not become ready within ${timeoutMs}ms`
        }
      }

      this.log(`Dev server is ready at ${this.url}`)

      return {
        success: true,
        port: this.port,
        url: this.url
      }
    } catch (error) {
      await this.stop()
      return {
        success: false,
        error: `Failed to start dev server: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * Wait for the server to be ready by polling the health check endpoint.
   */
  async waitForReady(timeoutMs: number): Promise<boolean> {
    const healthCheckPath = this.config.healthCheckPath ?? DEFAULT_HEALTH_CHECK_PATH
    const healthCheckUrl = `${this.url}${healthCheckPath}`

    const startTime = Date.now()
    let interval = HEALTH_CHECK_INTERVAL_MS

    this.log(`Waiting for server at ${healthCheckUrl}...`)

    while (Date.now() - startTime < timeoutMs) {
      // Check if process exited
      if (!this.process) {
        return false
      }

      try {
        const isHealthy = await this.checkHealth(healthCheckUrl)
        if (isHealthy) {
          return true
        }
      } catch {
        // Ignore errors during health check
      }

      // Wait before next check with exponential backoff
      await this.sleep(interval)
      interval = Math.min(interval * 1.5, HEALTH_CHECK_MAX_BACKOFF_MS)
    }

    return false
  }

  /**
   * Check if the server is healthy.
   */
  private async checkHealth(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? require('https') : require('http')

      const request = protocol.get(url, { timeout: 2000 }, (res: { statusCode?: number }) => {
        // Accept any 2xx or 3xx status code
        const statusCode = res.statusCode ?? 0
        resolve(statusCode >= 200 && statusCode < 400)
      })

      request.on('error', () => {
        resolve(false)
      })

      request.on('timeout', () => {
        request.destroy()
        resolve(false)
      })
    })
  }

  /**
   * Stop the dev server gracefully.
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return
    }

    this.isShuttingDown = true
    this.log('Stopping dev server...')

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        // Force kill if graceful shutdown fails
        if (this.process) {
          this.log('Force killing dev server...')
          this.forceKill()
        }
        resolve()
      }, SHUTDOWN_TIMEOUT_MS)

      this.process!.once('exit', () => {
        clearTimeout(timeoutId)
        this.process = null
        this.isShuttingDown = false
        this.log('Dev server stopped')
        resolve()
      })

      // Send graceful termination signal
      if (process.platform === 'win32') {
        // On Windows, use taskkill for graceful termination
        this.process!.kill()
      } else {
        this.process!.kill('SIGTERM')
      }
    })
  }

  /**
   * Force kill the process.
   */
  private forceKill(): void {
    if (!this.process) return

    try {
      if (process.platform === 'win32') {
        // On Windows, use taskkill to kill the process tree
        spawn('taskkill', ['/pid', String(this.process.pid), '/f', '/t'], {
          stdio: 'ignore',
          shell: true
        })
      } else {
        this.process.kill('SIGKILL')
      }
    } catch {
      // Ignore errors during force kill
    }
  }

  /**
   * Get current server status.
   */
  getStatus(): DevServerStatus {
    return {
      isRunning: this.process !== null,
      port: this.port ?? undefined,
      url: this.url ?? undefined,
      pid: this.process?.pid
    }
  }

  /**
   * Get the base URL for tests.
   */
  getBaseUrl(): string | null {
    return this.url
  }

  /**
   * Parse a command string into command and arguments.
   */
  private parseCommand(commandString: string): string[] {
    // Simple parsing - split on spaces but respect quotes
    const parts: string[] = []
    let current = ''
    let inQuote = false
    let quoteChar = ''

    for (const char of commandString) {
      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true
        quoteChar = char
      } else if (char === quoteChar && inQuote) {
        inQuote = false
        quoteChar = ''
      } else if (char === ' ' && !inQuote) {
        if (current) {
          parts.push(current)
          current = ''
        }
      } else {
        current += char
      }
    }

    if (current) {
      parts.push(current)
    }

    return parts
  }

  /**
   * Sleep for a given number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
