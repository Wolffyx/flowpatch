/**
 * Worker Cache
 *
 * Shared caching utilities for expensive operations.
 * Reduces repeated system calls and lookups.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

interface CacheEntry<T> {
  value: T
  cachedAt: number
}

/**
 * Generic cache with TTL support.
 */
export class TTLCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private readonly ttlMs: number

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key)
      return undefined
    }

    return entry.value
  }

  set(key: string, value: T): void {
    this.cache.set(key, {
      value,
      cachedAt: Date.now()
    })
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics.
   */
  stats(): { size: number; ttlMs: number } {
    // Clean expired entries first
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > this.ttlMs) {
        this.cache.delete(key)
      }
    }
    return {
      size: this.cache.size,
      ttlMs: this.ttlMs
    }
  }
}

// ==================== Command Availability Cache ====================

/**
 * Cache for command availability checks.
 * TTL of 5 minutes - commands don't usually appear/disappear frequently.
 */
const commandCache = new TTLCache<boolean>(5 * 60 * 1000)

/**
 * Check if a command is available on the system (cached).
 * Uses cached result if available, otherwise performs the check and caches it.
 */
export async function hasCommand(cmd: string): Promise<boolean> {
  const cached = commandCache.get(cmd)
  if (cached !== undefined) {
    return cached
  }

  const available = await checkCommandUncached(cmd)
  commandCache.set(cmd, available)
  return available
}

/**
 * Check if a command is available (uncached).
 */
async function checkCommandUncached(cmd: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync('where', [cmd])
    } else {
      await execFileAsync('which', [cmd])
    }
    return true
  } catch {
    return false
  }
}

/**
 * Invalidate the command cache for a specific command.
 */
export function invalidateCommandCache(cmd: string): void {
  commandCache.delete(cmd)
}

/**
 * Clear all command cache entries.
 */
export function clearCommandCache(): void {
  commandCache.clear()
}

/**
 * Get command cache statistics.
 */
export function getCommandCacheStats(): { size: number; ttlMs: number } {
  return commandCache.stats()
}

// ==================== AI Tool Availability ====================

export interface AIToolAvailability {
  claude: boolean
  codex: boolean
  checkedAt: number
}

let aiToolsCache: AIToolAvailability | null = null
const AI_TOOLS_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Get available AI tools (cached).
 * Returns cached result if available and not expired.
 */
export async function getAvailableAITools(): Promise<AIToolAvailability> {
  if (aiToolsCache && Date.now() - aiToolsCache.checkedAt < AI_TOOLS_TTL) {
    return aiToolsCache
  }

  // Check both tools in parallel
  const [hasClaude, hasCodex] = await Promise.all([
    hasCommand('claude'),
    hasCommand('codex')
  ])

  aiToolsCache = {
    claude: hasClaude,
    codex: hasCodex,
    checkedAt: Date.now()
  }

  return aiToolsCache
}

/**
 * Invalidate the AI tools cache.
 */
export function invalidateAIToolsCache(): void {
  aiToolsCache = null
}

/**
 * Pre-warm the AI tools cache.
 * Call this at pool startup for immediate availability.
 */
export async function warmupAIToolsCache(): Promise<AIToolAvailability> {
  // Force refresh
  aiToolsCache = null
  return getAvailableAITools()
}

// ==================== Git Version Cache ====================

let gitVersionCache: { version: string; supportsWorktree: boolean; checkedAt: number } | null =
  null
const GIT_VERSION_TTL = 60 * 60 * 1000 // 1 hour

/**
 * Get git version info (cached).
 */
export async function getGitVersionInfo(): Promise<{
  version: string
  supportsWorktree: boolean
}> {
  if (gitVersionCache && Date.now() - gitVersionCache.checkedAt < GIT_VERSION_TTL) {
    return {
      version: gitVersionCache.version,
      supportsWorktree: gitVersionCache.supportsWorktree
    }
  }

  try {
    const { stdout } = await execFileAsync('git', ['--version'])
    const match = stdout.match(/git version (\d+)\.(\d+)/)
    if (match) {
      const major = parseInt(match[1], 10)
      const minor = parseInt(match[2], 10)
      // Worktrees require git 2.17+
      const supportsWorktree = major > 2 || (major === 2 && minor >= 17)

      gitVersionCache = {
        version: stdout.trim(),
        supportsWorktree,
        checkedAt: Date.now()
      }

      return { version: gitVersionCache.version, supportsWorktree }
    }
  } catch {
    // ignore
  }

  return { version: 'unknown', supportsWorktree: false }
}

/**
 * Clear all caches.
 */
export function clearAllCaches(): void {
  commandCache.clear()
  aiToolsCache = null
  gitVersionCache = null
}
