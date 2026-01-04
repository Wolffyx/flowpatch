/**
 * Request Signer
 *
 * Provides cryptographic signing utilities for IPC requests.
 * Used in preload scripts to sign requests before sending to main process.
 */

import { createHmac, randomBytes } from 'crypto'
import type { SignedRequest } from '../../shared/types'

// ============================================================================
// Nonce Generation
// ============================================================================

/**
 * Generate a cryptographically secure nonce.
 */
export function generateNonce(): string {
  return randomBytes(16).toString('hex')
}

// ============================================================================
// Signing (Main Process)
// ============================================================================

/**
 * Sign a payload with the session secret.
 * Only used in the main process.
 */
export function signWithSecret(
  payload: unknown,
  secret: Buffer,
  nonce: string,
  timestamp: number
): string {
  const payloadStr = JSON.stringify(payload)
  const data = `${payloadStr}:${nonce}:${timestamp}`
  return createHmac('sha256', secret).update(data).digest('hex')
}

/**
 * Verify a signature against a payload.
 * Only used in the main process.
 */
export function verifySignature(
  payload: unknown,
  signature: string,
  secret: Buffer,
  nonce: string,
  timestamp: number
): boolean {
  const expectedSignature = signWithSecret(payload, secret, nonce, timestamp)
  
  // Use timing-safe comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false
  }
  
  let result = 0
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i)
  }
  
  return result === 0
}

// ============================================================================
// Signing (Preload Script)
// ============================================================================

/**
 * Create a signed request wrapper.
 * This is called from preload scripts using the derived token.
 */
export function createSignedRequest<T>(
  payload: T,
  token: string
): SignedRequest<T> {
  const nonce = generateNonce()
  const timestamp = Date.now()
  
  // Sign with the derived token
  const payloadStr = JSON.stringify(payload)
  const data = `${payloadStr}:${nonce}:${timestamp}`
  const signature = createHmac('sha256', token).update(data).digest('hex')
  
  return {
    payload,
    signature,
    nonce,
    timestamp
  }
}

/**
 * Unwrap a signed request, extracting the payload.
 * Does not verify - use verifySignature for that.
 */
export function unwrapSignedRequest<T>(signedRequest: SignedRequest<T>): T {
  return signedRequest.payload
}

// ============================================================================
// Token Derivation
// ============================================================================

/**
 * Derive a renderer-specific token from the session secret.
 * This allows each renderer to have a unique signing key.
 */
export function deriveRendererToken(sessionSecret: Buffer, webContentsId: number): string {
  const data = `renderer:${webContentsId}`
  return createHmac('sha256', sessionSecret).update(data).digest('hex')
}

/**
 * Derive a global token for all renderers (simpler approach).
 * Used when we don't need per-renderer isolation.
 */
export function deriveGlobalToken(sessionSecret: Buffer): string {
  return createHmac('sha256', sessionSecret).update('global-renderer-token').digest('hex')
}

// ============================================================================
// Request Wrapper Utilities
// ============================================================================

/**
 * Check if an object looks like a signed request.
 */
export function isSignedRequest(obj: unknown): obj is SignedRequest<unknown> {
  if (!obj || typeof obj !== 'object') return false
  
  const req = obj as Record<string, unknown>
  return (
    'payload' in req &&
    'signature' in req &&
    'nonce' in req &&
    'timestamp' in req &&
    typeof req.signature === 'string' &&
    typeof req.nonce === 'string' &&
    typeof req.timestamp === 'number'
  )
}

/**
 * Extract and verify a signed request from IPC payload.
 * Returns the payload if valid, throws if invalid.
 */
export function extractSignedPayload<T>(
  ipcPayload: unknown,
  secret: Buffer,
  maxAgeMs: number = 30_000
): T {
  if (!isSignedRequest(ipcPayload)) {
    throw new Error('Invalid signed request format')
  }
  
  const { payload, signature, nonce, timestamp } = ipcPayload as SignedRequest<T>
  
  // Check timestamp freshness
  const age = Date.now() - timestamp
  if (age > maxAgeMs) {
    throw new Error(`Request expired (age: ${age}ms, max: ${maxAgeMs}ms)`)
  }
  
  // Verify signature
  if (!verifySignature(payload, signature, secret, nonce, timestamp)) {
    throw new Error('Invalid request signature')
  }
  
  return payload
}
