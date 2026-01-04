/**
 * LocalAdapter - Adapter for projects without a linked git remote.
 *
 * This adapter implements IRepoAdapter with no-op or local-only behavior,
 * allowing consumers to always get an adapter without null checks.
 */

import type { Card, CardStatus, Provider, RepoLabel } from '../../shared/types'
import { BaseAdapter } from './base'
import type { AuthResult, IssueResult, LabelResult, PRResult } from './types'

/**
 * LocalAdapter handles projects without a linked git remote.
 * All remote operations return empty results or no-op success.
 */
export class LocalAdapter extends BaseAdapter {
  readonly provider: Provider = 'local'
  readonly providerKey = 'local'
  readonly isLocal = true

  // ──────────────────────────────────────────────────────────────────────────
  // Authentication
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Always authenticated for local projects (no remote to check).
   */
  async checkAuth(): Promise<AuthResult> {
    return { authenticated: true, username: 'local' }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Issues / Cards
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * No remote issues to fetch for local projects.
   */
  async listIssues(): Promise<Card[]> {
    return []
  }

  /**
   * Cannot get a remote issue for local projects.
   */
  async getIssue(_id: number): Promise<Card | null> {
    return null
  }

  /**
   * Cannot create remote issues for local projects.
   */
  async createIssue(
    _title: string,
    _body?: string,
    _labels?: string[]
  ): Promise<IssueResult | null> {
    return null
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Pull Requests / Merge Requests
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * No remote PRs to fetch for local projects.
   */
  async listPullRequests(): Promise<Card[]> {
    return []
  }

  /**
   * Cannot create remote PRs for local projects.
   */
  async createPullRequest(
    _title: string,
    _body: string,
    _branch: string,
    _baseBranch?: string,
    _labels?: string[]
  ): Promise<PRResult | null> {
    return null
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Labels
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * No remote labels to fetch for local projects.
   * Labels are stored in SQLite via policy configuration.
   */
  async listRepoLabels(): Promise<RepoLabel[]> {
    return []
  }

  /**
   * Cannot create remote labels for local projects.
   */
  async createRepoLabel(_label: RepoLabel): Promise<LabelResult> {
    return { created: false, error: 'Local projects do not support remote labels' }
  }

  /**
   * No-op success for local projects.
   * Labels are managed locally in the database.
   */
  async updateLabels(
    _issueId: number,
    _labelsToAdd: string[],
    _labelsToRemove: string[]
  ): Promise<boolean> {
    return true
  }

  /**
   * No-op success for local projects.
   * Labels are managed locally in the database.
   */
  async updatePRLabels(
    _prNumber: number,
    _labelsToAdd: string[],
    _labelsToRemove: string[]
  ): Promise<boolean> {
    return true
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Comments
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Cannot add comments to remote issues for local projects.
   */
  async commentOnIssue(_issueId: number, _comment: string): Promise<boolean> {
    return false
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Status Derivation (override for local cards)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * For local cards, status is stored directly in the database.
   * This method is provided for interface compatibility.
   */
  deriveLocalStatus(labels: string[], isClosed: boolean): CardStatus {
    return this.deriveStatus(labels, isClosed)
  }
}
