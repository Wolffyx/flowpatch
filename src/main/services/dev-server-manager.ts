/**
 * Dev Server Manager
 *
 * Manages long-running development server processes for testing worker modifications.
 * Integrates with ResourceTracker for automatic cleanup.
 */

import { spawn, type ChildProcess } from 'child_process'
import { trackProcess } from '../utils/resource-tracker'
import { broadcastToRenderers } from '../ipc/broadcast'

export interface DevServerProcess {
  cardId: string
  projectId: string
  process: ChildProcess
  resourceTrackerId?: string
  workingDir: string
  command: string
  args: string[]
  port?: number
  status: 'starting' | 'running' | 'stopped' | 'error'
  output: string[]
  startedAt: Date
  lastHealthCheck?: Date
  healthCheckUrl?: string
  error?: string
}

export interface StartServerOptions {
  cardId: string
  projectId: string
  workingDir: string
  command: string
  args: string[]
  env?: Record<string, string>
}

/**
 * Port detection patterns for common dev servers
 */
const PORT_PATTERNS = [
  // Vite
  /Local:\s+http:\/\/localhost:(\d+)/i,
  /vite.*localhost:(\d+)/i,
  // Next.js
  /ready.*started server on.*?(\d+)/i,
  /Local:\s+http:\/\/localhost:(\d+)/i,
  // Create React App / Webpack
  /webpack.*compiled.*?(\d+)/i,
  /Project is running at http:\/\/localhost:(\d+)/i,
  // Express / Node
  /listening on port (\d+)/i,
  /Server running on port (\d+)/i,
  // Django
  /Starting development server at http:\/\/.*?:(\d+)/i,
  // FastAPI / Uvicorn
  /Uvicorn running on http:\/\/.*?:(\d+)/i,
  // Go
  /listening on.*?:(\d+)/i,
  // Rust / Actix
  /Server running on http:\/\/.*?:(\d+)/i
]

/**
 * Dev Server Manager class
 */
export class DevServerManager {
  private processes: Map<string, DevServerProcess> = new Map()

  /**
   * Start a dev server process
   */
  async startServer(options: StartServerOptions): Promise<DevServerProcess> {
    const { cardId, projectId, workingDir, command, args, env } = options

    // Check if server already running for this card
    const existing = this.processes.get(cardId)
    if (existing && existing.status === 'running') {
      throw new Error(`Dev server already running for card ${cardId}`)
    }

    // Stop existing process if in error state
    if (existing && existing.status === 'error') {
      await this.stopServer(cardId)
    }

    const processInfo: DevServerProcess = {
      cardId,
      projectId,
      process: null as unknown as ChildProcess,
      workingDir,
      command,
      args,
      status: 'starting',
      output: [],
      startedAt: new Date()
    }

    try {
      // Spawn the process
      const child = spawn(command, args, {
        cwd: workingDir,
        env: { ...process.env, ...env },
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })

      processInfo.process = child

      // Track the process with ResourceTracker
      processInfo.resourceTrackerId = trackProcess(child, `Dev server for card ${cardId}`, {
        cardId,
        projectId,
        workingDir,
        command,
        args
      })

      // Handle stdout
      child.stdout?.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split(/\r?\n/).filter((line) => line.trim())
        for (const line of lines) {
          processInfo.output.push(line)
          this.detectPort(line, processInfo)
          this.broadcastOutput(cardId, line, 'stdout')
        }
      })

      // Handle stderr
      child.stderr?.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split(/\r?\n/).filter((line) => line.trim())
        for (const line of lines) {
          processInfo.output.push(line)
          this.detectPort(line, processInfo)
          this.broadcastOutput(cardId, line, 'stderr')
        }
      })

      // Handle process exit
      child.on('exit', (code, signal) => {
        if (code === 0) {
          processInfo.status = 'stopped'
        } else {
          processInfo.status = 'error'
          processInfo.error = `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`
        }
        this.broadcastStatus(cardId, processInfo.status)
        this.processes.delete(cardId)
      })

      // Handle process error
      child.on('error', (error) => {
        processInfo.status = 'error'
        processInfo.error = error.message
        this.broadcastStatus(cardId, 'error')
        this.processes.delete(cardId)
      })

      // Mark as running after a short delay (to allow process to start)
      setTimeout(() => {
        if (processInfo.status === 'starting' && child.pid) {
          processInfo.status = 'running'
          this.broadcastStatus(cardId, 'running')
        }
      }, 1000)

      this.processes.set(cardId, processInfo)
      this.broadcastStatus(cardId, 'starting')

      return processInfo
    } catch (error) {
      processInfo.status = 'error'
      processInfo.error = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  /**
   * Stop a dev server process
   */
  async stopServer(cardId: string): Promise<void> {
    const processInfo = this.processes.get(cardId)
    if (!processInfo) {
      return
    }

    const child = processInfo.process
    if (child && child.pid && !child.killed) {
      try {
        if (process.platform === 'win32') {
          // Windows: use taskkill
          const { execFile } = require('child_process')
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {
            // Ignore errors
          })
        } else {
          // Unix: send SIGTERM, then SIGKILL
          child.kill('SIGTERM')
          setTimeout(() => {
            try {
              if (!child.killed) {
                child.kill('SIGKILL')
              }
            } catch {
              // Ignore
            }
          }, 2000)
        }
      } catch (error) {
        console.error(`Error stopping dev server for card ${cardId}:`, error)
      }
    }

    processInfo.status = 'stopped'
    this.broadcastStatus(cardId, 'stopped')
    this.processes.delete(cardId)
  }

  /**
   * Get status of a dev server
   */
  getStatus(cardId: string): DevServerProcess | null {
    return this.processes.get(cardId) || null
  }

  /**
   * Get all running servers for a project
   */
  getAllStatuses(projectId: string): DevServerProcess[] {
    return Array.from(this.processes.values()).filter((p) => p.projectId === projectId)
  }

  /**
   * Stop all servers for a project
   */
  async stopAllServers(projectId: string): Promise<void> {
    const servers = this.getAllStatuses(projectId)
    await Promise.all(servers.map((s) => this.stopServer(s.cardId)))
  }

  /**
   * Stop all servers (cleanup)
   */
  async stopAll(): Promise<void> {
    const cardIds = Array.from(this.processes.keys())
    await Promise.all(cardIds.map((cardId) => this.stopServer(cardId)))
  }

  /**
   * Detect port from output line
   */
  private detectPort(line: string, processInfo: DevServerProcess): void {
    if (processInfo.port) {
      return // Already detected
    }

    for (const pattern of PORT_PATTERNS) {
      const match = line.match(pattern)
      if (match && match[1]) {
        const port = parseInt(match[1], 10)
        if (port > 0 && port < 65536) {
          processInfo.port = port
          processInfo.healthCheckUrl = `http://localhost:${port}`
          this.broadcastPort(cardId, port)
          break
        }
      }
    }
  }

  /**
   * Broadcast output to renderer
   */
  private broadcastOutput(cardId: string, line: string, stream: 'stdout' | 'stderr'): void {
    broadcastToRenderers('dev-server:output', {
      cardId,
      line,
      stream,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * Broadcast status change to renderer
   */
  private broadcastStatus(cardId: string, status: DevServerProcess['status']): void {
    broadcastToRenderers('dev-server:status', {
      cardId,
      status,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * Broadcast port detection to renderer
   */
  private broadcastPort(cardId: string, port: number): void {
    broadcastToRenderers('dev-server:port', {
      cardId,
      port,
      url: `http://localhost:${port}`,
      timestamp: new Date().toISOString()
    })
  }
}

// Singleton instance
export const devServerManager = new DevServerManager()
