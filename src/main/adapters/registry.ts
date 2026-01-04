/**
 * AdapterRegistry - Factory for creating repository adapters.
 *
 * Supports runtime adapter registration and provider_hint overrides for
 * edge cases like GitHub Enterprise or self-hosted GitLab instances.
 */

import type { AdapterConstructor, AdapterCreateOptions, IRepoAdapter } from './types'

/**
 * Registry for adapter classes.
 * Adapters register themselves at module load time.
 */
export class AdapterRegistry {
  private static adapters = new Map<string, AdapterConstructor>()

  /**
   * Register an adapter class with the registry.
   * @param key - Provider key (e.g., 'github', 'gitlab', 'local')
   * @param AdapterClass - Constructor for the adapter class
   */
  static register(key: string, AdapterClass: AdapterConstructor): void {
    this.adapters.set(key, AdapterClass)
  }

  /**
   * Create an adapter instance based on the provided options.
   *
   * Selection logic:
   * 1. If repoKey is null/empty, return LocalAdapter
   * 2. If providerHint is set (not 'auto'), use it directly
   * 3. Otherwise, auto-detect from repoKey prefix
   *
   * @param options - Adapter creation options
   * @returns An adapter instance
   * @throws Error if no matching adapter is found
   */
  static create(options: AdapterCreateOptions): IRepoAdapter {
    const { repoKey, providerHint, repoPath, policy } = options

    // 0. If no repoKey (null/empty), return LocalAdapter
    if (!repoKey) {
      const LocalAdapterClass = this.adapters.get('local')
      if (LocalAdapterClass) {
        return new LocalAdapterClass(repoPath, '', policy)
      }
      throw new Error('LocalAdapter not registered. Ensure adapters/index.ts is imported.')
    }

    // 1. If explicit hint provided (not 'auto'), use it directly
    if (providerHint && providerHint !== 'auto') {
      const AdapterClass = this.adapters.get(providerHint)
      if (AdapterClass) {
        return new AdapterClass(repoPath, repoKey, policy)
      }
      throw new Error(`Unknown provider: ${providerHint}. Registered: ${this.getRegisteredProviders().join(', ')}`)
    }

    // 2. Auto-detect from repoKey prefix (e.g., "github:owner/repo")
    for (const [key, AdapterClass] of this.adapters) {
      // Skip 'local' during prefix matching - it's only used for null repoKey
      if (key !== 'local' && repoKey.startsWith(`${key}:`)) {
        return new AdapterClass(repoPath, repoKey, policy)
      }
    }

    throw new Error(
      `No adapter found for: ${repoKey}. ` +
      `Set provider_hint to override, or register an adapter for this prefix. ` +
      `Registered: ${this.getRegisteredProviders().join(', ')}`
    )
  }

  /**
   * Get a list of all registered provider keys.
   */
  static getRegisteredProviders(): string[] {
    return Array.from(this.adapters.keys())
  }

  /**
   * Check if an adapter is registered for a given key.
   */
  static has(key: string): boolean {
    return this.adapters.has(key)
  }

  /**
   * Check if an adapter can handle a given repoKey.
   * Does not check providerHint - only prefix matching.
   */
  static canHandle(repoKey: string | null): boolean {
    if (!repoKey) {
      return this.adapters.has('local')
    }
    for (const key of this.adapters.keys()) {
      if (key !== 'local' && repoKey.startsWith(`${key}:`)) {
        return true
      }
    }
    return false
  }

  /**
   * Clear all registered adapters.
   * Primarily used for testing.
   */
  static clear(): void {
    this.adapters.clear()
  }
}
