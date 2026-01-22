/**
 * GithubAdapter - Adapter for GitHub repositories.
 *
 * Implements IRepoAdapter and IGithubAdapter interfaces, providing
 * full GitHub API integration including GitHub Projects V2 support.
 *
 * This is a thin facade that delegates to specialized helper classes
 * organized in the github/ folder structure.
 */

import type { Card, CardStatus, PolicyConfig, Provider, RepoLabel } from '@shared/types'
import { BaseAdapter } from './base'
import type { AuthResult, IGithubAdapter, IssueResult, LabelResult, PRResult } from './types'
import { GithubCLIWrapper } from './github/helpers/cli-wrapper'
import { GithubGraphQLClient } from './github/helpers/graphql-client'
import { GithubCardConverter } from './github/helpers/card-converter'
import { GithubLabelManager } from './github/operations/label-manager'
import { GithubIssueOperations } from './github/operations/issue-operations'
import { GithubPROperations } from './github/operations/pr-operations'
import { GithubProjectsManager } from './github/operations/projects-manager'
import type { ProjectStatusMap } from './github/types'

/**
 * GitHub Adapter - Thin facade that delegates to specialized helper classes
 */
export class GithubAdapter extends BaseAdapter implements IGithubAdapter {
  // IRepoAdapter properties
  readonly provider: Provider = 'github'
  readonly providerKey = 'github'
  readonly isLocal = false

  // GitHub-specific properties
  private owner: string
  private repo: string

  // Helper instances
  private cli: GithubCLIWrapper
  private graphql: GithubGraphQLClient
  private cardConverter: GithubCardConverter
  private labelManager: GithubLabelManager
  private issueOps: GithubIssueOperations
  private prOps: GithubPROperations
  private projectsManager: GithubProjectsManager

  constructor(repoPath: string, repoKey: string, policy: PolicyConfig) {
    super(repoPath, repoKey, policy)
    // Parse repoKey like "github:owner/repo"
    const parts = repoKey.replace('github:', '').split('/')
    this.owner = parts[0]
    this.repo = parts[1]

    // Initialize helper instances
    this.cli = new GithubCLIWrapper(this.owner, this.repo, this.repoPath)
    this.graphql = new GithubGraphQLClient(this.cli)
    this.cardConverter = new GithubCardConverter(this.owner, this.repo, this.policy)
    this.labelManager = new GithubLabelManager(this.cli)
    this.issueOps = new GithubIssueOperations(
      this.cli,
      this.cardConverter,
      () => this.projectsManager.getStatusCache()
    )
    this.prOps = new GithubPROperations(
      this.cli,
      this.graphql,
      this.cardConverter,
      () => this.projectsManager.getStatusCache()
    )
    this.projectsManager = new GithubProjectsManager(
      this.owner,
      this.repo,
      this.policy,
      this.cli,
      this.graphql
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Authentication
  // ──────────────────────────────────────────────────────────────────────────

  async checkAuth(): Promise<AuthResult> {
    return this.cli.checkAuth()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Issues
  // ──────────────────────────────────────────────────────────────────────────

  async listIssues(): Promise<Card[]> {
    // Pre-fetch project statuses once (auto-detects project if not explicitly disabled)
    const projectConfig = this.policy.sync?.githubProjectsV2
    const shouldFetchProjectStatus = !(
      projectConfig?.enabled === false && projectConfig?.projectId
    )
    if (shouldFetchProjectStatus) {
      await this.projectsManager.fetchProjectStatusMap()
    }
    return this.issueOps.list()
  }

  async getIssue(issueNumber: number): Promise<Card | null> {
    return this.issueOps.get(issueNumber)
  }

  async createIssue(title: string, body?: string, labels?: string[]): Promise<IssueResult | null> {
    return this.issueOps.create(title, body, labels)
  }

  async updateIssueBody(issueNumber: number, body: string | null): Promise<boolean> {
    return this.issueOps.updateBody(issueNumber, body)
  }

  async addSubIssue(
    parentNodeId: string,
    childNodeId: string,
    parentIssueNumber?: number,
    childIssueNumber?: number
  ): Promise<boolean> {
    return this.issueOps.addSubIssue(parentNodeId, childNodeId, parentIssueNumber, childIssueNumber)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Pull Requests
  // ──────────────────────────────────────────────────────────────────────────

  async listPullRequests(): Promise<Card[]> {
    // Pre-fetch project statuses if not already fetched (auto-detects project)
    const projectConfig = this.policy.sync?.githubProjectsV2
    const shouldFetchProjectStatus = !(
      projectConfig?.enabled === false && projectConfig?.projectId
    )
    if (shouldFetchProjectStatus) {
      await this.projectsManager.fetchProjectStatusMap()
    }
    return this.prOps.list()
  }

  async listPRs(): Promise<Card[]> {
    return this.listPullRequests()
  }

  async createPullRequest(
    title: string,
    body: string,
    branch: string,
    baseBranch = 'main',
    labels?: string[]
  ): Promise<PRResult | null> {
    return this.prOps.create(title, body, branch, baseBranch, labels)
  }

  async createPR(
    title: string,
    body: string,
    branch: string,
    baseBranch = 'main',
    labels?: string[]
  ): Promise<PRResult | null> {
    return this.createPullRequest(title, body, branch, baseBranch, labels)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Labels
  // ──────────────────────────────────────────────────────────────────────────

  async listRepoLabels(): Promise<RepoLabel[]> {
    return this.labelManager.listRepoLabels()
  }

  async createRepoLabel(label: RepoLabel): Promise<LabelResult> {
    return this.labelManager.createRepoLabel(label)
  }

  async updateLabels(
    issueNumber: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    return this.labelManager.updateIssueLabels(issueNumber, labelsToAdd, labelsToRemove)
  }

  async updatePRLabels(
    prNumber: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    return this.labelManager.updatePRLabels(prNumber, labelsToAdd, labelsToRemove)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Comments
  // ──────────────────────────────────────────────────────────────────────────

  async commentOnIssue(issueNumber: number, comment: string): Promise<boolean> {
    return this.issueOps.comment(issueNumber, comment)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GitHub Projects V2 (IGithubAdapter)
  // ──────────────────────────────────────────────────────────────────────────

  async listRepositoryProjects(): Promise<Array<{ id: string; title: string; number: number }>> {
    return this.projectsManager.listRepositoryProjects()
  }

  async findRepositoryProject(): Promise<string | null> {
    return this.projectsManager.findRepositoryProject()
  }

  async fetchProjectStatusMap(): Promise<ProjectStatusMap> {
    return this.projectsManager.fetchProjectStatusMap()
  }

  clearProjectStatusCache(): void {
    this.projectsManager.clearProjectStatusCache()
  }

  async getProjectStatus(issueNumber: number): Promise<string | undefined> {
    return this.projectsManager.getProjectStatus(issueNumber)
  }

  async listProjectDrafts(): Promise<Card[]> {
    return this.projectsManager.listProjectDrafts()
  }

  async updateProjectStatus(issueNumber: number, newStatus: CardStatus): Promise<boolean> {
    return this.projectsManager.updateProjectStatus(issueNumber, newStatus)
  }

  async updateProjectDraftStatus(draftNodeId: string, newStatus: CardStatus): Promise<boolean> {
    return this.projectsManager.updateProjectDraftStatus(draftNodeId, newStatus)
  }

  async updateProjectDraftBody(
    draftNodeId: string,
    title: string,
    body: string | null
  ): Promise<boolean> {
    return this.projectsManager.updateProjectDraftBody(draftNodeId, title, body)
  }

  async listPRIssueLinks(): Promise<
    Array<{
      prNumber: number
      prUrl: string
      issueNumbers: number[]
    }>
  > {
    return this.prOps.listIssueLinks()
  }
}
