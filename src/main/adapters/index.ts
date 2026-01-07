/**
 * Adapters Module
 *
 * This module exports the adapter registry and all adapter classes.
 * It also handles automatic registration of built-in adapters.
 *
 * Usage:
 * ```typescript
 * import { AdapterRegistry } from '../adapters'
 *
 * const adapter = AdapterRegistry.create({
 *   repoKey: project.remote_repo_key,
 *   providerHint: project.provider_hint,
 *   repoPath: project.local_path,
 *   policy
 * })
 *
 * // Use unified interface
 * await adapter.listIssues()
 * await adapter.createPullRequest(title, body, branch)
 * ```
 */

// ============================================================================
// Re-exports
// ============================================================================

// Types
export type {
  AdapterConstructor,
  AdapterCreateOptions,
  AuthResult,
  IGithubAdapter,
  IRepoAdapter,
  IssueResult,
  LabelResult,
  PRResult
} from './types'
export { isGithubAdapter } from './types'

// Base class
export { BaseAdapter } from './base'

// Registry
export { AdapterRegistry } from './registry'

// Adapter classes
export { LocalAdapter } from './local'
export { GithubAdapter } from './github'
export { GitlabAdapter } from './gitlab'

// Cache utilities
export {
  adapterCache,
  RequestBatcher,
  getCachedIssues,
  cacheIssues,
  getCachedPullRequests,
  cachePullRequests,
  getCachedLabels,
  cacheLabels,
  invalidateRepoCache,
  getAdapterCacheStats,
  issuesKey,
  issueKey,
  pullRequestsKey,
  labelsKey,
  authKey,
  projectStatusKey
} from './cache'

// ============================================================================
// Auto-registration
// ============================================================================

import { AdapterRegistry } from './registry'
import { LocalAdapter } from './local'
import { GithubAdapter } from './github'
import { GitlabAdapter } from './gitlab'

// Register all built-in adapters
// LocalAdapter is registered first as it's the fallback for null repoKey
AdapterRegistry.register('local', LocalAdapter)
AdapterRegistry.register('github', GithubAdapter)
AdapterRegistry.register('gitlab', GitlabAdapter)
