/**
 * Shared types for the adapter system.
 * Defines the IRepoAdapter interface that all adapters must implement.
 */

import type { Card, CardStatus, PolicyConfig, Provider, RepoLabel } from '../../shared/types'

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of an authentication check.
 */
export interface AuthResult {
  authenticated: boolean
  username?: string
  error?: string
}

/**
 * Result of creating an issue.
 */
export interface IssueResult {
  number: number
  url: string
  card: Card
}

/**
 * Result of creating a pull request / merge request.
 */
export interface PRResult {
  number: number
  url: string
}

/**
 * Result of creating a label.
 */
export interface LabelResult {
  created: boolean
  error?: string
}

// ============================================================================
// Adapter Options
// ============================================================================

/**
 * Options for creating an adapter via the registry.
 */
export interface AdapterCreateOptions {
  /** Remote repo key (e.g., "github:owner/repo") or null for local-only projects */
  repoKey: string | null
  /** Explicit provider override. If 'auto' or undefined, auto-detect from repoKey prefix */
  providerHint?: 'auto' | 'github' | 'gitlab'
  /** Local path to the repository */
  repoPath: string
  /** Policy configuration for the project */
  policy: PolicyConfig
}

/**
 * Constructor signature for adapter classes.
 */
export type AdapterConstructor = new (
  repoPath: string,
  repoKey: string,
  policy: PolicyConfig
) => IRepoAdapter

// ============================================================================
// Main Interface
// ============================================================================

/**
 * IRepoAdapter - Unified interface for all repository adapters.
 *
 * This interface abstracts the differences between GitHub, GitLab, and local-only
 * projects, allowing consumers to work with any adapter without type checking.
 */
export interface IRepoAdapter {
  /** Provider type ('github', 'gitlab', 'local') */
  readonly provider: Provider

  /** Provider key used for registry lookup */
  readonly providerKey: string

  /** Whether this is a local-only adapter (no remote operations) */
  readonly isLocal: boolean

  // ──────────────────────────────────────────────────────────────────────────
  // Authentication
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if the user is authenticated with the remote provider.
   * LocalAdapter always returns authenticated: true.
   */
  checkAuth(): Promise<AuthResult>

  // ──────────────────────────────────────────────────────────────────────────
  // Issues / Cards
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * List all issues from the remote repository.
   * LocalAdapter returns an empty array.
   */
  listIssues(): Promise<Card[]>

  /**
   * Get a single issue by its number/iid.
   * LocalAdapter returns null.
   */
  getIssue(id: number): Promise<Card | null>

  /**
   * Create a new issue on the remote repository.
   * LocalAdapter returns null (cannot create remote issues).
   */
  createIssue(
    title: string,
    body?: string,
    labels?: string[]
  ): Promise<IssueResult | null>

  // ──────────────────────────────────────────────────────────────────────────
  // Pull Requests / Merge Requests
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * List all pull requests / merge requests from the remote repository.
   * LocalAdapter returns an empty array.
   */
  listPullRequests(): Promise<Card[]>

  /**
   * Create a new pull request / merge request.
   * LocalAdapter returns null (cannot create remote PRs).
   * @param labels - Optional labels to attach to the PR on creation
   */
  createPullRequest(
    title: string,
    body: string,
    branch: string,
    baseBranch?: string,
    labels?: string[]
  ): Promise<PRResult | null>

  // ──────────────────────────────────────────────────────────────────────────
  // Labels
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * List all labels in the remote repository.
   * LocalAdapter returns an empty array.
   */
  listRepoLabels(): Promise<RepoLabel[]>

  /**
   * Create a new label in the remote repository.
   * LocalAdapter returns { created: false }.
   */
  createRepoLabel(label: RepoLabel): Promise<LabelResult>

  /**
   * Update labels on an issue.
   * LocalAdapter returns true (no-op success).
   */
  updateLabels(
    issueId: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean>

  /**
   * Update labels on a pull request / merge request.
   * LocalAdapter returns true (no-op success).
   */
  updatePRLabels(
    prNumber: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean>

  /**
   * Get the label string for a given card status.
   */
  getStatusLabel(status: CardStatus): string

  /**
   * Get all status labels configured for this adapter.
   */
  getAllStatusLabels(): string[]

  // ──────────────────────────────────────────────────────────────────────────
  // Comments
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Add a comment to an issue.
   * LocalAdapter returns false (comments not supported).
   */
  commentOnIssue(issueId: number, comment: string): Promise<boolean>
}

// ============================================================================
// GitHub-specific Extensions
// ============================================================================

/**
 * Extended interface for GitHub-specific functionality.
 * Used when the adapter needs GitHub Projects V2 features.
 */
export interface IGithubAdapter extends IRepoAdapter {
  /** Find the GitHub Projects V2 associated with this repository */
  findRepositoryProject(): Promise<string | null>

  /** Fetch project status map for all items */
  fetchProjectStatusMap(): Promise<Map<number, string>>

  /** Clear the cached project status map */
  clearProjectStatusCache(): void

  /** Get project status for an issue/PR number */
  getProjectStatus(issueNumber: number): Promise<string | undefined>

  /** List draft items from GitHub Projects V2 */
  listProjectDrafts(): Promise<Card[]>

  /** Update the status field on a GitHub Projects V2 item */
  updateProjectStatus(issueNumber: number, newStatus: CardStatus): Promise<boolean>

  /** Update the status field on a GitHub Projects V2 draft item */
  updateProjectDraftStatus(draftNodeId: string, newStatus: CardStatus): Promise<boolean>

  /** List PR to issue links */
  listPRIssueLinks(): Promise<Array<{
    prNumber: number
    prUrl: string
    issueNumbers: number[]
  }>>
}

/**
 * Type guard to check if an adapter is a GitHub adapter with extended features.
 */
export function isGithubAdapter(adapter: IRepoAdapter): adapter is IGithubAdapter {
  return adapter.providerKey === 'github'
}
