/**
 * CLI Provider Types
 *
 * All interface definitions for the CLI provider system.
 */

import type { ThinkingMode, AIToolType } from '../../shared/types'

// ============================================================================
// Logging
// ============================================================================

export type LogFn = (message: string, meta?: { stream?: 'stdout' | 'stderr' }) => void

// ============================================================================
// Provider Capabilities
// ============================================================================

/**
 * Declares what capabilities a CLI provider supports.
 * Used for provider selection and feature gating.
 */
export interface CLIProviderCapabilities {
  /** Whether the provider supports extended thinking mode */
  supportsThinking: boolean

  /** Supported thinking modes (if supportsThinking is true) */
  supportedThinkingModes?: ThinkingMode[]

  /** Whether the provider accepts input via stdin */
  supportsStdin: boolean

  /** Whether the provider accepts input via file path argument */
  supportsFileInput: boolean

  /** Whether the provider supports streaming output */
  supportsStreaming: boolean

  /** Whether the provider can run in auto-approve/non-interactive mode */
  supportsAutoApprove: boolean

  /** Required environment variables */
  requiredEnvVars?: string[]

  /** Optional environment variables that enhance functionality */
  optionalEnvVars?: string[]

  /** Maximum timeout supported (0 = unlimited) */
  maxTimeoutMs: number

  /** Provider-specific feature flags */
  features?: Record<string, boolean>
}

// ============================================================================
// Pricing
// ============================================================================

/**
 * Pricing configuration per 1M tokens.
 */
export interface TokenPricing {
  /** Cost per 1M input tokens in USD */
  inputPerMillion: number

  /** Cost per 1M output tokens in USD */
  outputPerMillion: number

  /** Cost per 1M thinking tokens (if different from output) */
  thinkingPerMillion?: number
}

// ============================================================================
// Execution
// ============================================================================

/**
 * Options passed to the provider's execute method.
 */
export interface CLIExecutionOptions {
  /** The prompt/instruction to send to the CLI */
  prompt: string

  /** Timeout in milliseconds */
  timeoutMs: number

  /** Working directory for execution */
  cwd: string

  /** Logging function for streaming output */
  log: LogFn

  /** Function to check if execution should be canceled */
  isCanceled: () => boolean

  /** Thinking mode configuration (if supported) */
  thinkingMode?: ThinkingMode

  /** Custom thinking budget tokens */
  thinkingBudget?: number

  /** Additional provider-specific options */
  providerOptions?: Record<string, unknown>

  /** Environment variables to pass to the process */
  env?: NodeJS.ProcessEnv
}

/**
 * Result from CLI execution with usage metrics.
 */
export interface CLIExecutionResult {
  /** Whether execution succeeded */
  success: boolean

  /** Estimated input tokens consumed */
  inputTokens: number

  /** Estimated output tokens generated */
  outputTokens: number

  /** Thinking tokens consumed (if applicable) */
  thinkingTokens?: number

  /** Execution duration in milliseconds */
  durationMs: number

  /** Raw output length for estimation */
  outputLength: number

  /** Error message if execution failed */
  error?: string

  /** Exit code from the process */
  exitCode?: number
}

// ============================================================================
// Provider Metadata
// ============================================================================

/**
 * Provider metadata for registry and UI.
 */
export interface CLIProviderMetadata {
  /** Unique provider key (e.g., 'claude', 'codex', 'opencode') */
  key: string

  /** Display name for UI */
  displayName: string

  /** Short description */
  description: string

  /** CLI command name to check availability */
  command: string

  /** Tool type for usage tracking */
  toolType: AIToolType

  /** Default model name for usage records */
  defaultModel: string

  /** Provider homepage/documentation URL */
  documentationUrl?: string
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Main interface that all CLI providers must implement.
 */
export interface ICLIProvider {
  // Metadata & Capabilities (readonly)
  readonly metadata: CLIProviderMetadata
  readonly capabilities: CLIProviderCapabilities
  readonly pricing: TokenPricing

  // Availability
  isAvailable(): Promise<boolean>
  checkEnvironment(): Promise<{ configured: boolean; missing: string[] }>

  // Execution
  execute(options: CLIExecutionOptions): Promise<CLIExecutionResult>
  buildArgs(options: CLIExecutionOptions): string[]

  // Token Estimation & Cost
  estimateTokens(text: string): number
  calculateCost(inputTokens: number, outputTokens: number, thinkingTokens?: number): number

  // Error Handling
  isRetryableLimitError(error: unknown): boolean
  parseError(output: string, exitCode?: number): { message: string; isRetryable: boolean }
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Constructor signature for provider classes.
 */
export type CLIProviderConstructor = new () => ICLIProvider

/**
 * Result from provider selection.
 */
export interface ProviderSelectionResult {
  /** Selected provider (null if none available) */
  provider: ICLIProvider | null

  /** Whether a fallback provider was used */
  fallbackUsed: boolean

  /** Reason for selection or failure */
  reason?: string
}

/**
 * Limit check function signature.
 */
export type LimitCheckFn = (toolType: AIToolType) => { exceeded: boolean; reason?: string }
