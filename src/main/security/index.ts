/**
 * Security Module
 *
 * Central entry point for all security-related functionality.
 * Provides IPC origin verification, request signing, and command execution guards.
 */

import { BrowserWindow } from 'electron'
import { initializeSecurityGuard, cleanupSecurityGuard, getSessionSecretHash } from './ipc-guard'
import { logAction } from '../../shared/utils'

// Re-export all security utilities
export * from './ipc-guard'
export * from './request-signer'
export * from './command-guard'

// ============================================================================
// Module State
// ============================================================================

let isInitialized = false

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the security module.
 * Must be called once at app startup, after the main window is created.
 */
export function initializeSecurity(mainWindow: BrowserWindow): void {
  if (isInitialized) {
    logAction('security:alreadyInitialized')
    return
  }

  // Initialize the IPC guard
  initializeSecurityGuard(mainWindow)

  isInitialized = true
  logAction('security:moduleInitialized')
}

/**
 * Cleanup security module resources.
 * Call this on app shutdown.
 */
export function cleanupSecurity(): void {
  if (!isInitialized) {
    return
  }

  cleanupSecurityGuard()
  isInitialized = false
  logAction('security:moduleCleanedUp')
}

/**
 * Check if security module is initialized.
 */
export function isSecurityInitialized(): boolean {
  return isInitialized
}

/**
 * Get the security token for passing to renderers.
 * This is a derived token, not the raw session secret.
 */
export function getRendererSecurityToken(): string {
  if (!isInitialized) {
    throw new Error('Security module not initialized')
  }
  return getSessionSecretHash()
}

// ============================================================================
// Convenience Exports
// ============================================================================

// Re-export commonly used types
export type {
  SecurityContext,
  SignedRequest,
  SecurityVerificationResult,
  SecureCommandRequest,
  SecurityAuditEntry,
  SecurityConfig,
  ExecutionOrigin,
  CommandGuardConfig
} from '../../shared/types'
