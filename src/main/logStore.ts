/**
 * Log Store with in-memory ring buffer.
 *
 * This module provides:
 * - In-memory log storage with configurable size limit
 * - Per-project log filtering
 * - Log export functionality
 * - Real-time log streaming via broadcast
 *
 * Disk persistence is deferred to a future version.
 */

import { app } from 'electron'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { broadcastToRenderers } from './ipc/broadcast'

// ============================================================================
// Types
// ============================================================================

export interface LogEntry {
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

export interface LogStoreConfig {
  maxEntries: number
  maxLineLength: number
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: LogStoreConfig = {
  maxEntries: 5000,
  maxLineLength: 16384 // 16KB per line max
}

let config = { ...DEFAULT_CONFIG }

/**
 * Update log store configuration.
 */
export function configureLogStore(newConfig: Partial<LogStoreConfig>): void {
  config = { ...config, ...newConfig }
  trimBuffer()
}

// ============================================================================
// Ring Buffer Implementation
// ============================================================================

// The log buffer
const buffer: LogEntry[] = []

// Counter for unique IDs
let idCounter = 0

/**
 * Generate a unique log entry ID.
 */
function generateId(): string {
  return `log_${Date.now()}_${idCounter++}`
}

/**
 * Trim buffer to max size.
 */
function trimBuffer(): void {
  while (buffer.length > config.maxEntries) {
    buffer.shift()
  }
}

/**
 * Truncate a line if it exceeds max length.
 */
function truncateLine(line: string): string {
  if (line.length > config.maxLineLength) {
    return line.slice(0, config.maxLineLength) + '... [truncated]'
  }
  return line
}

// ============================================================================
// Log Operations
// ============================================================================

/**
 * Append a log entry to the buffer.
 * Broadcasts to renderers for real-time updates.
 */
export function appendLog(entry: Omit<LogEntry, 'id'>): LogEntry {
  const fullEntry: LogEntry = {
    ...entry,
    id: generateId(),
    line: truncateLine(entry.line)
  }

  buffer.push(fullEntry)
  trimBuffer()

  // Broadcast to all renderers
  broadcastToRenderers('logEntry', fullEntry)

  return fullEntry
}

/**
 * Append multiple log entries at once.
 * More efficient than calling appendLog multiple times.
 */
export function appendLogs(entries: Omit<LogEntry, 'id'>[]): LogEntry[] {
  const fullEntries: LogEntry[] = entries.map((entry) => ({
    ...entry,
    id: generateId(),
    line: truncateLine(entry.line)
  }))

  buffer.push(...fullEntries)
  trimBuffer()

  // Broadcast each entry
  for (const entry of fullEntries) {
    broadcastToRenderers('logEntry', entry)
  }

  return fullEntries
}

/**
 * Helper to create and append a log entry.
 */
export function log(
  projectKey: string,
  source: string,
  line: string,
  stream: LogEntry['stream'] = 'info',
  extra?: { projectId?: string; jobId?: string; cardId?: string }
): LogEntry {
  return appendLog({
    ts: new Date().toISOString(),
    projectKey,
    source,
    stream,
    line,
    ...extra
  })
}

// ============================================================================
// Log Queries
// ============================================================================

/**
 * Get all logs from the buffer.
 */
export function getAllLogs(): LogEntry[] {
  return [...buffer]
}

/**
 * Get logs for a specific project.
 */
export function getProjectLogs(projectKey: string): LogEntry[] {
  return buffer.filter((e) => e.projectKey === projectKey)
}

/**
 * Get logs for a specific job.
 */
export function getJobLogs(jobId: string): LogEntry[] {
  return buffer.filter((e) => e.jobId === jobId)
}

/**
 * Get the last N logs.
 */
export function getRecentLogs(count: number): LogEntry[] {
  return buffer.slice(-count)
}

/**
 * Get logs since a specific timestamp.
 */
export function getLogsSince(since: string): LogEntry[] {
  return buffer.filter((e) => e.ts > since)
}

/**
 * Get buffer statistics.
 */
export function getLogStats(): {
  totalEntries: number
  maxEntries: number
  projectCounts: Record<string, number>
} {
  const projectCounts: Record<string, number> = {}
  for (const entry of buffer) {
    projectCounts[entry.projectKey] = (projectCounts[entry.projectKey] || 0) + 1
  }

  return {
    totalEntries: buffer.length,
    maxEntries: config.maxEntries,
    projectCounts
  }
}

// ============================================================================
// Log Export
// ============================================================================

/**
 * Export logs to a file.
 * Returns the path to the exported file.
 */
export function exportLogs(
  projectKey?: string,
  options?: {
    format?: 'json' | 'text'
    filename?: string
  }
): string {
  const format = options?.format ?? 'json'
  const logs = projectKey ? getProjectLogs(projectKey) : getAllLogs()

  // Create exports directory
  const exportsDir = join(app.getPath('userData'), 'exports')
  if (!existsSync(exportsDir)) {
    mkdirSync(exportsDir, { recursive: true })
  }

  // Generate filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const projectSuffix = projectKey ? `_${projectKey.replace(/[:/]/g, '_')}` : ''
  const filename =
    options?.filename ?? `logs${projectSuffix}_${timestamp}.${format === 'json' ? 'json' : 'log'}`
  const filepath = join(exportsDir, filename)

  // Write file
  if (format === 'json') {
    writeFileSync(filepath, JSON.stringify(logs, null, 2), 'utf-8')
  } else {
    const lines = logs.map(
      (e) => `[${e.ts}] [${e.source}:${e.stream}] ${e.line}`
    )
    writeFileSync(filepath, lines.join('\n'), 'utf-8')
  }

  return filepath
}

// ============================================================================
// Buffer Management
// ============================================================================

/**
 * Clear all logs from the buffer.
 */
export function clearAllLogs(): void {
  buffer.length = 0
}

/**
 * Clear logs for a specific project.
 */
export function clearProjectLogs(projectKey: string): void {
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i].projectKey === projectKey) {
      buffer.splice(i, 1)
    }
  }
}

/**
 * Clear logs older than a specific timestamp.
 */
export function clearLogsBefore(before: string): number {
  let removed = 0
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i].ts < before) {
      buffer.splice(i, 1)
      removed++
    }
  }
  return removed
}
