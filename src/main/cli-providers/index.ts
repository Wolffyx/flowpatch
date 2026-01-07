/**
 * CLI Providers Module
 *
 * Exports the provider registry and all provider classes.
 * Handles automatic registration of built-in providers.
 *
 * Usage:
 * ```typescript
 * import { CLIProviderRegistry } from '../cli-providers'
 *
 * const { provider } = await CLIProviderRegistry.selectProvider(policy)
 * if (provider) {
 *   const result = await provider.execute({ prompt, timeoutMs, cwd, log, isCanceled })
 * }
 * ```
 */

// ============================================================================
// Re-exports
// ============================================================================

// Types
export type {
  ICLIProvider,
  CLIProviderCapabilities,
  CLIProviderMetadata,
  TokenPricing,
  CLIExecutionOptions,
  CLIExecutionResult,
  CLIProviderConstructor,
  ProviderSelectionResult,
  LimitCheckFn,
  LogFn
} from './types'

// Base class (for extending)
export { BaseCLIProvider } from './base'

// Registry
export { CLIProviderRegistry } from './registry'

// Provider classes (for direct use if needed)
export { ClaudeProvider } from './claude'
export { CodexProvider } from './codex'

// ============================================================================
// Auto-registration of built-in providers
// ============================================================================

import { CLIProviderRegistry } from './registry'
import { ClaudeProvider } from './claude'
import { CodexProvider } from './codex'

CLIProviderRegistry.register('claude', ClaudeProvider)
CLIProviderRegistry.register('codex', CodexProvider)
