/**
 * GitHub Issue Operations
 * Handles all issue-related CRUD operations
 */

import type { Card } from '@shared/types'
import { logAction } from '@shared/utils'
import type { GithubCLIWrapper } from '../helpers/cli-wrapper'
import type { GithubCardConverter } from '../helpers/card-converter'
import type { GithubIssue } from '../types'
import type { ProjectStatusMap } from '../types/projects'

export interface IssueResult {
  number: number
  url: string
  card: Card
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
   * Get a single issue by number
   */
  async get(issueNumber: number): Promise<Card | null> {
    try {
      const stdout = await this.cli.issue([
        'view',
        String(issueNumber),
        '--json',
        'number,title,body,state,url,labels,assignees,updatedAt,id'
      ])

      const issue: GithubIssue = JSON.parse(stdout)
      return this.cardConverter.issueToCard(issue)
    } catch (error) {
      console.error('Failed to get issue:', error)
      return null
    }
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

      // Fetch the full issue details to get all fields
      const card = await this.get(issueNumber)
      if (!card) {
        return null
      }

      return {
        number: issueNumber,
        url,
        card
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
   * Add a comment to an issue
   */
  async comment(issueNumber: number, comment: string): Promise<boolean> {
    try {
      await this.cli.issue(['comment', String(issueNumber), '--body', comment])
      return true
    } catch (error) {
      console.error('Failed to comment on issue:', error)
      return false
    }
  }

  /**
   * Add a sub-issue relationship using GitHub's sub-issues REST API
   */
  async addSubIssue(
    _parentNodeId: string,
    _childNodeId: string,
    parentIssueNumber?: number,
    childIssueNumber?: number
  ): Promise<boolean> {
    // Try REST API (more reliable)
    if (parentIssueNumber && childIssueNumber) {
      try {
        const stdout = await this.cli.api([
          '--method',
          'POST',
          `-H`,
          'Accept: application/vnd.github+json',
          `-H`,
          'X-GitHub-Api-Version: 2022-11-28',
          `/repos/${this.cli.repoIdentifier}/issues/${parentIssueNumber}/sub_issues`,
          '-f',
          `sub_issue_id=${childIssueNumber}`
        ])

        logAction('addSubIssue (REST): Success', {
          parentIssueNumber,
          childIssueNumber,
          stdout: stdout.slice(0, 200)
        })
        return true
      } catch (restError) {
        logAction('addSubIssue (REST): Failed', {
          parentIssueNumber,
          childIssueNumber,
          error: String(restError)
        })
        return false
      }
    }

    return false
  }
}
