/**
 * GitHub PR Operations
 * Handles all pull request-related operations
 */

import type { Card } from '@shared/types'
import type { GithubCLIWrapper } from '../helpers/cli-wrapper'
import type { GithubCardConverter } from '../helpers/card-converter'
import type { GithubGraphQLClient } from '../helpers/graphql-client'
import type { GithubPR, GithubPullRequestIssueLink } from '../types'
import type { ProjectStatusMap } from '../types/projects'

export interface PRResult {
  number: number
  url: string
}

/**
 * Manages GitHub pull request operations
 */
export class GithubPROperations {
  constructor(
    private cli: GithubCLIWrapper,
    private graphql: GithubGraphQLClient,
    private cardConverter: GithubCardConverter,
    private getProjectStatusCache: () => ProjectStatusMap | null
  ) {}

  /**
   * List all pull requests
   */
  async list(): Promise<Card[]> {
    try {
      const stdout = await this.cli.pr([
        'list',
        '--state',
        'all',
        '--limit',
        '1000',
        '--json',
        'number,title,body,state,url,labels,assignees,updatedAt,id,isDraft'
      ])

      const prs: GithubPR[] = JSON.parse(stdout)
      const projectStatusCache = this.getProjectStatusCache()
      
      return prs.map((pr) => {
        const projectStatus = projectStatusCache?.get(pr.number)
        return this.cardConverter.prToCard(pr, projectStatus)
      })
    } catch (error) {
      console.error('Failed to list GitHub PRs:', error)
      return []
    }
  }

  /**
   * Create a pull request
   */
  async create(
    title: string,
    body: string,
    branch: string,
    baseBranch = 'main',
    labels?: string[]
  ): Promise<PRResult | null> {
    try {
      const args = [
        'create',
        '--title',
        title,
        '--body',
        body,
        '--head',
        branch,
        '--base',
        baseBranch
      ]

      // Add labels if provided
      if (labels && labels.length > 0) {
        for (const label of labels) {
          args.push('--label', label)
        }
      }

      const stdout = await this.cli.pr(args)

      // gh pr create outputs the PR URL on success
      // e.g., "https://github.com/owner/repo/pull/123"
      const url = stdout.trim()
      const prNumberMatch = url.match(/\/pull\/(\d+)/)
      const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0

      return { number: prNumber, url }
    } catch (error) {
      console.error('Failed to create PR:', error)
      return null
    }
  }

  /**
   * List PR to issue links (closing issues references)
   */
  async listIssueLinks(): Promise<GithubPullRequestIssueLink[]> {
    const results: GithubPullRequestIssueLink[] = []

    try {
      const query = `
        query($owner: String!, $repo: String!, $cursor: String) {
          repository(owner: $owner, name: $repo) {
            pullRequests(
              first: 100,
              after: $cursor,
              states: [OPEN, MERGED, CLOSED],
              orderBy: { field: UPDATED_AT, direction: DESC }
            ) {
              nodes {
                number
                url
                closingIssuesReferences(first: 25) {
                  nodes {
                    number
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `

      const [owner, repo] = this.cli.repoIdentifier.split('/')
      
      interface PRNode {
        number?: number
        url?: string
        closingIssuesReferences?: {
          nodes?: Array<{ number?: number }>
        }
      }

      const items = await this.graphql.paginatedQuery<PRNode>(
        query,
        { owner, repo },
        (response: any) => ({
          items: (response.data?.repository?.pullRequests?.nodes ?? []) as PRNode[],
          pageInfo: response.data?.repository?.pullRequests?.pageInfo ?? {
            hasNextPage: false,
            endCursor: null
          }
        })
      )

      for (const pr of items) {
        const prNumber = pr.number
        const prUrl = pr.url
        if (!prNumber || !prUrl) continue

        const issueNumbers = (pr.closingIssuesReferences?.nodes ?? [])
          .map((n) => n.number)
          .filter((n): n is number => typeof n === 'number')

        if (issueNumbers.length === 0) continue

        results.push({ prNumber, prUrl, issueNumbers })
      }
    } catch (error) {
      console.error('Failed to fetch PR issue links:', error)
      return []
    }

    return results
  }
}
