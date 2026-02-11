/**
 * Provider Availability Interface
 *
 * Types for AI CLI provider availability checking.
 */

export interface ProviderAvailabilityInfo {
  /** Provider key (e.g., 'claude', 'codex', 'opencode') */
  key: string

  /** Display name for UI */
  displayName: string

  /** CLI command to check/install */
  command: string

  /** Documentation URL for installation instructions */
  documentationUrl?: string

  /** Whether the provider CLI is currently available on the system */
  available: boolean
}
