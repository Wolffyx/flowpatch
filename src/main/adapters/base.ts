/**
 * BaseAdapter - Abstract base class for all repository adapters.
 *
 * Contains shared logic for status derivation, label management, and
 * policy-based configuration that is common across GitHub, GitLab, and local adapters.
 */

import type { Card, CardStatus, PolicyConfig, Provider, RepoLabel } from '../../shared/types'
import type {
  AuthResult,
  IRepoAdapter,
  IssueResult,
  LabelResult,
  PRResult
} from './types'

/**
 * Abstract base adapter that implements shared functionality.
 * Concrete adapters (GitHub, GitLab, Local) extend this class.
 */
export abstract class BaseAdapter implements IRepoAdapter {
  // ──────────────────────────────────────────────────────────────────────────
  // Abstract Properties (must be implemented by subclasses)
  // ──────────────────────────────────────────────────────────────────────────

  abstract readonly provider: Provider
  abstract readonly providerKey: string
  abstract readonly isLocal: boolean

  // ──────────────────────────────────────────────────────────────────────────
  // Protected Properties
  // ──────────────────────────────────────────────────────────────────────────

  protected repoPath: string
  protected repoKey: string
  protected policy: PolicyConfig

  // ──────────────────────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────────────────────

  constructor(repoPath: string, repoKey: string, policy: PolicyConfig) {
    this.repoPath = repoPath
    this.repoKey = repoKey
    this.policy = policy
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Abstract Methods (must be implemented by subclasses)
  // ──────────────────────────────────────────────────────────────────────────

  abstract checkAuth(): Promise<AuthResult>
  abstract listIssues(): Promise<Card[]>
  abstract getIssue(id: number): Promise<Card | null>
  abstract createIssue(
    title: string,
    body?: string,
    labels?: string[]
  ): Promise<IssueResult | null>
  abstract listPullRequests(): Promise<Card[]>
  abstract createPullRequest(
    title: string,
    body: string,
    branch: string,
    baseBranch?: string,
    labels?: string[]
  ): Promise<PRResult | null>
  abstract listRepoLabels(): Promise<RepoLabel[]>
  abstract createRepoLabel(label: RepoLabel): Promise<LabelResult>
  abstract updateLabels(
    issueId: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean>
  abstract updatePRLabels(
    prNumber: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean>
  abstract commentOnIssue(issueId: number, comment: string): Promise<boolean>

  // ──────────────────────────────────────────────────────────────────────────
  // Status Label Methods (shared implementation)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get the label string for a given card status.
   */
  getStatusLabel(status: CardStatus): string {
    const statusLabels = this.policy.sync?.statusLabels || {}
    switch (status) {
      case 'draft':
        return statusLabels.draft || 'Draft'
      case 'ready':
        return statusLabels.ready || 'Ready'
      case 'in_progress':
        return statusLabels.inProgress || 'In Progress'
      case 'in_review':
        return statusLabels.inReview || 'In Review'
      case 'testing':
        return statusLabels.testing || 'Testing'
      case 'done':
        return statusLabels.done || 'Done'
      default:
        return 'Draft'
    }
  }

  /**
   * Get all status labels configured for this adapter.
   */
  getAllStatusLabels(): string[] {
    const statusLabels = this.policy.sync?.statusLabels || {}
    return [
      statusLabels.draft || 'Draft',
      statusLabels.ready || 'Ready',
      statusLabels.inProgress || 'In Progress',
      statusLabels.inReview || 'In Review',
      statusLabels.testing || 'Testing',
      statusLabels.done || 'Done'
    ]
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Protected Helper Methods (shared across subclasses)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Derive card status from labels.
   * Checks labels against configured status labels and common variations.
   */
  protected deriveStatus(labels: string[], isClosed: boolean): CardStatus {
    if (isClosed) return 'done'

    const statusLabels = this.policy.sync?.statusLabels || {
      draft: 'Draft',
      ready: 'Ready',
      inProgress: 'In Progress',
      inReview: 'In Review',
      testing: 'Testing',
      done: 'Done'
    }

    // Normalize strings by lowercasing and removing spaces to handle:
    // - CamelCase: "InProgress", "InReview"
    // - Title case with spaces: "In Progress", "In Review"
    // - Lowercase with spaces: "in progress", "in review"
    const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

    const normalized = labels.map(normalize)
    const matches = (candidates: (string | undefined)[]): boolean =>
      candidates.filter(Boolean).some((c) => normalized.includes(normalize(String(c))))

    if (matches([statusLabels.done, 'done', 'indone'])) return 'done'
    if (matches([statusLabels.testing, 'testing', 'qa'])) return 'testing'
    if (matches([statusLabels.inReview, 'inreview', 'in review', 'review'])) return 'in_review'
    if (matches([statusLabels.inProgress, 'inprogress', 'in progress', 'wip'])) return 'in_progress'
    if (matches([statusLabels.ready, 'ready'])) return 'ready'

    const readyLabel = this.policy.sync?.readyLabel || 'ready'
    if (matches([readyLabel])) return 'ready'

    return 'draft'
  }

  /**
   * Check if a card is eligible for the "ready" status.
   */
  protected isReadyEligible(labels: string[], status: CardStatus): boolean {
    if (status === 'ready') return true
    const readyLabel = this.policy.sync?.readyLabel || 'ready'
    return labels.includes(readyLabel)
  }

  /**
   * Get the default status labels configuration.
   */
  protected getDefaultStatusLabels(): NonNullable<
    NonNullable<PolicyConfig['sync']>['statusLabels']
  > {
    return {
      draft: 'Draft',
      ready: 'Ready',
      inProgress: 'In Progress',
      inReview: 'In Review',
      testing: 'Testing',
      done: 'Done'
    }
  }
}
