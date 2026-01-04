/**
 * Process Runner
 *
 * Handles streaming process execution with timeout and cancellation support.
 * 
 * Security: All process execution goes through the command guard to prevent
 * unauthorized or dangerous command execution.
 */

import { spawn, execFile, execFileSync } from 'child_process'
import {
  validateCommand,
  createCommandGuardConfig,
  isBlockedCommand,
  isCommandLineSafe
} from '../security/command-guard'
import type { ExecutionOrigin, CommandGuardConfig } from '../../shared/types'
import { logAction } from '../../shared/utils'

function resolveWindowsSpawnCommand(command: string, env: NodeJS.ProcessEnv): string {
  // If the caller passed a path or explicit extension, don't try to resolve it.
  if (command.includes('\\') || command.includes('/') || /\.[A-Za-z0-9]+$/.test(command)) return command

  try {
    const raw = execFileSync('where', [command], {
      env,
      encoding: 'utf-8',
      windowsHide: true
    })

    const matches = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (!matches.length) return command

    const preferredExts = ['.exe', '.cmd', '.bat', '.com']
    for (const ext of preferredExts) {
      const hit = matches.find((m) => m.toLowerCase().endsWith(ext))
      if (hit) return hit
    }

    return matches[0]
  } catch {
    return command
  }
}

export class WorkerCanceledError extends Error {
  constructor(message = 'Canceled') {
    super(message)
    this.name = 'WorkerCanceledError'
  }
}

export interface ProcessStreamingOptions {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
  source: string
  env?: NodeJS.ProcessEnv
  stdin?: string
  onLog?: (message: string, meta: { source: string; stream: 'stdout' | 'stderr' }) => void
  isCanceled?: () => boolean
  /** Execution origin for security validation */
  origin?: ExecutionOrigin
  /** Command guard configuration (from policy) */
  guardConfig?: CommandGuardConfig
  /** Skip security checks (only for internal trusted operations) */
  skipSecurityCheck?: boolean
}

/**
 * Run a process with streaming output and timeout support.
 * 
 * Security: Commands are validated against the policy's allowlist before execution.
 * Blocked commands (e.g., rm, sudo, curl) are always rejected regardless of policy.
 */
export async function runProcessStreaming(options: ProcessStreamingOptions): Promise<void> {
  const {
    command,
    args,
    cwd,
    timeoutMs,
    source,
    env,
    stdin,
    onLog,
    isCanceled,
    origin = 'worker_pipeline',
    guardConfig,
    skipSecurityCheck = false
  } = options

  // Security validation (unless explicitly skipped for internal operations)
  if (!skipSecurityCheck) {
    // Quick check for blocked commands
    if (isBlockedCommand(command)) {
      const error = `Security: Command '${command}' is blocked for security reasons`
      logAction('security:commandBlocked', { command, args, source, reason: 'blocked_command' })
      throw new Error(error)
    }

    // Full validation with guard config if provided
    if (guardConfig) {
      const validationResult = validateCommand(command, args, cwd, guardConfig, origin)
      if (!validationResult.allowed) {
        const error = `Security: ${validationResult.reason}`
        logAction('security:commandRejected', {
          command,
          args,
          source,
          reason: validationResult.reason,
          origin
        })
        throw new Error(error)
      }
    }

    // Validate the full command line isn't doing anything sneaky
    const fullCommandLine = [command, ...args].join(' ')
    if (!isCommandLineSafe(fullCommandLine)) {
      const error = `Security: Command line contains dangerous patterns`
      logAction('security:commandLineUnsafe', { commandLine: fullCommandLine, source })
      throw new Error(error)
    }
  }

  await new Promise<void>((resolve, reject) => {
    const spawnCommand =
      process.platform === 'win32'
        ? resolveWindowsSpawnCommand(command, env ?? process.env)
        : command

    const child = spawn(spawnCommand, args, {
      cwd,
      env: env ?? process.env,
      stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe']
    })

    if (stdin) {
      try {
        child.stdin?.write(stdin)
        child.stdin?.end()
      } catch {
        // ignore
      }
    }

    let killedByTimeout = false
    const timer = setTimeout(() => {
      killedByTimeout = true
      try {
        if (process.platform === 'win32' && child.pid) {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {})
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        // ignore
      }
    }, timeoutMs)

    let killedByCancel = false
    const cancelTimer = isCanceled
      ? setInterval(() => {
          if (!isCanceled()) return
          if (!child.pid) return

          killedByCancel = true
          try {
            if (process.platform === 'win32') {
              execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {})
            } else {
              child.kill('SIGTERM')
              setTimeout(() => {
                try {
                  child.kill('SIGKILL')
                } catch {
                  // ignore
                }
              }, 2000)
            }
          } catch {
            // ignore
          }
        }, 500)
      : null

    const buffers = { stdout: '', stderr: '' }
    const tail = { stdout: [] as string[], stderr: [] as string[] }

    const pushTail = (stream: 'stdout' | 'stderr', line: string): void => {
      if (!line) return
      tail[stream].push(line)
      if (tail[stream].length > 40) tail[stream].shift()
    }

    const flushLine = (line: string, stream: 'stdout' | 'stderr'): void => {
      const trimmed = line.trimEnd()
      if (trimmed) {
        pushTail(stream, trimmed)
        onLog?.(trimmed, { source, stream })
      }
    }

    const onChunk = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      buffers[stream] += chunk.toString('utf-8')
      const parts = buffers[stream].split(/\r\n|\n|\r/)
      buffers[stream] = parts.pop() ?? ''
      for (const part of parts) flushLine(part, stream)
    }

    child.stdout?.on('data', (c: Buffer) => onChunk('stdout', c))
    child.stderr?.on('data', (c: Buffer) => onChunk('stderr', c))

    child.on('error', (err) => {
      clearTimeout(timer)
      if (cancelTimer) clearInterval(cancelTimer)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (cancelTimer) clearInterval(cancelTimer)

      flushLine(buffers.stdout, 'stdout')
      flushLine(buffers.stderr, 'stderr')

      if (killedByCancel || (isCanceled && isCanceled())) {
        reject(new WorkerCanceledError())
        return
      }
      if (killedByTimeout) {
        reject(new Error(`${command} timed out after ${Math.ceil(timeoutMs / 1000)}s`))
        return
      }
      if (code && code !== 0) {
        const stderrTail = tail.stderr.length
          ? `\n\n--- stderr (tail) ---\n${tail.stderr.join('\n')}`
          : ''
        const stdoutTail = tail.stdout.length
          ? `\n\n--- stdout (tail) ---\n${tail.stdout.join('\n')}`
          : ''
        reject(new Error(`${command} exited with code ${code}${stderrTail}${stdoutTail}`))
        return
      }
      resolve()
    })
  })
}

// ============================================================================
// Secure Process Execution Helpers
// ============================================================================

/**
 * AI tools that are allowed to be executed (whitelisted).
 * These are the only commands the worker should execute for AI operations.
 */
const ALLOWED_AI_TOOLS = ['claude', 'codex']

/**
 * Run an AI tool with security validation.
 * Only allows execution of whitelisted AI tools (claude, codex).
 */
export async function runSecureAIProcess(options: ProcessStreamingOptions): Promise<void> {
  const { command } = options
  
  // Extract base command name
  const baseCommand = command.split(/[\\/]/).pop()?.toLowerCase().replace(/\.(exe|cmd|bat)$/i, '') ?? ''
  
  // Verify this is a whitelisted AI tool
  if (!ALLOWED_AI_TOOLS.includes(baseCommand)) {
    const error = `Security: '${command}' is not a recognized AI tool. Allowed: ${ALLOWED_AI_TOOLS.join(', ')}`
    logAction('security:aiToolRejected', { command, baseCommand, allowed: ALLOWED_AI_TOOLS })
    throw new Error(error)
  }
  
  // Run with worker_pipeline origin (trusted internal operation)
  return runProcessStreaming({
    ...options,
    origin: 'worker_pipeline',
    skipSecurityCheck: true // AI tools are pre-validated above
  })
}

/**
 * Run a git command securely.
 * Git commands are allowed for internal operations.
 */
export async function runSecureGitProcess(options: Omit<ProcessStreamingOptions, 'command'>): Promise<void> {
  return runProcessStreaming({
    ...options,
    command: 'git',
    origin: 'worker_pipeline',
    skipSecurityCheck: true // Git is trusted for internal operations
  })
}

// Re-export for convenience
export { createCommandGuardConfig }
