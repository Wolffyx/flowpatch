/**
 * Provider Configuration
 *
 * Per-provider configuration with validation.
 */

import type { ThinkingMode } from '../../shared/types'

// ============================================================================
// Types
// ============================================================================

export interface ProviderConfig {
  /** Provider key */
  provider: string

  /** Whether provider is enabled */
  enabled: boolean

  /** Thinking configuration */
  thinking?: {
    mode: ThinkingMode
    budget: number
  }

  /** Execution timeout in ms */
  timeoutMs: number

  /** Maximum cost per execution in USD */
  maxCostUsd?: number

  /** Retry policy */
  retry: {
    maxAttempts: number
    baseDelayMs: number
    maxDelayMs: number
  }

  /** Rate limit overrides */
  rateLimit?: {
    maxConcurrent: number
    requestsPerSecond: number
  }

  /** Priority (higher = preferred) */
  priority: number
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Omit<ProviderConfig, 'provider'> = {
  enabled: true,
  timeoutMs: 300000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000
  },
  priority: 50
}

// ============================================================================
// Provider Config Manager
// ============================================================================

/**
 * Manages per-provider configuration.
 */
export class ProviderConfigManager {
  private configs = new Map<string, ProviderConfig>()

  /**
   * Set configuration for a provider.
   */
  set(provider: string, config: Partial<ProviderConfig>): void {
    const existing = this.configs.get(provider)
    this.configs.set(provider, {
      provider,
      ...DEFAULT_CONFIG,
      ...existing,
      ...config,
      retry: {
        ...DEFAULT_CONFIG.retry,
        ...existing?.retry,
        ...config.retry
      }
    })
  }

  /**
   * Get configuration for a provider.
   */
  get(provider: string): ProviderConfig {
    return this.configs.get(provider) ?? { provider, ...DEFAULT_CONFIG }
  }

  /**
   * Check if a provider is enabled.
   */
  isEnabled(provider: string): boolean {
    return this.get(provider).enabled
  }

  /**
   * Get providers sorted by priority.
   */
  getByPriority(): ProviderConfig[] {
    return Array.from(this.configs.values())
      .filter((c) => c.enabled)
      .sort((a, b) => b.priority - a.priority)
  }

  /**
   * Validate configuration against provider capabilities.
   */
  validate(
    provider: string,
    capabilities: { supportsThinking?: boolean; maxTimeoutMs?: number }
  ): string[] {
    const config = this.get(provider)
    const errors: string[] = []

    if (config.thinking && !capabilities.supportsThinking) {
      errors.push(`Provider ${provider} does not support thinking mode`)
    }

    if (capabilities.maxTimeoutMs && config.timeoutMs > capabilities.maxTimeoutMs) {
      errors.push(`Timeout ${config.timeoutMs}ms exceeds provider max ${capabilities.maxTimeoutMs}ms`)
    }

    if (config.retry.maxAttempts < 1) {
      errors.push('Retry maxAttempts must be at least 1')
    }

    if (config.retry.baseDelayMs < 0) {
      errors.push('Retry baseDelayMs must be non-negative')
    }

    return errors
  }

  /**
   * Load configuration from object.
   */
  load(configs: Record<string, Partial<ProviderConfig>>): void {
    for (const [provider, config] of Object.entries(configs)) {
      this.set(provider, config)
    }
  }

  /**
   * Export all configurations.
   */
  export(): Record<string, ProviderConfig> {
    const result: Record<string, ProviderConfig> = {}
    for (const [key, config] of this.configs) {
      result[key] = config
    }
    return result
  }

  /**
   * Check if configuration exists.
   */
  has(provider: string): boolean {
    return this.configs.has(provider)
  }

  /**
   * Remove configuration.
   */
  remove(provider: string): boolean {
    return this.configs.delete(provider)
  }

  /**
   * Clear all configurations.
   */
  clear(): void {
    this.configs.clear()
  }

  /**
   * Get configuration count.
   */
  get count(): number {
    return this.configs.size
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global provider configuration manager instance.
 */
export const providerConfig = new ProviderConfigManager()

// Initialize with defaults
providerConfig.set('claude', { priority: 100, thinking: { mode: 'medium', budget: 4096 } })
providerConfig.set('codex', { priority: 80 })
providerConfig.set('opencode', { priority: 60, thinking: { mode: 'medium', budget: 4096 } })
