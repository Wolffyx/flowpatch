/**
 * Provider Handoff Service
 *
 * Manages persistence of handoff context when switching between AI providers.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { HandoffContext } from '../cli-providers/session'
import { ensureRunDir, getRunDir } from './flowpatch-runs'

const HANDOFF_FILENAME = 'handoff-context.json'

/**
 * Get the path to the handoff context file for a job.
 */
export function getHandoffPath(repoRoot: string, jobId: string): string {
  return join(getRunDir(repoRoot, jobId), HANDOFF_FILENAME)
}

/**
 * Save handoff context to file.
 * Returns the path where it was saved.
 */
export function saveHandoffContext(
  repoRoot: string,
  jobId: string,
  handoff: HandoffContext
): string {
  const dir = ensureRunDir(repoRoot, jobId)
  const path = join(dir, HANDOFF_FILENAME)
  writeFileSync(path, JSON.stringify(handoff, null, 2), { encoding: 'utf-8' })
  return path
}

/**
 * Load handoff context from file.
 * Returns null if not found or invalid.
 */
export function loadHandoffContext(
  repoRoot: string,
  jobId: string
): HandoffContext | null {
  const path = getHandoffPath(repoRoot, jobId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as HandoffContext
  } catch {
    return null
  }
}

/**
 * Check if a handoff context exists for a job.
 */
export function hasHandoffContext(repoRoot: string, jobId: string): boolean {
  return existsSync(getHandoffPath(repoRoot, jobId))
}

/**
 * Delete handoff context file (called after successful completion).
 */
export function clearHandoffContext(repoRoot: string, jobId: string): boolean {
  const path = getHandoffPath(repoRoot, jobId)
  if (!existsSync(path)) return false
  try {
    const { unlinkSync } = require('fs')
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}
