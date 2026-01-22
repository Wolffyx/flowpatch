/**
 * IPC Settings Types
 *
 * Types for application settings: theme, API keys, and CLI agent checks.
 */

// ============================================================================
// Theme Settings
// ============================================================================

export interface SetThemePreferenceResult {
  success?: boolean
  error?: string
}

// ============================================================================
// API Key Management
// ============================================================================

export interface GetApiKeyPayload {
  key: string
}

export interface SetApiKeyPayload {
  key: string
  value: string
}

export interface SetApiKeyResult {
  success?: boolean
  error?: string
}

// ============================================================================
// CLI Agent Checks
// ============================================================================

/**
 * Result of checking CLI agent availability.
 */
export interface CheckCliAgentsResult {
  claude: boolean
  codex: boolean
  anyAvailable: boolean
  isFirstCheck: boolean
}
