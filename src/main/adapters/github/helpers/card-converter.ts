/**
 * GitHub Card Converter
 * Converts GitHub issues and PRs to Card objects
 */

import type { Card, CardStatus, PolicyConfig } from '@shared/types'
import { cryptoRandomId } from '../../../db'
import type { GithubIssue, GithubPR } from '../types'

/**
 * Converts GitHub issues and PRs to Card objects
 */
export class GithubCardConverter {
  constructor(
    private owner: string,
    private repo: string,
    private policy: PolicyConfig
  ) {}

  /**
   * Convert a GitHub issue to a Card
   */
  issueToCard(issue: GithubIssue, projectStatus?: string): Card {
    const labels = issue.labels.map((l) => l.name)
    const isClosed = issue.state === 'closed'

    // Priority: Projects V2 status > label-based status
    const projectDerivedStatus = this.deriveStatusFromProjectField(projectStatus)
    const status = isClosed ? 'done' : (projectDerivedStatus ?? this.deriveStatus(labels, isClosed))

    return this.buildBaseCard({
      type: 'issue',
      title: issue.title,
      body: issue.body,
      status,
      labels,
      assignees: issue.assignees.map((a) => a.login),
      remoteUrl: issue.url || issue.html_url || null,
      remoteNumberOrIid: String(issue.number),
      remoteNodeId: issue.node_id,
      updatedRemoteAt: issue.updatedAt || issue.updated_at || null,
      readyEligible: this.isReadyEligible(labels, status) ? 1 : 0
    })
  }

  /**
   * Convert a GitHub PR to a Card
   */
  prToCard(pr: GithubPR, projectStatus?: string): Card {
    const labels = pr.labels.map((l) => l.name)
    const isDraft = pr.isDraft ?? pr.draft ?? false
    const stateUpper = pr.state.toUpperCase()
    const isClosed = stateUpper === 'CLOSED' || stateUpper === 'MERGED'
    const isMerged = stateUpper === 'MERGED'

    // Priority: merged/closed state > PR draft state > Projects V2 status > label-based status
    let status: CardStatus
    if (isMerged || isClosed) {
      status = 'done'
    } else if (isDraft) {
      status = 'draft'
    } else {
      const projectDerivedStatus = this.deriveStatusFromProjectField(projectStatus)
      status = projectDerivedStatus ?? this.deriveStatus(labels, isClosed)
    }

    return this.buildBaseCard({
      type: 'pr',
      title: pr.title,
      body: pr.body,
      status,
      labels,
      assignees: pr.assignees.map((a) => a.login),
      remoteUrl: pr.url || pr.html_url || null,
      remoteNumberOrIid: String(pr.number),
      remoteNodeId: pr.node_id,
      updatedRemoteAt: pr.updatedAt || pr.updated_at || null,
      readyEligible: 0 // PRs are not ready eligible
    })
  }

  /**
   * Build base Card object with common fields
   */
  private buildBaseCard(params: {
    type: 'issue' | 'pr' | 'mr' | 'draft'
    title: string
    body: string | null
    status: CardStatus
    labels: string[]
    assignees: string[]
    remoteUrl: string | null
    remoteNumberOrIid: string
    remoteNodeId: string | null
    updatedRemoteAt: string | null
    readyEligible: number
  }): Card {
    return {
      id: cryptoRandomId(),
      project_id: '', // Will be set by caller
      provider: 'github',
      type: params.type,
      title: params.title,
      body: params.body,
      status: params.status,
      ready_eligible: params.readyEligible,
      assignees_json: JSON.stringify(params.assignees),
      labels_json: JSON.stringify(params.labels),
      remote_url: params.remoteUrl,
      remote_repo_key: `github:${this.owner}/${this.repo}`,
      remote_number_or_iid: params.remoteNumberOrIid,
      remote_node_id: params.remoteNodeId,
      updated_remote_at: params.updatedRemoteAt,
      updated_local_at: new Date().toISOString(),
      sync_state: 'ok',
      last_error: null,
      has_conflicts: 0
    }
  }

  /**
   * Derive card status from labels
   */
  private deriveStatus(labels: string[], isClosed: boolean): CardStatus {
    if (isClosed) return 'done'

    const statusLabels = this.policy.sync?.statusLabels || {
      draft: 'Draft',
      ready: 'Ready',
      inProgress: 'In Progress',
      inReview: 'In Review',
      testing: 'Testing',
      done: 'Done'
    }

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
   * Derive card status from GitHub Projects V2 status field value
   */
  private deriveStatusFromProjectField(projectStatus: string | undefined): CardStatus | undefined {
    if (!projectStatus) return undefined

    const statusValues = this.policy.sync?.githubProjectsV2?.statusValues
    if (!statusValues) {
      // Use default mappings if no custom values configured
      const defaultMappings: Record<string, CardStatus> = {
        backlog: 'draft',
        draft: 'draft',
        todo: 'draft',
        ready: 'ready',
        'in progress': 'in_progress',
        inprogress: 'in_progress',
        'in review': 'in_review',
        inreview: 'in_review',
        review: 'in_review',
        testing: 'testing',
        qa: 'testing',
        done: 'done',
        closed: 'done',
        merged: 'done'
      }
      return defaultMappings[projectStatus.toLowerCase()]
    }

    // Match against configured status values
    const normalize = (s: string): string => s.toLowerCase().trim()
    const normalizedStatus = normalize(projectStatus)

    if (statusValues.done && normalize(statusValues.done) === normalizedStatus) return 'done'
    if (statusValues.testing && normalize(statusValues.testing) === normalizedStatus) return 'testing'
    if (statusValues.inReview && normalize(statusValues.inReview) === normalizedStatus) return 'in_review'
    if (statusValues.inProgress && normalize(statusValues.inProgress) === normalizedStatus) return 'in_progress'
    if (statusValues.ready && normalize(statusValues.ready) === normalizedStatus) return 'ready'
    if (statusValues.draft && normalize(statusValues.draft) === normalizedStatus) return 'draft'

    return undefined
  }

  /**
   * Check if a card is eligible for the "ready" status
   */
  private isReadyEligible(labels: string[], status: CardStatus): boolean {
    if (status === 'ready') return true
    const readyLabel = this.policy.sync?.readyLabel || 'ready'
    return labels.includes(readyLabel)
  }
}
