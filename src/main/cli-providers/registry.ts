/**
 * CLIProviderRegistry - Factory for creating and selecting CLI providers.
 *
 * Supports runtime provider registration, auto-selection based on policy,
 * and fallback logic when preferred providers are unavailable.
 */

import type {
  ICLIProvider,
  CLIProviderConstructor,
  CLIProviderMetadata,
  ProviderSelectionResult,
  LimitCheckFn
} from './types'
import type { PolicyConfig } from '../../shared/types'

/**
 * Registry for CLI provider classes.
 * Manages provider registration, selection, and instantiation.
 */
export class CLIProviderRegistry {
  private static providers = new Map<string, CLIProviderConstructor>()
  private static instances = new Map<string, ICLIProvider>()

  // ============================================================================
  // Registration
  // ============================================================================

  /**
   * Register a provider class with the registry.
   */
  static register(key: string, ProviderClass: CLIProviderConstructor): void {
    this.providers.set(key, ProviderClass)
  }

  /**
   * Get a list of all registered provider keys.
   */
  static getRegisteredProviders(): string[] {
    return Array.from(this.providers.keys())
  }

  /**
   * Check if a provider is registered.
   */
  static has(key: string): boolean {
    return this.providers.has(key)
  }

  // ============================================================================
  // Instantiation
  // ============================================================================

  /**
   * Get a provider instance by key.
   * Instances are cached for reuse (providers are stateless).
   */
  static get(key: string): ICLIProvider | null {
    // Check cache first
    const cached = this.instances.get(key)
    if (cached) return cached

    // Create new instance
    const ProviderClass = this.providers.get(key)
    if (!ProviderClass) return null

    const instance = new ProviderClass()
    this.instances.set(key, instance)
    return instance
  }

  /**
   * Get all registered provider instances.
   */
  static getAll(): ICLIProvider[] {
    return this.getRegisteredProviders()
      .map((key) => this.get(key))
      .filter((p): p is ICLIProvider => p !== null)
  }

  // ============================================================================
  // Selection Logic
  // ============================================================================

  /**
   * Select the best available provider based on policy preference.
   *
   * Selection logic:
   * 1. If toolPreference is explicit (not 'auto'), try that provider first
   * 2. If 'auto', try providers in order: claude, codex, others
   * 3. Check availability and limits for each candidate
   * 4. Return the first available provider
   */
  static async selectProvider(
    policy: PolicyConfig,
    checkLimits?: LimitCheckFn
  ): Promise<ProviderSelectionResult> {
    const toolPreference = policy.worker?.toolPreference || 'auto'

    // Get candidate providers based on preference
    let candidates: string[]
    if (toolPreference !== 'auto') {
      // Explicit preference: try that first, then fallbacks
      candidates = [toolPreference, ...this.getRegisteredProviders().filter((k) => k !== toolPreference)]
    } else {
      // Auto: use default order
      candidates = this.getDefaultOrder()
    }

    let fallbackUsed = false
    let lastReason: string | undefined

    for (let i = 0; i < candidates.length; i++) {
      const key = candidates[i]
      const provider = this.get(key)
      if (!provider) continue

      // Check availability
      const available = await provider.isAvailable()
      if (!available) {
        lastReason = `${provider.metadata.displayName} CLI not found`
        continue
      }

      // Check limits
      if (checkLimits) {
        const limitCheck = checkLimits(provider.metadata.toolType)
        if (limitCheck.exceeded) {
          lastReason = limitCheck.reason
          continue
        }
      }

      // Provider is available and within limits
      fallbackUsed = i > 0 && toolPreference !== 'auto'
      return {
        provider,
        fallbackUsed,
        reason: fallbackUsed ? `Fell back to ${provider.metadata.displayName}` : undefined
      }
    }

    return { provider: null, fallbackUsed, reason: lastReason || 'No AI tools available' }
  }

  /**
   * Get all available providers (installed on system).
   */
  static async getAvailableProviders(): Promise<ICLIProvider[]> {
    const all = this.getAll()
    const available: ICLIProvider[] = []

    for (const provider of all) {
      if (await provider.isAvailable()) {
        available.push(provider)
      }
    }

    return available
  }

  /**
   * Get availability status for all registered providers.
   * Returns object keyed by provider key.
   */
  static async getAvailabilityStatus(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {}
    for (const provider of this.getAll()) {
      status[provider.metadata.key] = await provider.isAvailable()
    }
    return status
  }

  /**
   * Get metadata for all registered providers.
   */
  static getAllMetadata(): CLIProviderMetadata[] {
    return this.getAll().map((p) => p.metadata)
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Get default provider order for 'auto' mode.
   */
  private static getDefaultOrder(): string[] {
    // Claude first, then codex, then others alphabetically
    const registered = this.getRegisteredProviders()
    const priorityOrder = ['claude', 'codex']
    const others = registered.filter((k) => !priorityOrder.includes(k)).sort()
    return [...priorityOrder.filter((k) => registered.includes(k)), ...others]
  }

  /**
   * Clear all cached instances (useful for testing).
   */
  static clearInstances(): void {
    this.instances.clear()
  }

  /**
   * Clear all registrations (useful for testing).
   */
  static clear(): void {
    this.providers.clear()
    this.instances.clear()
  }
}
