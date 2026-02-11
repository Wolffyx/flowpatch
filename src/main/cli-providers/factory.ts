/**
 * Provider Factory
 *
 * Factory for registering, routing, and selecting providers.
 */

import type { ICLIProvider, CLIProviderCapabilities, LimitCheckFn } from './types'

// ============================================================================
// Types
// ============================================================================

interface FactoryEntry {
  provider: ICLIProvider
  priority: number
}

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * Provider factory with priority-based selection and model routing.
 */
export class ProviderFactory {
  private static entries = new Map<string, FactoryEntry>()
  private static routes = new Map<string, string>()

  /**
   * Register a provider with optional priority.
   * Higher priority providers are preferred in getBest().
   */
  static register(key: string, provider: ICLIProvider, priority = 50): void {
    this.entries.set(key, { provider, priority })
  }

  /**
   * Unregister a provider.
   */
  static unregister(key: string): boolean {
    return this.entries.delete(key)
  }

  /**
   * Add a model ID prefix route.
   * Example: route('anthropic/', 'claude') maps 'anthropic/claude-3' to claude provider.
   */
  static route(prefix: string, providerKey: string): void {
    this.routes.set(prefix, providerKey)
  }

  /**
   * Remove a model route.
   */
  static unroute(prefix: string): boolean {
    return this.routes.delete(prefix)
  }

  /**
   * Get a provider by key or model ID.
   */
  static get(keyOrModel: string): ICLIProvider | null {
    // Direct key match
    const entry = this.entries.get(keyOrModel)
    if (entry) return entry.provider

    // Model prefix routing
    for (const [prefix, key] of this.routes) {
      if (keyOrModel.startsWith(prefix)) {
        return this.entries.get(key)?.provider ?? null
      }
    }

    return null
  }

  /**
   * Check if a provider is registered.
   */
  static has(key: string): boolean {
    return this.entries.has(key)
  }

  /**
   * Get the best available provider based on capabilities and limits.
   */
  static async getBest(
    capabilities?: Partial<CLIProviderCapabilities>,
    limitCheck?: LimitCheckFn
  ): Promise<ICLIProvider | null> {
    // Sort by priority (highest first)
    const sorted = Array.from(this.entries.values()).sort((a, b) => b.priority - a.priority)

    for (const { provider } of sorted) {
      // Check availability
      if (!(await provider.isAvailable())) continue

      // Check required capabilities
      if (capabilities) {
        const cap = provider.capabilities
        if (capabilities.supportsThinking && !cap.supportsThinking) continue
        if (capabilities.supportsStdin && !cap.supportsStdin) continue
        if (capabilities.supportsStreaming && !cap.supportsStreaming) continue
        if (capabilities.supportsAutoApprove && !cap.supportsAutoApprove) continue
        if (capabilities.supportsFileInput && !cap.supportsFileInput) continue
      }

      // Check usage limits
      if (limitCheck) {
        const check = limitCheck(provider.metadata.toolType)
        if (check.exceeded) continue
      }

      return provider
    }

    return null
  }

  /**
   * Get all registered providers.
   */
  static getAll(): ICLIProvider[] {
    return Array.from(this.entries.values()).map((e) => e.provider)
  }

  /**
   * Get all registered provider keys.
   */
  static getKeys(): string[] {
    return Array.from(this.entries.keys())
  }

  /**
   * Get priority for a provider.
   */
  static getPriority(key: string): number | undefined {
    return this.entries.get(key)?.priority
  }

  /**
   * Update priority for a provider.
   */
  static setPriority(key: string, priority: number): boolean {
    const entry = this.entries.get(key)
    if (entry) {
      entry.priority = priority
      return true
    }
    return false
  }

  /**
   * Check availability of all providers.
   */
  static async checkAll(): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {}
    const checks = Array.from(this.entries.entries()).map(async ([key, { provider }]) => {
      result[key] = await provider.isAvailable()
    })
    await Promise.all(checks)
    return result
  }

  /**
   * Get available providers only.
   */
  static async getAvailable(): Promise<ICLIProvider[]> {
    const available: ICLIProvider[] = []

    for (const { provider } of this.entries.values()) {
      if (await provider.isAvailable()) {
        available.push(provider)
      }
    }

    return available
  }

  /**
   * Clear all registered providers and routes.
   */
  static clear(): void {
    this.entries.clear()
    this.routes.clear()
  }

  /**
   * Get provider count.
   */
  static get count(): number {
    return this.entries.size
  }

  /**
   * Get route count.
   */
  static get routeCount(): number {
    return this.routes.size
  }
}
