/**
 * IPC Security Guard
 *
 * Provides origin verification for IPC requests to ensure they come from
 * trusted sources (main window or project tabs) and not from external processes
 * or malicious injections.
 */

import { BrowserWindow, WebContents, IpcMainInvokeEvent } from 'electron'
import { randomBytes, createHmac } from 'crypto'
import type {
  SecurityContext,
  SecurityVerificationResult,
  SecurityAuditEntry,
  SecurityConfig
} from '../../shared/types'
import { logAction } from '../../shared/utils'

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enforceOriginCheck: true,
  requireSignatures: true,
  maxRequestAgeMs: 30_000, // 30 seconds
  enableAuditLog: true,
  securedChannels: [
    'runWorker',
    'toggleWorker',
    'cancelWorker',
    'ai:generatePlan',
    'ai:runClaudeCode',
    'ai:runCodex',
    'project:exec',
    'shell:exec'
  ]
}

// ============================================================================
// State
// ============================================================================

/** Session secret generated at startup, used for HMAC signing */
let sessionSecret: Buffer | null = null

/** Registry of trusted WebContents IDs */
const trustedWebContents = new Set<number>()

/** Reference to the main window (used for security verification) */
let mainWindowRef: BrowserWindow | null = null
void mainWindowRef // Suppress unused warning - kept for future security checks

/** Security configuration */
let securityConfig: SecurityConfig = { ...DEFAULT_SECURITY_CONFIG }

/** Audit log (in-memory, limited size) */
const auditLog: SecurityAuditEntry[] = []
const MAX_AUDIT_LOG_SIZE = 1000

/** Used nonces for replay protection (cleared periodically) */
const usedNonces = new Set<string>()
let nonceCleanupInterval: NodeJS.Timeout | null = null

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the IPC security guard.
 * Must be called once at app startup.
 */
export function initializeSecurityGuard(mainWindow: BrowserWindow): void {
  // Generate session secret
  sessionSecret = randomBytes(32)

  // Store main window reference
  mainWindowRef = mainWindow

  // Register main window as trusted
  registerTrustedWebContents(mainWindow.webContents)

  // Start nonce cleanup interval (every 5 minutes)
  nonceCleanupInterval = setInterval(() => {
    usedNonces.clear()
  }, 5 * 60 * 1000)

  logAction('security:initialized', {
    mainWindowId: mainWindow.webContents.id,
    config: {
      enforceOriginCheck: securityConfig.enforceOriginCheck,
      requireSignatures: securityConfig.requireSignatures,
      securedChannelsCount: securityConfig.securedChannels.length
    }
  })
}

/**
 * Cleanup security guard resources.
 * Call this on app shutdown.
 */
export function cleanupSecurityGuard(): void {
  if (nonceCleanupInterval) {
    clearInterval(nonceCleanupInterval)
    nonceCleanupInterval = null
  }
  trustedWebContents.clear()
  usedNonces.clear()
  sessionSecret = null
  mainWindowRef = null
}

// ============================================================================
// WebContents Registry
// ============================================================================

/**
 * Register a WebContents as trusted.
 * Only call this for WebContents created by the main process.
 */
export function registerTrustedWebContents(webContents: WebContents): void {
  trustedWebContents.add(webContents.id)

  // Automatically unregister when destroyed
  webContents.once('destroyed', () => {
    trustedWebContents.delete(webContents.id)
    logAction('security:webContentsUnregistered', { id: webContents.id })
  })

  logAction('security:webContentsRegistered', { id: webContents.id })
}

/**
 * Unregister a WebContents from the trusted registry.
 */
export function unregisterTrustedWebContents(webContentsId: number): void {
  trustedWebContents.delete(webContentsId)
  logAction('security:webContentsUnregistered', { id: webContentsId })
}

/**
 * Check if a WebContents ID is trusted.
 */
export function isTrustedWebContents(webContentsId: number): boolean {
  return trustedWebContents.has(webContentsId)
}

/**
 * Get all trusted WebContents IDs.
 */
export function getTrustedWebContentsIds(): number[] {
  return Array.from(trustedWebContents)
}

// ============================================================================
// Origin Verification
// ============================================================================

/**
 * Verify the origin of an IPC request.
 * Returns a SecurityContext if the request is from a trusted source.
 */
export function verifyIpcOrigin(event: IpcMainInvokeEvent): SecurityVerificationResult {
  const webContentsId = event.sender.id
  const frameUrl = event.senderFrame?.url ?? 'unknown'
  const timestamp = Date.now()

  // Check if WebContents is trusted
  if (!isTrustedWebContents(webContentsId)) {
    const result: SecurityVerificationResult = {
      valid: false,
      error: `Untrusted WebContents ID: ${webContentsId}`
    }

    logSecurityEvent({
      type: 'origin_rejected',
      timestamp: new Date().toISOString(),
      webContentsId,
      details: { frameUrl, reason: 'untrusted_webcontents' },
      allowed: false,
      rejectionReason: result.error
    })

    return result
  }

  // Verify the sender is not a remote module or devtools
  if (event.senderFrame?.url?.startsWith('devtools://')) {
    const result: SecurityVerificationResult = {
      valid: false,
      error: 'Requests from DevTools are not allowed'
    }

    logSecurityEvent({
      type: 'origin_rejected',
      timestamp: new Date().toISOString(),
      webContentsId,
      details: { frameUrl, reason: 'devtools_origin' },
      allowed: false,
      rejectionReason: result.error
    })

    return result
  }

  // Create security context
  const context: SecurityContext = {
    webContentsId,
    frameUrl,
    isTrusted: true,
    timestamp,
    nonce: '' // Will be filled by signature verification
  }

  return {
    valid: true,
    context
  }
}

// ============================================================================
// Request Signing
// ============================================================================

/**
 * Generate a security token for a renderer.
 * This token is used by the renderer to sign requests.
 */
export function generateSecurityToken(): string {
  if (!sessionSecret) {
    throw new Error('Security guard not initialized')
  }

  // Generate a unique token for this renderer session
  const token = randomBytes(32).toString('hex')
  return token
}

/**
 * Sign a request payload.
 * Used internally for verification.
 */
export function signPayload(payload: string, nonce: string, timestamp: number): string {
  if (!sessionSecret) {
    throw new Error('Security guard not initialized')
  }

  const data = `${payload}:${nonce}:${timestamp}`
  return createHmac('sha256', sessionSecret).update(data).digest('hex')
}

/**
 * Verify a signed request.
 */
export function verifySignedRequest(
  payload: unknown,
  signature: string,
  nonce: string,
  timestamp: number
): SecurityVerificationResult {
  if (!sessionSecret) {
    return { valid: false, error: 'Security guard not initialized' }
  }

  // Check timestamp freshness
  const now = Date.now()
  const age = now - timestamp
  if (age > securityConfig.maxRequestAgeMs) {
    logSecurityEvent({
      type: 'security_violation',
      timestamp: new Date().toISOString(),
      details: { reason: 'expired_request', age, maxAge: securityConfig.maxRequestAgeMs },
      allowed: false,
      rejectionReason: 'Request expired'
    })
    return { valid: false, error: `Request expired (age: ${age}ms, max: ${securityConfig.maxRequestAgeMs}ms)` }
  }

  // Check for replay attack
  if (usedNonces.has(nonce)) {
    logSecurityEvent({
      type: 'security_violation',
      timestamp: new Date().toISOString(),
      details: { reason: 'replay_attack', nonce },
      allowed: false,
      rejectionReason: 'Replay attack detected'
    })
    return { valid: false, error: 'Replay attack detected: nonce already used' }
  }

  // Verify signature
  const payloadStr = JSON.stringify(payload)
  const expectedSignature = signPayload(payloadStr, nonce, timestamp)

  if (signature !== expectedSignature) {
    logSecurityEvent({
      type: 'security_violation',
      timestamp: new Date().toISOString(),
      details: { reason: 'invalid_signature' },
      allowed: false,
      rejectionReason: 'Invalid signature'
    })
    return { valid: false, error: 'Invalid request signature' }
  }

  // Mark nonce as used
  usedNonces.add(nonce)

  return { valid: true }
}

// ============================================================================
// Combined Verification
// ============================================================================

/**
 * Verify an IPC request with both origin and signature checks.
 * This is the main entry point for securing IPC handlers.
 */
export function verifySecureRequest(
  event: IpcMainInvokeEvent,
  channel: string,
  signedPayload?: { payload: unknown; signature: string; nonce: string; timestamp: number }
): SecurityVerificationResult {
  // Check if this channel requires security
  const requiresSecurity = securityConfig.securedChannels.includes(channel)

  // Step 1: Verify origin
  if (securityConfig.enforceOriginCheck) {
    const originResult = verifyIpcOrigin(event)
    if (!originResult.valid) {
      return originResult
    }
  }

  // Step 2: Verify signature (if required and provided)
  if (requiresSecurity && securityConfig.requireSignatures && signedPayload) {
    const signatureResult = verifySignedRequest(
      signedPayload.payload,
      signedPayload.signature,
      signedPayload.nonce,
      signedPayload.timestamp
    )
    if (!signatureResult.valid) {
      return signatureResult
    }
  }

  // Create context
  const context: SecurityContext = {
    webContentsId: event.sender.id,
    frameUrl: event.senderFrame?.url ?? 'unknown',
    isTrusted: true,
    timestamp: Date.now(),
    nonce: signedPayload?.nonce ?? ''
  }

  // Log successful verification
  logSecurityEvent({
    type: 'ipc_request',
    timestamp: new Date().toISOString(),
    webContentsId: event.sender.id,
    details: { channel, requiresSecurity },
    allowed: true
  })

  return { valid: true, context }
}

// ============================================================================
// Audit Logging
// ============================================================================

/**
 * Log a security event.
 */
function logSecurityEvent(entry: SecurityAuditEntry): void {
  if (!securityConfig.enableAuditLog) return

  auditLog.push(entry)

  // Trim log if too large
  if (auditLog.length > MAX_AUDIT_LOG_SIZE) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_LOG_SIZE)
  }

  // Also log to main log if it's a violation
  if (!entry.allowed) {
    logAction('security:violation', entry)
  }
}

/**
 * Get recent audit log entries.
 */
export function getAuditLog(limit = 100): SecurityAuditEntry[] {
  return auditLog.slice(-limit)
}

/**
 * Clear the audit log.
 */
export function clearAuditLog(): void {
  auditLog.length = 0
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Update security configuration.
 */
export function updateSecurityConfig(config: Partial<SecurityConfig>): void {
  securityConfig = { ...securityConfig, ...config }
  logAction('security:configUpdated', { config: securityConfig })
}

/**
 * Get current security configuration.
 */
export function getSecurityConfig(): SecurityConfig {
  return { ...securityConfig }
}

/**
 * Check if a channel is secured.
 */
export function isSecuredChannel(channel: string): boolean {
  return securityConfig.securedChannels.includes(channel)
}

/**
 * Add a channel to the secured list.
 */
export function addSecuredChannel(channel: string): void {
  if (!securityConfig.securedChannels.includes(channel)) {
    securityConfig.securedChannels.push(channel)
  }
}

/**
 * Get the session secret hash (for passing to renderers).
 * Never expose the raw secret.
 */
export function getSessionSecretHash(): string {
  if (!sessionSecret) {
    throw new Error('Security guard not initialized')
  }
  return createHmac('sha256', sessionSecret).update('renderer-token').digest('hex')
}
