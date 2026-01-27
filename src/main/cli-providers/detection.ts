/**
 * CLI Detection
 *
 * Multi-strategy CLI detection for finding installed providers.
 */

import { exec as execCb } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'

const exec = promisify(execCb)

// ============================================================================
// Types
// ============================================================================

export interface Installation {
  found: boolean
  path?: string
  version?: string
  via: 'path' | 'directory' | 'wsl' | 'npx' | 'none'
}

// ============================================================================
// Detection Strategies
// ============================================================================

/**
 * Check if command is available in PATH.
 */
async function checkPath(command: string): Promise<Installation | null> {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await exec(`${which} ${command}`, { timeout: 5000 })
    const path = stdout.trim().split('\n')[0]

    if (path) {
      const version = await getVersion(command)
      return { found: true, path, version, via: 'path' }
    }
  } catch {
    // Not found in PATH
  }
  return null
}

/**
 * Check common installation directories (Windows).
 */
async function checkDirectories(command: string): Promise<Installation | null> {
  if (process.platform !== 'win32') return null

  const dirs = [
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.local', 'bin') : null,
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ].filter(Boolean) as string[]

  for (const dir of dirs) {
    // Check direct path
    const exe = join(dir, command, `${command}.exe`)
    if (existsSync(exe)) {
      const version = await getVersion(exe)
      return { found: true, path: exe, version, via: 'directory' }
    }

    // Check Programs subfolder
    const programsExe = join(dir, 'Programs', command, `${command}.exe`)
    if (existsSync(programsExe)) {
      const version = await getVersion(programsExe)
      return { found: true, path: programsExe, version, via: 'directory' }
    }
  }

  return null
}

/**
 * Check for command availability through WSL.
 */
async function checkWSL(command: string): Promise<Installation | null> {
  if (process.platform !== 'win32') return null

  try {
    const { stdout } = await exec(`wsl which ${command}`, { timeout: 10000 })
    if (stdout.trim()) {
      return { found: true, path: stdout.trim(), via: 'wsl' }
    }
  } catch {
    // WSL not available or command not found
  }
  return null
}

/**
 * Check if command is available via npx.
 */
async function checkNPX(command: string): Promise<Installation | null> {
  try {
    // Use npx with --yes to auto-install if needed
    const { stdout } = await exec(`npx --yes ${command} --version`, { timeout: 30000 })
    if (stdout.trim()) {
      return { found: true, version: stdout.trim(), via: 'npx' }
    }
  } catch {
    // NPX execution failed
  }
  return null
}

/**
 * Get version string from a command.
 */
async function getVersion(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec(`"${command}" --version`, { timeout: 5000 })
    // Take first line, often contains version
    return stdout.trim().split('\n')[0]
  } catch {
    return undefined
  }
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Detect CLI installation using multiple strategies.
 * Tries strategies in order until one succeeds.
 */
export async function detectCLI(command: string): Promise<Installation> {
  // Order matters: prefer PATH, then directories, then WSL, then NPX
  const strategies = [checkPath, checkDirectories, checkWSL, checkNPX]

  for (const strategy of strategies) {
    try {
      const result = await strategy(command)
      if (result?.found) {
        return result
      }
    } catch {
      // Strategy failed, try next
    }
  }

  return { found: false, via: 'none' }
}

/**
 * Detect multiple CLIs in parallel.
 */
export async function detectCLIs(commands: string[]): Promise<Record<string, Installation>> {
  const results = await Promise.all(commands.map((cmd) => detectCLI(cmd).then((r) => [cmd, r] as const)))

  return Object.fromEntries(results)
}

/**
 * Quick check if a command exists (cached check preferred).
 */
export async function hasCommand(command: string): Promise<boolean> {
  const result = await detectCLI(command)
  return result.found
}
