/**
 * GitHub Issue Operations
 * Handles all issue-related CRUD operations
 */

import type { Card } from '@shared/types'
import { logAction } from '../../../utils/main-logger'
import type { GithubCLIWrapper } from '../helpers/cli-wrapper'
import type { GithubCardConverter } from '../helpers/card-converter'
import type { GithubIssue, GithubComment } from '../types'
import type { ProjectStatusMap } from '../types/projects'
import type { RemoteComment } from '../../types'

export interface IssueResult {
  number: number
  url: string
  card: Card
  /** Global issue id from GitHub (for sub_issues API) */
  issueId?: number
}

/**
 * Manages GitHub issue operations
 */
export class GithubIssueOperations {
  constructor(
    private cli: GithubCLIWrapper,
    private cardConverter: GithubCardConverter,
    private getProjectStatusCache: () => ProjectStatusMap | null
  ) {}

  /**
   * List all issues
   */
  async list(): Promise<Card[]> {
    try {
      const stdout = await this.cli.issue([
        'list',
        '--state',
        'all',
        '--limit',
        '1000',
        '--json',
        'number,title,body,state,url,labels,assignees,updatedAt,id'
      ])

      const issues: GithubIssue[] = JSON.parse(stdout)
      const projectStatusCache = this.getProjectStatusCache()

      return issues.map((issue) => {
        const projectStatus = projectStatusCache?.get(issue.number)
        return this.cardConverter.issueToCard(issue, projectStatus)
      })
    } catch (error) {
      console.error('Failed to list GitHub issues:', error)
      return []
    }
  }

  /**
   * Fetch raw issue JSON (includes global id for sub_issues API).
   */
  private async _fetchIssue(issueNumber: number): Promise<GithubIssue | null> {
    try {
      const stdout = await this.cli.issue([
        'view',
        String(issueNumber),
        '--json',
        'number,id,title,body,state,url,labels,assignees,updatedAt,node_id'
      ])
      return JSON.parse(stdout) as GithubIssue
    } catch (error) {
      console.error('Failed to fetch GitHub issue:', error)
      return null
    }
  }

  /**
   * Get a single issue by number
   */
  async get(issueNumber: number): Promise<Card | null> {
    const issue = await this._fetchIssue(issueNumber)
    return issue ? this.cardConverter.issueToCard(issue) : null
  }

  /**
   * Create a new issue
   */
  async create(title: string, body?: string, labels?: string[]): Promise<IssueResult | null> {
    try {
      const args = ['create', '--title', title]

      if (body) {
        args.push('--body', body)
      }

      // Add labels if provided
      if (labels && labels.length > 0) {
        for (const label of labels) {
          args.push('--label', label)
        }
      }

      // gh issue create doesn't support --json, so we parse the output URL
      const stdout = await this.cli.issue(args)

      // Output is like: "https://github.com/owner/repo/issues/123\n"
      const url = stdout.trim()
      const issueNumberMatch = url.match(/\/issues\/(\d+)$/)
      if (!issueNumberMatch) {
        console.error('Failed to parse issue number from URL:', url)
        return null
      }

      const issueNumber = parseInt(issueNumberMatch[1], 10)
      const issue = await this._fetchIssue(issueNumber)
      if (!issue) {
        return null
      }

      const card = this.cardConverter.issueToCard(issue)
      return {
        number: issueNumber,
        url,
        card,
        issueId: issue.id
      }
    } catch (error) {
      console.error('Failed to create GitHub issue:', error)
      return null
    }
  }

  /**
   * Update the body of an issue
   */
  async updateBody(issueNumber: number, body: string | null): Promise<boolean> {
    try {
      await this.cli.issue(['edit', String(issueNumber), '--body', body ?? ''])
      logAction('updateIssueBody: Success', { issueNumber })
      return true
    } catch (error) {
      console.error('Failed to update GitHub issue body:', error)
      return false
    }
  }

  /**
   * List all comments on an issue
   */
  async listComments(issueNumber: number): Promise<RemoteComment[]> {
    try {
      const stdout = await this.cli.issue([
        'view',
        String(issueNumber),
        '--json',
        'comments'
      ])
      const data = JSON.parse(stdout) as { comments: GithubComment[] }
      return (data.comments || []).map((c) => ({
        id: String(c.id),
        author: c.author?.login || 'unknown',
        body: c.body,
        created_at: c.createdAt
      }))
    } catch (error) {
      console.error('Failed to list comments on issue:', error)
      return []
    }
  }

  /**
   * Add a comment to an issue.
   * Returns the created comment's ID, or null on failure.
   */
  async comment(issueNumber: number, comment: string): Promise<string | null> {
    try {
      // Use gh api to create comment and get back the ID
      const result = await this.cli.api([
        'repos/{owner}/{repo}/issues/' + issueNumber + '/comments',
        '-f',
        `body=${comment}`,
        '--jq',
        '.id'
      ])
      const commentId = result?.trim()
      return commentId || null
    } catch (error) {
      console.error('Failed to comment on issue:', error)
      return null
    }
  }

  /**
   * Add a sub-issue relationship using GitHub's sub-issues REST API.
   * Sends JSON body as required by the API; uses childIssueId (global id) when provided, else childIssueNumber.
   */
  async addSubIssue(
    _parentNodeId: string,
    _childNodeId: string,
    parentIssueNumber?: number,
    childIssueNumber?: number,
    childIssueId?: number
  ): Promise<boolean> {
    const subIssueId = childIssueId ?? childIssueNumber
    if (
      parentIssueNumber === undefined ||
      parentIssueNumber === null ||
      subIssueId === undefined ||
      subIssueId === null
    ) {
      return false
    }
    try {
      const body = JSON.stringify({ sub_issue_id: subIssueId })
      const stdout = await this.cli.api(
        [
          '--method',
          'POST',
          '-H',
          'Accept: application/vnd.github+json',
          '-H',
          'X-GitHub-Api-Version: 2022-11-28',
          `/repos/${this.cli.repoIdentifier}/issues/${parentIssueNumber}/sub_issues`,
          '--input',
          '-'
        ],
        body
      )

      logAction('addSubIssue (REST): Success', {
        parentIssueNumber,
        childIssueNumber,
        childIssueId,
        stdout: stdout.slice(0, 200)
      })
      return true
    } catch (restError) {
      logAction('addSubIssue (REST): Failed', {
        parentIssueNumber,
        childIssueNumber,
        childIssueId,
        error: String(restError)
      })
      return false
    }
  }
}
