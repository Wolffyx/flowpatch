/**
 * CLI Providers Module
 *
 * Exports the provider system including streaming providers, factory,
 * query service, health monitoring, metrics, and more.
 *
 * Usage:
 * ```typescript
 * import { ProviderFactory, QueryService } from '../cli-providers'
 *
 * // Get a provider
 * const provider = await ProviderFactory.getBest({ supportsThinking: true })
 *
 * // Or use the query service
 * const service = new QueryService()
 * const result = await service.query({ prompt: 'Hello', thinking: 'medium' })
 * ```
 */

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Messages
// ============================================================================

export type {
  MessageKind,
  BaseMessage,
  TextMessage,
  ToolCallMessage,
  ToolOutputMessage,
  ReasoningMessage,
  UsageMessage,
  DoneMessage,
  ProviderMessage
} from './messages'

export {
  msg,
  isTextMessage,
  isToolCallMessage,
  isToolOutputMessage,
  isReasoningMessage,
  isUsageMessage,
  isDoneMessage
} from './messages'

// ============================================================================
// Errors
// ============================================================================

export type { ErrorKind } from './errors'

export {
  ProviderError,
  classifyError,
  isRetryableError,
  isAuthError,
  isRateLimitError,
  isQuotaError,
  isContextError
} from './errors'

// ============================================================================
// Tools
// ============================================================================

export { Tools, parseShellCommand, extractFilePaths, ToolCallTracker, isValidToolName, getToolDescription } from './tools'
export type { ToolName } from './tools'

// ============================================================================
// Events
// ============================================================================

export type { EventType, ExecutionEvent, EventHandler } from './events'
export { ProviderEventBus, events } from './events'

// ============================================================================
// Detection
// ============================================================================

export type { Installation } from './detection'
export { detectCLI, detectCLIs, hasCommand } from './detection'

// ============================================================================
// Streaming Provider
// ============================================================================

export type { StreamOptions } from './streaming-provider'
export { StreamingProvider } from './streaming-provider'

// ============================================================================
// Factory
// ============================================================================

export { ProviderFactory } from './factory'

// ============================================================================
// Query Service
// ============================================================================

export type { QueryConfig, QueryResult, StreamCallbacks } from './query-service'
export { QueryService, createQueryService } from './query-service'

// ============================================================================
// Health Monitoring
// ============================================================================

export type { HealthStatus } from './health'
export { ProviderHealthMonitor, healthMonitor } from './health'

// ============================================================================
// Metrics
// ============================================================================

export type { ProviderMetrics } from './metrics'
export { ProviderMetricsCollector, metrics } from './metrics'

// ============================================================================
// Deduplication
// ============================================================================

export { RequestDeduplicator, queryDeduplicator } from './deduplication'

// ============================================================================
// Rate Limiting
// ============================================================================

export type { RateLimitConfig } from './rate-limiting'
export { ProviderRateLimiter, rateLimiter } from './rate-limiting'

// ============================================================================
// Middleware
// ============================================================================

export type { ProviderMiddleware } from './middleware'
export {
  MiddlewarePipeline,
  globalMiddleware,
  loggingMiddleware,
  metricsMiddleware,
  createRateLimitMiddleware,
  createHealthMiddleware,
  createTimingMiddleware
} from './middleware'

// ============================================================================
// Configuration
// ============================================================================

export type { ProviderConfig } from './config'
export { ProviderConfigManager, providerConfig } from './config'

// ============================================================================
// Session
// ============================================================================

export type { SessionContext, SessionStats, HandoffContext } from './session'
export { ProviderSession, sessions } from './session'

// ============================================================================
// Cache
// ============================================================================

export {
  MetadataCache,
  availabilityCache,
  environmentCache,
  versionCache,
  capabilityCache,
  invalidateProvider,
  clearAllCaches,
  getCacheStats
} from './cache'

// ============================================================================
// Provider Implementations
// ============================================================================

export { ClaudeProvider } from './claude'
export { CodexProvider } from './codex'
export { OpencodeProvider } from './opencode'

// ============================================================================
// Legacy Exports (deprecated - use ProviderFactory instead)
// ============================================================================

export { BaseCLIProvider } from './base'
export { CLIProviderRegistry } from './registry'

// ============================================================================
// Auto-registration
// ============================================================================

import { ProviderFactory } from './factory'
import { CLIProviderRegistry } from './registry'
import { ClaudeProvider } from './claude'
import { CodexProvider } from './codex'
import { OpencodeProvider } from './opencode'
import { healthMonitor } from './health'

// Create provider instances
const claude = new ClaudeProvider()
const codex = new CodexProvider()
const opencode = new OpencodeProvider()

// Register with new factory
ProviderFactory.register('claude', claude, 100)
ProviderFactory.register('codex', codex, 80)
ProviderFactory.register('opencode', opencode, 60)

// Register model routes
ProviderFactory.route('anthropic/', 'claude')
ProviderFactory.route('claude-', 'claude')
ProviderFactory.route('openai/', 'codex')
ProviderFactory.route('gpt-', 'codex')

// Register with health monitor
healthMonitor.register('claude')
healthMonitor.register('codex')
healthMonitor.register('opencode')

// Legacy registry registration (for backward compatibility)
CLIProviderRegistry.register('claude', ClaudeProvider)
CLIProviderRegistry.register('codex', CodexProvider)
CLIProviderRegistry.register('opencode', OpencodeProvider)
