/**
 * Command Guard
 *
 * Enforces command execution policies to prevent unauthorized or dangerous
 * commands from being executed. This is the last line of defense against
 * prompt injection attacks.
 */

import { resolve, normalize, relative, isAbsolute } from 'path'
import type {
  SecurityContext,
  SecureCommandRequest,
  CommandGuardConfig,
  ExecutionOrigin,
  SecurityAuditEntry
} from '../../shared/types'
import { logAction } from '../../shared/utils'

// ============================================================================
// Configuration
// ============================================================================

/** Default allowed commands if none specified in policy */
const DEFAULT_ALLOWED_COMMANDS = [
  'git',
  'npm',
  'pnpm',
  'yarn',
  'node',
  'npx',
  'tsc',
  'eslint',
  'prettier'
]

/** Commands that are always blocked regardless of policy */
const BLOCKED_COMMANDS = [
  'rm',
  'rmdir',
  'del',
  'format',
  'fdisk',
  'dd',
  'mkfs',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init',
  'systemctl',
  'service',
  'passwd',
  'useradd',
  'userdel',
  'chmod',
  'chown',
  'sudo',
  'su',
  'runas',
  'reg',
  'regedit',
  'powershell',
  'cmd',
  'bash',
  'sh',
  'zsh',
  'fish',
  'curl',
  'wget',
  'nc',
  'netcat',
  'ssh',
  'scp',
  'ftp',
  'telnet'
]

/** Dangerous argument patterns */
const DANGEROUS_PATTERNS = [
  /--exec/i,
  /-e\s+.*rm/i,
  /\|\s*sh/i,
  /\|\s*bash/i,
  /\$\(/,  // Command substitution
  /`/,      // Backtick command substitution
  />\s*\//, // Redirect to root
  /;\s*rm/i,
  /&&\s*rm/i,
  /\|\|\s*rm/i
]

// ============================================================================
// State
// ============================================================================

/** Audit log for command execution attempts */
const commandAuditLog: SecurityAuditEntry[] = []
const MAX_COMMAND_AUDIT_LOG = 500

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a command is in the blocked list.
 */
export function isBlockedCommand(command: string): boolean {
  const baseCommand = command.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const commandWithoutExt = baseCommand.replace(/\.(exe|cmd|bat|sh|ps1)$/i, '')
  
  return BLOCKED_COMMANDS.some(blocked => 
    blocked === commandWithoutExt || blocked === baseCommand
  )
}

/**
 * Check if a command is in the allowed list.
 */
export function isAllowedCommand(command: string, allowedCommands: string[]): boolean {
  if (allowedCommands.length === 0) {
    // If no allowlist specified, use defaults
    allowedCommands = DEFAULT_ALLOWED_COMMANDS
  }
  
  const baseCommand = command.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const commandWithoutExt = baseCommand.replace(/\.(exe|cmd|bat|sh|ps1)$/i, '')
  
  return allowedCommands.some(allowed => {
    const allowedBase = allowed.split(/[\\/]/).pop()?.toLowerCase() ?? ''
    const allowedWithoutExt = allowedBase.replace(/\.(exe|cmd|bat|sh|ps1)$/i, '')
    
    // Check full command string match
    if (allowed.toLowerCase() === command.toLowerCase()) return true
    
    // Check base command match
    if (allowedWithoutExt === commandWithoutExt) return true
    if (allowedBase === baseCommand) return true
    
    // Check if the allowed entry is a full command line (e.g., "pnpm install")
    if (allowed.startsWith(commandWithoutExt + ' ')) return true
    
    return false
  })
}

/**
 * Check if command arguments contain dangerous patterns.
 */
export function hasDangerousPatterns(args: string[]): { dangerous: boolean; pattern?: string } {
  const fullCommand = args.join(' ')
  
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(fullCommand)) {
      return { dangerous: true, pattern: pattern.toString() }
    }
  }
  
  return { dangerous: false }
}

/**
 * Check if a path violates forbidden path restrictions.
 */
export function violatesForbiddenPaths(
  targetPath: string,
  forbiddenPaths: string[],
  workingDir: string
): { violates: boolean; forbiddenPath?: string } {
  // Normalize the target path
  const absoluteTarget = isAbsolute(targetPath) 
    ? normalize(targetPath)
    : normalize(resolve(workingDir, targetPath))
  
  for (const forbidden of forbiddenPaths) {
    // Normalize the forbidden path
    const absoluteForbidden = isAbsolute(forbidden)
      ? normalize(forbidden)
      : normalize(resolve(workingDir, forbidden))
    
    // Check if target is inside forbidden path
    const rel = relative(absoluteForbidden, absoluteTarget)
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      return { violates: true, forbiddenPath: forbidden }
    }
    
    // Also check the reverse (forbidden inside target - shouldn't allow deleting parent of forbidden)
    const revRel = relative(absoluteTarget, absoluteForbidden)
    if (!revRel.startsWith('..') && !isAbsolute(revRel)) {
      return { violates: true, forbiddenPath: forbidden }
    }
  }
  
  return { violates: false }
}

/**
 * Extract paths from command arguments for validation.
 */
export function extractPathsFromArgs(args: string[]): string[] {
  const paths: string[] = []
  
  for (const arg of args) {
    // Skip flags
    if (arg.startsWith('-')) continue
    
    // Check if it looks like a path
    if (arg.includes('/') || arg.includes('\\') || arg.includes('.')) {
      paths.push(arg)
    }
  }
  
  return paths
}

// ============================================================================
// Guard Functions
// ============================================================================

export interface CommandValidationResult {
  allowed: boolean
  reason?: string
  secureRequest?: SecureCommandRequest
}

/**
 * Validate a command execution request.
 * This is the main entry point for command validation.
 */
export function validateCommand(
  command: string,
  args: string[],
  cwd: string,
  config: CommandGuardConfig,
  origin: ExecutionOrigin,
  securityContext?: SecurityContext
): CommandValidationResult {
  const timestamp = new Date().toISOString()
  
  // Check execution origin
  if (origin === 'external' || origin === 'ai_output') {
    logCommandAttempt({
      type: 'command_execution',
      timestamp,
      details: { command, args, origin, reason: 'untrusted_origin' },
      allowed: false,
      rejectionReason: `Untrusted execution origin: ${origin}`
    })
    
    return {
      allowed: false,
      reason: `Command execution blocked: untrusted origin (${origin})`
    }
  }
  
  // Check blocked commands
  if (isBlockedCommand(command)) {
    logCommandAttempt({
      type: 'command_execution',
      timestamp,
      details: { command, args, reason: 'blocked_command' },
      allowed: false,
      rejectionReason: 'Command is in the blocked list'
    })
    
    return {
      allowed: false,
      reason: `Command blocked: ${command} is not allowed for security reasons`
    }
  }
  
  // Check allowed commands (if enforcing allowlist)
  if (config.allowedCommands.length > 0) {
    if (!isAllowedCommand(command, config.allowedCommands)) {
      logCommandAttempt({
        type: 'command_execution',
        timestamp,
        details: { command, args, allowedCommands: config.allowedCommands, reason: 'not_in_allowlist' },
        allowed: false,
        rejectionReason: 'Command not in allowlist'
      })
      
      return {
        allowed: false,
        reason: `Command not allowed: ${command}. Allowed commands: ${config.allowedCommands.join(', ')}`
      }
    }
  }
  
  // Check for dangerous patterns in arguments
  const dangerCheck = hasDangerousPatterns([command, ...args])
  if (dangerCheck.dangerous) {
    logCommandAttempt({
      type: 'command_execution',
      timestamp,
      details: { command, args, pattern: dangerCheck.pattern, reason: 'dangerous_pattern' },
      allowed: false,
      rejectionReason: `Dangerous pattern detected: ${dangerCheck.pattern}`
    })
    
    return {
      allowed: false,
      reason: `Dangerous command pattern detected: ${dangerCheck.pattern}`
    }
  }
  
  // Check forbidden paths
  if (config.forbiddenPaths.length > 0) {
    const paths = extractPathsFromArgs(args)
    for (const path of paths) {
      const pathCheck = violatesForbiddenPaths(path, config.forbiddenPaths, cwd)
      if (pathCheck.violates) {
        logCommandAttempt({
          type: 'command_execution',
          timestamp,
          details: { command, args, path, forbiddenPath: pathCheck.forbiddenPath, reason: 'forbidden_path' },
          allowed: false,
          rejectionReason: `Path ${path} is forbidden`
        })
        
        return {
          allowed: false,
          reason: `Path access denied: ${pathCheck.forbiddenPath} is protected`
        }
      }
    }
  }
  
  // Command is allowed
  const secureRequest: SecureCommandRequest = {
    command,
    args,
    cwd,
    securityContext: securityContext ?? {
      webContentsId: -1,
      frameUrl: 'internal',
      isTrusted: origin === 'worker_pipeline' || origin === 'user_action',
      timestamp: Date.now(),
      nonce: ''
    },
    policyApproved: true
  }
  
  logCommandAttempt({
    type: 'command_execution',
    timestamp,
    details: { command, args, origin },
    allowed: true
  })
  
  return {
    allowed: true,
    secureRequest
  }
}

/**
 * Create a command guard config from a policy.
 */
export function createCommandGuardConfig(policy: {
  allowedCommands?: string[]
  forbidPaths?: string[]
  allowNetwork?: boolean
  maxMinutes?: number
}): CommandGuardConfig {
  return {
    allowedCommands: policy.allowedCommands ?? [],
    forbiddenPaths: policy.forbidPaths ?? [],
    allowNetwork: policy.allowNetwork ?? false,
    maxMinutes: policy.maxMinutes ?? 25
  }
}

// ============================================================================
// Audit Logging
// ============================================================================

/**
 * Log a command execution attempt.
 */
function logCommandAttempt(entry: SecurityAuditEntry): void {
  commandAuditLog.push(entry)
  
  // Trim log if too large
  if (commandAuditLog.length > MAX_COMMAND_AUDIT_LOG) {
    commandAuditLog.splice(0, commandAuditLog.length - MAX_COMMAND_AUDIT_LOG)
  }
  
  // Log to main logger
  if (!entry.allowed) {
    logAction('security:commandBlocked', entry)
  }
}

/**
 * Get command audit log.
 */
export function getCommandAuditLog(limit = 100): SecurityAuditEntry[] {
  return commandAuditLog.slice(-limit)
}

/**
 * Clear command audit log.
 */
export function clearCommandAuditLog(): void {
  commandAuditLog.length = 0
}

// ============================================================================
// Quick Validation Helpers
// ============================================================================

/**
 * Quick check if a command line is safe to execute.
 * Returns false if any obvious dangerous patterns are detected.
 */
export function isCommandLineSafe(commandLine: string): boolean {
  // Split command line
  const parts = commandLine.split(/\s+/)
  const command = parts[0]
  const args = parts.slice(1)
  
  // Check blocked commands
  if (isBlockedCommand(command)) return false
  
  // Check dangerous patterns
  if (hasDangerousPatterns([command, ...args]).dangerous) return false
  
  return true
}

/**
 * Sanitize a command string to remove potentially dangerous elements.
 * Returns null if the command cannot be safely sanitized.
 */
export function sanitizeCommand(commandLine: string): string | null {
  // Check if fundamentally unsafe
  if (!isCommandLineSafe(commandLine)) return null
  
  // Remove shell operators
  let sanitized = commandLine
    .replace(/[;&|`$()]/g, '')  // Remove shell operators
    .replace(/\s+/g, ' ')       // Normalize whitespace
    .trim()
  
  // Validate result
  if (!isCommandLineSafe(sanitized)) return null
  
  return sanitized
}
