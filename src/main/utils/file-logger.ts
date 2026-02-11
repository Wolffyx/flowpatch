/**
 * File Logger
 *
 * Writes all application logs to disk when `logs.persistEnabled` is on.
 * Uses JSONL format for easy post-processing and keeps a small rotated history
 * to avoid unbounded growth.
 */

import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { getResolvedBool } from '../settingsStore'

// Define the type inline to avoid circular dependency with logStore
interface FileLogEntry {
  id: string
  ts: string
  projectKey: string
  projectId?: string
  jobId?: string
  cardId?: string
  source: string
  stream: 'stdout' | 'stderr' | 'info' | 'error' | 'warn'
  line: string
}

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB soft cap per file
const MAX_ROTATIONS = 3

function getLogDir(): string {
  const dir = join(app.getPath('userData'), 'logs', 'app')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getLogPath(): string {
  return join(getLogDir(), 'app.log')
}

function rotateIfNeeded(filepath: string): void {
  if (!existsSync(filepath)) return
  try {
    const size = statSync(filepath).size
    if (size < MAX_FILE_BYTES) return

    // Shift existing rotations
    for (let i = MAX_ROTATIONS; i >= 1; i--) {
      const rotated = `${filepath}.${i}`
      const prev = i === 1 ? filepath : `${filepath}.${i - 1}`
      if (existsSync(prev)) {
        renameSync(prev, rotated)
      }
    }
  } catch {
    // ignore rotation failures; better to keep logging
  }
}

function shouldLogToFile(): boolean {
  try {
    const envOverride = process.env.FLOWPATCH_FILE_LOG?.toLowerCase()
    if (envOverride === '1' || envOverride === 'true') return true
    if (envOverride === '0' || envOverride === 'false') return false
    return getResolvedBool(null, 'logs.persistEnabled')
  } catch {
    // If settings store isn't ready yet, default to false
    return false
  }
}

/**
 * Safely stringify an object, handling circular references.
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }
    return value
  })
}

/**
 * Append a log entry to the file when enabled.
 */
export function logToFile(entry: FileLogEntry): void {
  if (!shouldLogToFile()) return

  try {
    const filepath = getLogPath()
    rotateIfNeeded(filepath)
    appendFileSync(filepath, safeStringify(entry) + '\n', 'utf-8')
  } catch (err) {
    // Log to console for debugging, but don't crash the app
    console.error('[FileLogger] Failed to write log:', err)
  }
}
