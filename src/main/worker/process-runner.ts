/**
 * Process Runner
 *
 * Handles streaming process execution with timeout and cancellation support.
 */

import { spawn, execFile } from 'child_process'

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
  onLog?: (message: string, meta: { source: string; stream: 'stdout' | 'stderr' }) => void
  isCanceled?: () => boolean
}

/**
 * Run a process with streaming output and timeout support.
 */
export async function runProcessStreaming(options: ProcessStreamingOptions): Promise<void> {
  const { command, args, cwd, timeoutMs, source, env, onLog, isCanceled } = options

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

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
