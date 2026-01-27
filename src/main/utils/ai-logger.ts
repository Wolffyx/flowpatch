/**
 * AI Debug Logger
 *
 * Writes AI-related logs to disk when the `logs.aiDebugEnabled` flag is on.
 * Uses JSONL for easy post-processing and keeps a small rotated history to
 * avoid unbounded growth.
 */

import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { getResolvedBool } from '../settingsStore'

type AiDebugLogEntry = {
  ts: string
  message: string
  source?: string
  stream?: 'stdout' | 'stderr' | 'info' | 'error' | 'warn'
  projectId?: string
  jobId?: string | null
  cardId?: string
  phase?: string
}

const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5MB soft cap per file
const MAX_ROTATIONS = 2

function getLogDir(): string {
  const dir = join(app.getPath('userData'), 'logs', 'ai')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getLogPath(projectId?: string): string {
  const safeId = projectId?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'global'
  return join(getLogDir(), `${safeId}.log`)
}

function rotateIfNeeded(filepath: string): void {
  if (!existsSync(filepath)) return
  const size = statSync(filepath).size
  if (size < MAX_FILE_BYTES) return

  // Shift existing rotations
  for (let i = MAX_ROTATIONS; i >= 1; i--) {
    const rotated = `${filepath}.${i}`
    const prev = i === 1 ? filepath : `${filepath}.${i - 1}`
    if (existsSync(prev)) {
      try {
        renameSync(prev, rotated)
      } catch {
        // ignore rotation failures; better to keep logging
      }
    }
  }
}

function shouldLogAiDebug(projectKey: string | null): boolean {
  const envOverride = process.env.FLOWPATCH_AI_DEBUG_LOG?.toLowerCase()
  if (envOverride === '1' || envOverride === 'true') return true
  if (envOverride === '0' || envOverride === 'false') return false
  return getResolvedBool(projectKey, 'logs.aiDebugEnabled')
}

/**
 * Append an AI debug log entry when enabled.
 */
export function logAiDebug(
  entry: Omit<AiDebugLogEntry, 'ts'> & { projectKey?: string | null }
): void {
  if (!shouldLogAiDebug(entry.projectKey ?? null)) return

  const payload: AiDebugLogEntry = {
    ts: new Date().toISOString(),
    ...entry
  }

  const filepath = getLogPath(entry.projectId)
  rotateIfNeeded(filepath)

  try {
    appendFileSync(filepath, JSON.stringify(payload) + '\n', 'utf-8')
  } catch {
    // Swallow disk write errors to avoid impacting the pipeline
  }
}

/**
 * Exposed for tests: evaluate default enablement.
 */
export function computeAiDebugDefault(isPackaged: boolean): boolean {
  return isPackaged ? false : true
}
