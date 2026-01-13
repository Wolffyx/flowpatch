/**
 * GithubAdapter - Adapter for GitHub repositories.
 *
 * Implements IRepoAdapter and IGithubAdapter interfaces, providing
 * full GitHub API integration including GitHub Projects V2 support.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Card, CardStatus, PolicyConfig, Provider, RepoLabel } from '@shared/types'
import { cryptoRandomId } from '../db'
import { logAction } from '@shared/utils'
import { BaseAdapter } from './base'
import type { AuthResult, IGithubAdapter, IssueResult, LabelResult, PRResult } from './types'

const execFileAsync = promisify(execFile)

// ============================================================================
// GitHub-specific Types
// ============================================================================

interface GithubIssue {
  number: number
  title: string
  body: string | null
  state: string
  url: string
  html_url?: string
  labels: { name: string }[]
  assignees: { login: string }[]
  updatedAt: string
  updated_at?: string
  node_id: string
}

interface GithubPR {
  number: number
  title: string
  body: string | null
  state: string
  url: string
  html_url?: string
  labels: { name: string }[]
  assignees: { login: string }[]
  updatedAt: string
  updated_at?: string
  node_id: string
  isDraft: boolean
  draft?: boolean
}

interface GithubPullRequestIssueLink {
  prNumber: number
  prUrl: string
  issueNumbers: number[]
}

// GitHub Projects V2 GraphQL types
interface ProjectV2Item {
  id: string
  content: {
    __typename: string
    number?: number
    url?: string
    id?: string
    title?: string
    body?: string | null
    updatedAt?: string
  } | null
  fieldValues: {
    nodes: Array<{
      __typename: string
      name?: string
      field?: {
        name: string
      }
    }>
  }
}

interface ProjectV2Response {
  data?: {
    node?: {
      items?: {
        nodes: ProjectV2Item[]
        pageInfo: {
          hasNextPage: boolean
          endCursor: string | null
        }
      }
    }
  }
  errors?: Array<{ message: string }>
}

// Map of issue/PR number to their project status
type ProjectStatusMap = Map<number, string>

// ============================================================================
// GithubAdapter Class
// ============================================================================

export class GithubAdapter extends BaseAdapter implements IGithubAdapter {
  // IRepoAdapter properties
  readonly provider: Provider = 'github'
  readonly providerKey = 'github'
  readonly isLocal = false

  // GitHub-specific properties
  private owner: string
  private repo: string
  private projectStatusCache: ProjectStatusMap | null = null

  constructor(repoPath: string, repoKey: string, policy: PolicyConfig) {
    super(repoPath, repoKey, policy)
    // Parse repoKey like "github:owner/repo"
    const parts = repoKey.replace('github:', '').split('/')
    this.owner = parts[0]
    this.repo = parts[1]
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Authentication
  // ──────────────────────────────────────────────────────────────────────────

  async checkAuth(): Promise<AuthResult> {
    try {
      const { stdout } = await execFileAsync('gh', ['auth', 'status', '--hostname', 'github.com'], {
        cwd: this.repoPath
      })
      const match = stdout.match(/Logged in to github.com account (\S+)/)
      return {
        authenticated: true,
        username: match ? match[1] : undefined
      }
    } catch (error) {
      return {
        authenticated: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Issues
  // ──────────────────────────────────────────────────────────────────────────

  async listIssues(): Promise<Card[]> {
    try {
      // Pre-fetch project statuses once (auto-detects project if not explicitly disabled)
      const projectConfig = this.policy.sync?.githubProjectsV2
      // Only skip if explicitly disabled with a configured projectId
      const shouldFetchProjectStatus =
        !(projectConfig?.enabled === false && projectConfig?.projectId)
      if (shouldFetchProjectStatus && !this.projectStatusCache) {
        await this.fetchProjectStatusMap()
      }

      const { stdout } = await execFileAsync(
        'gh',
        [
          'issue',
          'list',
          '--repo',
          `${this.owner}/${this.repo}`,
          '--state',
          'all',
          '--limit',
          '1000',
          '--json',
          'number,title,body,state,url,labels,assignees,updatedAt,id'
        ],
        { cwd: this.repoPath }
      )

      const issues: GithubIssue[] = JSON.parse(stdout)
      return issues.map((issue) => {
        const projectStatus = this.projectStatusCache?.get(issue.number)
        return this.issueToCard(issue, projectStatus)
      })
    } catch (error) {
      console.error('Failed to list GitHub issues:', error)
      return []
    }
  }

  async getIssue(issueNumber: number): Promise<Card | null> {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
          'issue',
          'view',
          String(issueNumber),
          '--repo',
          `${this.owner}/${this.repo}`,
          '--json',
          'number,title,body,state,url,labels,assignees,updatedAt,id'
        ],
        { cwd: this.repoPath }
      )

      const issue: GithubIssue = JSON.parse(stdout)
      return this.issueToCard(issue)
    } catch (error) {
      console.error('Failed to get issue:', error)
      return null
    }
  }

  async createIssue(
    title: string,
    body?: string,
    labels?: string[]
  ): Promise<IssueResult | null> {
    try {
      const args = ['issue', 'create', '--repo', `${this.owner}/${this.repo}`, '--title', title]

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
      const { stdout } = await execFileAsync('gh', args, { cwd: this.repoPath })

      // Output is like: "https://github.com/owner/repo/issues/123\n"
      const url = stdout.trim()
      const issueNumberMatch = url.match(/\/issues\/(\d+)$/)
      if (!issueNumberMatch) {
        console.error('Failed to parse issue number from URL:', url)
        return null
      }

      const issueNumber = parseInt(issueNumberMatch[1], 10)

      // Fetch the full issue details to get all fields
      const card = await this.getIssue(issueNumber)
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
   * Update the body of an issue (implements IRepoAdapter)
   */
  async updateIssueBody(issueNumber: number, body: string | null): Promise<boolean> {
    try {
      const args = [
        'issue',
        'edit',
        String(issueNumber),
        '--repo',
        `${this.owner}/${this.repo}`,
        '--body',
        body ?? ''
      ]

      await execFileAsync('gh', args, { cwd: this.repoPath })
      logAction('updateIssueBody: Success', { issueNumber })
      return true
    } catch (error) {
      console.error('Failed to update GitHub issue body:', error)
      return false
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Pull Requests
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * List all pull requests (implements IRepoAdapter.listPullRequests)
   */
  async listPullRequests(): Promise<Card[]> {
    return this.listPRs()
  }

  /**
   * List all pull requests (legacy method name, kept for compatibility)
   */
  async listPRs(): Promise<Card[]> {
    try {
      // Pre-fetch project statuses if not already fetched (auto-detects project)
      const projectConfig = this.policy.sync?.githubProjectsV2
      // Only skip if explicitly disabled with a configured projectId
      const shouldFetchProjectStatus =
        !(projectConfig?.enabled === false && projectConfig?.projectId)
      if (shouldFetchProjectStatus && !this.projectStatusCache) {
        await this.fetchProjectStatusMap()
      }

      const { stdout } = await execFileAsync(
        'gh',
        [
          'pr',
          'list',
          '--repo',
          `${this.owner}/${this.repo}`,
          '--state',
          'all',
          '--limit',
          '1000',
          '--json',
          'number,title,body,state,url,labels,assignees,updatedAt,id,isDraft'
        ],
        { cwd: this.repoPath }
      )

      const prs: GithubPR[] = JSON.parse(stdout)
      return prs.map((pr) => {
        const projectStatus = this.projectStatusCache?.get(pr.number)
        return this.prToCard(pr, projectStatus)
      })
    } catch (error) {
      console.error('Failed to list GitHub PRs:', error)
      return []
    }
  }

  /**
   * Create a pull request (implements IRepoAdapter.createPullRequest)
   */
  async createPullRequest(
    title: string,
    body: string,
    branch: string,
    baseBranch = 'main',
    labels?: string[]
  ): Promise<PRResult | null> {
    return this.createPR(title, body, branch, baseBranch, labels)
  }

  /**
   * Create a pull request (legacy method name, kept for compatibility)
   */
  async createPR(
    title: string,
    body: string,
    branch: string,
    baseBranch = 'main',
    labels?: string[]
  ): Promise<PRResult | null> {
    try {
      const args = [
        'pr',
        'create',
        '--repo',
        `${this.owner}/${this.repo}`,
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

      const { stdout } = await execFileAsync('gh', args, { cwd: this.repoPath })

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

  // ──────────────────────────────────────────────────────────────────────────
  // Labels
  // ──────────────────────────────────────────────────────────────────────────

  async listRepoLabels(): Promise<RepoLabel[]> {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
          'label',
          'list',
          '--repo',
          `${this.owner}/${this.repo}`,
          '--limit',
          '1000',
          '--json',
          'name,color,description'
        ],
        { cwd: this.repoPath }
      )
      const labels = JSON.parse(stdout) as Array<{
        name: string
        color?: string
        description?: string
      }>
      return labels.map((l) => ({ name: l.name, color: l.color, description: l.description }))
    } catch (error) {
      logAction('github:listRepoLabels:error', { error: String(error) })
      return []
    }
  }

  async createRepoLabel(label: RepoLabel): Promise<LabelResult> {
    const name = (label.name || '').trim()
    if (!name) return { created: false, error: 'Label name is required' }

    const args = ['label', 'create', name, '--repo', `${this.owner}/${this.repo}`]
    if (label.color) args.push('--color', label.color.replace(/^#/, ''))
    if (label.description) args.push('--description', label.description)

    try {
      await execFileAsync('gh', args, { cwd: this.repoPath })
      return { created: true }
    } catch (error) {
      return { created: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async updateLabels(
    issueNumber: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    try {
      // Fetch existing labels from the repository to match against
      const repoLabels = await this.fetchRepoLabelsInternal()
      logAction('updateLabels: fetched repo labels', { repoLabels, labelsToAdd, labelsToRemove })

      const failedAdds: string[] = []
      for (const label of labelsToAdd) {
        // Find matching label in repo (handles case, spaces, dashes, prefixes)
        let matchedLabel = this.findMatchingLabel(label, repoLabels)
        logAction('updateLabels: matching result', { original: label, matched: matchedLabel })
        if (!matchedLabel) {
          // Try adding the label by name directly first (works if fetchRepoLabels failed or matching missed).
          try {
            await execFileAsync(
              'gh',
              [
                'issue',
                'edit',
                String(issueNumber),
                '--repo',
                `${this.owner}/${this.repo}`,
                '--add-label',
                label
              ],
              { cwd: this.repoPath }
            )
            continue
          } catch (error) {
            logAction('updateLabels: Direct add failed, attempting to create label', {
              label,
              error: String(error)
            })
          }

          const created = await this.createRepoLabel({ name: label })
          if (!created.created) {
            failedAdds.push(label)
            logAction('updateLabels: Failed to create missing label', {
              label,
              error: created.error
            })
            continue
          }

          repoLabels.push(label)
          matchedLabel = label
        }

        try {
          await execFileAsync(
            'gh',
            [
              'issue',
              'edit',
              String(issueNumber),
              '--repo',
              `${this.owner}/${this.repo}`,
              '--add-label',
              matchedLabel
            ],
            { cwd: this.repoPath }
          )
        } catch (error) {
          failedAdds.push(label)
          logAction('updateLabels: Failed to add label', {
            label,
            matchedLabel,
            error: String(error)
          })
        }
      }
      for (const label of labelsToRemove) {
        // Find matching label in repo
        const matchedLabel = this.findMatchingLabel(label, repoLabels)
        if (matchedLabel) {
          try {
            await execFileAsync(
              'gh',
              [
                'issue',
                'edit',
                String(issueNumber),
                '--repo',
                `${this.owner}/${this.repo}`,
                '--remove-label',
                matchedLabel
              ],
              { cwd: this.repoPath }
            )
          } catch {
            // Ignore errors when removing labels (label might not be on issue)
          }
        }
      }

      if (failedAdds.length > 0) {
        logAction('updateLabels: One or more labels failed to add', { failedAdds })
        return false
      }

      return true
    } catch (error) {
      console.error('Failed to update labels:', error)
      return false
    }
  }

  async updatePRLabels(
    prNumber: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    try {
      // Fetch existing labels from the repository to match against
      const repoLabels = await this.fetchRepoLabelsInternal()
      logAction('updatePRLabels: fetched repo labels', { repoLabels, labelsToAdd, labelsToRemove })

      const failedAdds: string[] = []
      for (const label of labelsToAdd) {
        // Find matching label in repo (handles case, spaces, dashes, prefixes)
        let matchedLabel = this.findMatchingLabel(label, repoLabels)
        logAction('updatePRLabels: matching result', { original: label, matched: matchedLabel })
        if (!matchedLabel) {
          // Try adding the label by name directly first (works if fetchRepoLabels failed or matching missed).
          try {
            await execFileAsync(
              'gh',
              [
                'pr',
                'edit',
                String(prNumber),
                '--repo',
                `${this.owner}/${this.repo}`,
                '--add-label',
                label
              ],
              { cwd: this.repoPath }
            )
            continue
          } catch (error) {
            logAction('updatePRLabels: Direct add failed, attempting to create label', {
              label,
              error: String(error)
            })
          }

          const created = await this.createRepoLabel({ name: label })
          if (!created.created) {
            failedAdds.push(label)
            logAction('updatePRLabels: Failed to create missing label', {
              label,
              error: created.error
            })
            continue
          }

          repoLabels.push(label)
          matchedLabel = label
        }

        try {
          await execFileAsync(
            'gh',
            [
              'pr',
              'edit',
              String(prNumber),
              '--repo',
              `${this.owner}/${this.repo}`,
              '--add-label',
              matchedLabel
            ],
            { cwd: this.repoPath }
          )
        } catch (error) {
          failedAdds.push(label)
          logAction('updatePRLabels: Failed to add label', {
            label,
            matchedLabel,
            error: String(error)
          })
        }
      }
      for (const label of labelsToRemove) {
        // Find matching label in repo
        const matchedLabel = this.findMatchingLabel(label, repoLabels)
        if (matchedLabel) {
          try {
            await execFileAsync(
              'gh',
              [
                'pr',
                'edit',
                String(prNumber),
                '--repo',
                `${this.owner}/${this.repo}`,
                '--remove-label',
                matchedLabel
              ],
              { cwd: this.repoPath }
            )
          } catch {
            // Ignore errors when removing labels (label might not be on PR)
          }
        }
      }

      if (failedAdds.length > 0) {
        logAction('updatePRLabels: One or more labels failed to add', { failedAdds })
        return false
      }

      return true
    } catch (error) {
      console.error('Failed to update PR labels:', error)
      return false
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Comments
  // ──────────────────────────────────────────────────────────────────────────

  async commentOnIssue(issueNumber: number, comment: string): Promise<boolean> {
    try {
      await execFileAsync(
        'gh',
        [
          'issue',
          'comment',
          String(issueNumber),
          '--repo',
          `${this.owner}/${this.repo}`,
          '--body',
          comment
        ],
        { cwd: this.repoPath }
      )
      return true
    } catch (error) {
      console.error('Failed to comment on issue:', error)
      return false
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GitHub Projects V2 (IGithubAdapter)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * List all GitHub Projects V2 linked to this repository.
   * Returns array of projects with id, title, and number.
   */
  async listRepositoryProjects(): Promise<Array<{ id: string; title: string; number: number }>> {
    try {
      logAction('listRepositoryProjects: Searching for projects', {
        owner: this.owner,
        repo: this.repo
      })

      const query = `
        query($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            projectsV2(first: 20) {
              nodes {
                id
                title
                number
              }
            }
          }
        }
      `

      const { stdout } = await execFileAsync(
        'gh',
        [
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          '-F',
          `owner=${this.owner}`,
          '-F',
          `repo=${this.repo}`
        ],
        { cwd: this.repoPath }
      )

      const response = JSON.parse(stdout)
      const projects = response.data?.repository?.projectsV2?.nodes || []

      logAction('listRepositoryProjects: Found projects', { count: projects.length })
      return projects
    } catch (error) {
      console.error('Failed to list repository projects:', error)
      return []
    }
  }

  /**
   * Find the GitHub Projects V2 associated with this repository.
   * Returns the project ID if found, null otherwise.
   */
  async findRepositoryProject(): Promise<string | null> {
    try {
      logAction('findRepositoryProject: Searching for projects', {
        owner: this.owner,
        repo: this.repo
      })

      // Query projects linked to this repository
      const query = `
        query($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            projectsV2(first: 10) {
              nodes {
                id
                title
                number
              }
            }
          }
        }
      `

      const { stdout, stderr } = await execFileAsync(
        'gh',
        [
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          '-F',
          `owner=${this.owner}`,
          '-F',
          `repo=${this.repo}`
        ],
        { cwd: this.repoPath }
      )

      if (stderr) {
        logAction('findRepositoryProject: stderr', { stderr })
      }

      const response = JSON.parse(stdout)
      logAction('findRepositoryProject: Response', {
        hasData: !!response.data,
        hasRepository: !!response.data?.repository,
        projectCount: response.data?.repository?.projectsV2?.nodes?.length ?? 0
      })

      const projects = response.data?.repository?.projectsV2?.nodes

      if (!projects || projects.length === 0) {
        logAction('findRepositoryProject: No projects found for repository')
        return null
      }

      // Use the first project, or if configured, find by ID
      const configuredProjectId = this.policy.sync?.githubProjectsV2?.projectId
      if (configuredProjectId) {
        const matchingProject = projects.find((p: { id: string }) => p.id === configuredProjectId)
        if (matchingProject) {
          logAction('findRepositoryProject: Using configured project', {
            id: matchingProject.id,
            title: matchingProject.title
          })
          return matchingProject.id
        }
      }

      // Default to first project
      const project = projects[0]
      logAction('findRepositoryProject: Auto-detected project', {
        id: project.id,
        title: project.title
      })
      return project.id
    } catch (error) {
      console.error('Failed to find repository project:', error)
      return null
    }
  }

  /**
   * Fetch all project items from a GitHub Projects V2 board and build a map
   * of issue/PR number to their status field value.
   */
  async fetchProjectStatusMap(): Promise<ProjectStatusMap> {
    const projectConfig = this.policy.sync?.githubProjectsV2
    // Only respect enabled:false if the user has explicitly configured a projectId
    if (projectConfig?.enabled === false && projectConfig?.projectId) {
      this.projectStatusCache = new Map()
      return this.projectStatusCache
    }

    // Auto-detect project ID if not configured
    let projectId: string | undefined = projectConfig?.projectId
    if (!projectId) {
      const detectedId = await this.findRepositoryProject()
      if (!detectedId) {
        this.projectStatusCache = new Map()
        return this.projectStatusCache
      }
      projectId = detectedId
    }

    const statusFieldName = projectConfig?.statusFieldName || 'Status'
    const statusMap: ProjectStatusMap = new Map()

    if (!projectId) {
      this.projectStatusCache = new Map()
      return this.projectStatusCache
    }

    try {
      let hasNextPage = true
      let cursor: string | null = null

      while (hasNextPage) {
        const query = `
          query($projectId: ID!, $cursor: String) {
            node(id: $projectId) {
              ... on ProjectV2 {
                items(first: 100, after: $cursor) {
                  nodes {
                    id
                    content {
                      __typename
                      ... on Issue {
                        number
                        url
                      }
                      ... on PullRequest {
                        number
                        url
                      }
                    }
                    fieldValues(first: 20) {
                      nodes {
                        __typename
                        ... on ProjectV2ItemFieldSingleSelectValue {
                          name
                          field {
                            ... on ProjectV2SingleSelectField {
                              name
                            }
                          }
                        }
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
          }
        `

        const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `projectId=${projectId}`]
        if (cursor) args.push('-F', `cursor=${cursor}`)

        const { stdout } = await execFileAsync('gh', args, { cwd: this.repoPath })

        const response: ProjectV2Response = JSON.parse(stdout)

        if (response.errors?.length) {
          console.error('GraphQL errors fetching project items:', response.errors)
          break
        }

        const items = response.data?.node?.items
        if (!items) {
          logAction('fetchProjectStatusMap: No items found in project')
          break
        }

        for (const item of items.nodes) {
          if (!item.content?.number) continue

          // Find the status field value
          const statusField = item.fieldValues.nodes.find(
            (fv) =>
              fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
              fv.field?.name === statusFieldName
          )

          if (statusField?.name) {
            statusMap.set(item.content.number, statusField.name)
          }
        }

        hasNextPage = items.pageInfo.hasNextPage
        cursor = items.pageInfo.endCursor
      }

      logAction('fetchProjectStatusMap', { itemCount: statusMap.size })
      this.projectStatusCache = statusMap
      return statusMap
    } catch (error) {
      console.error('Failed to fetch GitHub project items:', error)
      this.projectStatusCache = new Map()
      return this.projectStatusCache
    }
  }

  /**
   * Clear the cached project status map (call before re-syncing)
   */
  clearProjectStatusCache(): void {
    this.projectStatusCache = null
  }

  /**
   * Get project status for an issue/PR number from cache or fetch if needed
   */
  async getProjectStatus(issueNumber: number): Promise<string | undefined> {
    if (this.policy.sync?.githubProjectsV2?.enabled === false) {
      return undefined
    }

    if (!this.projectStatusCache) {
      await this.fetchProjectStatusMap()
    }

    return this.projectStatusCache?.get(issueNumber)
  }

  /**
   * List draft items ("DraftIssue") from a GitHub Projects V2 board.
   * These items don't appear in `gh issue list`, so we fetch them from the project directly.
   */
  async listProjectDrafts(): Promise<Card[]> {
    const projectConfig = this.policy.sync?.githubProjectsV2
    logAction('listProjectDrafts:start', {
      enabled: projectConfig?.enabled,
      projectId: projectConfig?.projectId
    })

    // Only respect enabled:false if the user has explicitly configured a projectId
    // (meaning they set up GitHub Projects integration and then disabled it).
    // Otherwise, always try to auto-detect to handle migration from old defaults.
    if (projectConfig?.enabled === false && projectConfig?.projectId) {
      logAction('listProjectDrafts: Explicitly disabled with projectId, returning empty')
      return []
    }

    // Auto-detect project ID if not configured
    let projectId: string | undefined = projectConfig?.projectId
    if (!projectId) {
      logAction('listProjectDrafts: No projectId configured, auto-detecting...')
      const detectedId = await this.findRepositoryProject()
      if (!detectedId) {
        logAction('listProjectDrafts: No project found for repository')
        return []
      }
      projectId = detectedId
      logAction('listProjectDrafts: Using detected projectId', { projectId })
    }

    const statusFieldName = projectConfig?.statusFieldName || 'Status'
    const drafts: Card[] = []

    try {
      let hasNextPage = true
      let cursor: string | null = null

      while (hasNextPage) {
        const query = `
          query($projectId: ID!, $cursor: String) {
            node(id: $projectId) {
              ... on ProjectV2 {
                items(first: 100, after: $cursor) {
                  nodes {
                    id
                    content {
                      __typename
                      ... on DraftIssue {
                        id
                        title
                        body
                        updatedAt
                      }
                    }
                    fieldValues(first: 20) {
                      nodes {
                        __typename
                        ... on ProjectV2ItemFieldSingleSelectValue {
                          name
                          field {
                            ... on ProjectV2SingleSelectField {
                              name
                            }
                          }
                        }
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
          }
        `

        const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `projectId=${projectId}`]
        if (cursor) args.push('-F', `cursor=${cursor}`)

        const { stdout } = await execFileAsync('gh', args, { cwd: this.repoPath })
        const response: ProjectV2Response = JSON.parse(stdout)

        if (response.errors?.length) {
          console.error('GraphQL errors fetching project drafts:', response.errors)
          break
        }

        const items = response.data?.node?.items
        if (!items) {
          logAction('listProjectDrafts: No items in response', {
            hasNode: !!response.data?.node,
            nodeType: response.data?.node ? Object.keys(response.data.node) : []
          })
          break
        }

        logAction('listProjectDrafts: Processing items', {
          itemCount: items.nodes.length,
          types: items.nodes.map((i) => i.content?.__typename)
        })

        for (const item of items.nodes) {
          const content = item.content
          if (!content || content.__typename !== 'DraftIssue' || !content.id) continue

          const statusField = item.fieldValues.nodes.find(
            (fv) =>
              fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
              fv.field?.name === statusFieldName
          )

          const projectStatus = statusField?.name
          const status = this.deriveStatusFromProjectField(projectStatus) ?? 'draft'

          drafts.push({
            id: cryptoRandomId(),
            project_id: '', // set by SyncEngine
            provider: 'github',
            type: 'draft',
            title: content.title || 'Untitled draft',
            body: content.body ?? null,
            status,
            ready_eligible: status === 'ready' ? 1 : 0,
            assignees_json: JSON.stringify([]),
            labels_json: JSON.stringify([]),
            remote_url: null,
            remote_repo_key: `github:${this.owner}/${this.repo}`,
            remote_number_or_iid: `draft:${content.id}`,
            remote_node_id: content.id,
            updated_remote_at: content.updatedAt ?? null,
            updated_local_at: new Date().toISOString(),
            sync_state: 'ok',
            last_error: null,
            has_conflicts: 0
          })
        }

        hasNextPage = items.pageInfo.hasNextPage
        cursor = items.pageInfo.endCursor
      }
    } catch (error) {
      logAction('listProjectDrafts: Error', { error: String(error) })
      console.error('Failed to list GitHub Projects V2 drafts:', error)
      return []
    }

    logAction('listProjectDrafts: Complete', { count: drafts.length })
    return drafts
  }

  /**
   * Update the status field on a GitHub Projects V2 item.
   * Auto-detects the project if not configured.
   */
  async updateProjectStatus(issueNumber: number, newStatus: CardStatus): Promise<boolean> {
    const projectConfig = this.policy.sync?.githubProjectsV2
    // Only respect enabled:false if the user has explicitly configured a projectId
    if (projectConfig?.enabled === false && projectConfig?.projectId) {
      return false
    }

    // Auto-detect project ID if not configured
    let projectId: string | undefined = projectConfig?.projectId
    if (!projectId) {
      const detectedId = await this.findRepositoryProject()
      if (!detectedId) {
        return false
      }
      projectId = detectedId
    }

    try {
      const statusFieldName = (projectConfig?.statusFieldName || 'Status').trim()
      const statusField = await this.findProjectV2SingleSelectField(projectId, statusFieldName)
      if (!statusField) {
        console.error('Status field not found:', statusFieldName)
        return false
      }

      const statusValues = projectConfig?.statusValues || {}
      const targetStatusName = this.getProjectStatusValue(newStatus, statusValues)
      const statusOption = statusField.options.find(
        (o) => o.name.toLowerCase() === targetStatusName.toLowerCase()
      )
      if (!statusOption) {
        logAction('updateProjectStatus: Status option not found', { targetStatusName })
        return false
      }

      const itemId = await this.findProjectV2ItemIdByIssueNumber(projectId, issueNumber)
      if (!itemId) {
        logAction('updateProjectStatus: Issue not found in project', { issueNumber })
        return false
      }

      const updateMutation = `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(
            input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: { singleSelectOptionId: $optionId }
            }
          ) {
            projectV2Item { id }
          }
        }
      `

      const updateRes = await this.ghApiGraphql<{ errors?: Array<{ message: string }> }>(
        updateMutation,
        {
          projectId,
          itemId,
          fieldId: statusField.id,
          optionId: statusOption.id
        }
      )

      if (updateRes.errors?.length) {
        console.error('GraphQL errors updating project status:', updateRes.errors)
        return false
      }

      logAction('updateProjectStatus: Success', { issueNumber, newStatus })
      return true
    } catch (error) {
      console.error('Failed to update project status:', error)
      return false
    }
  }

  /**
   * Update the status field on a GitHub Projects V2 item whose content is a DraftIssue.
   * Uses the DraftIssue node id (GraphQL ID) to locate the project item.
   */
  async updateProjectDraftStatus(draftNodeId: string, newStatus: CardStatus): Promise<boolean> {
    const projectConfig = this.policy.sync?.githubProjectsV2
    // Only respect enabled:false if the user has explicitly configured a projectId
    if (projectConfig?.enabled === false && projectConfig?.projectId) {
      return false
    }

    // Auto-detect project ID if not configured
    let projectId: string | undefined = projectConfig?.projectId
    if (!projectId) {
      const detectedId = await this.findRepositoryProject()
      if (!detectedId) {
        return false
      }
      projectId = detectedId
    }

    try {
      const statusFieldName = (projectConfig?.statusFieldName || 'Status').trim()
      const statusField = await this.findProjectV2SingleSelectField(projectId, statusFieldName)
      if (!statusField) {
        console.error('Status field not found:', statusFieldName)
        return false
      }

      const statusValues = projectConfig?.statusValues || {}
      const targetStatusName = this.getProjectStatusValue(newStatus, statusValues)
      const statusOption = statusField.options.find(
        (o) => o.name.toLowerCase() === targetStatusName.toLowerCase()
      )
      if (!statusOption) {
        logAction('updateProjectDraftStatus: Status option not found', { targetStatusName })
        return false
      }

      const itemId = await this.findProjectV2ItemIdByDraftNodeId(projectId, draftNodeId)
      if (!itemId) {
        logAction('updateProjectDraftStatus: Draft not found in project', { draftNodeId })
        return false
      }

      const updateMutation = `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(
            input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: { singleSelectOptionId: $optionId }
            }
          ) {
            projectV2Item { id }
          }
        }
      `

      const updateRes = await this.ghApiGraphql<{ errors?: Array<{ message: string }> }>(
        updateMutation,
        {
          projectId,
          itemId,
          fieldId: statusField.id,
          optionId: statusOption.id
        }
      )

      if (updateRes.errors?.length) {
        console.error('GraphQL errors updating project draft status:', updateRes.errors)
        return false
      }

      logAction('updateProjectDraftStatus: Success', { draftNodeId, newStatus })
      return true
    } catch (error) {
      console.error('Failed to update project draft status:', error)
      return false
    }
  }

  /**
   * Update the title and body of a GitHub Projects V2 draft item (implements IGithubAdapter)
   */
  async updateProjectDraftBody(
    draftNodeId: string,
    title: string,
    body: string | null
  ): Promise<boolean> {
    const projectConfig = this.policy.sync?.githubProjectsV2
    // Only respect enabled:false if the user has explicitly configured a projectId
    if (projectConfig?.enabled === false && projectConfig?.projectId) {
      return false
    }

    // Auto-detect project ID if not configured
    let projectId: string | undefined = projectConfig?.projectId
    if (!projectId) {
      const detectedId = await this.findRepositoryProject()
      if (!detectedId) {
        return false
      }
      projectId = detectedId
    }

    try {
      // Find the item ID for this draft
      const itemId = await this.findProjectV2ItemIdByDraftNodeId(projectId, draftNodeId)
      if (!itemId) {
        logAction('updateProjectDraftBody: Draft not found in project', { draftNodeId })
        return false
      }

      // Update the draft using the updateProjectV2DraftIssue mutation
      const updateMutation = `
        mutation($draftIssueId: ID!, $title: String!, $body: String) {
          updateProjectV2DraftIssue(
            input: {
              draftIssueId: $draftIssueId
              title: $title
              body: $body
            }
          ) {
            draftIssue {
              id
              title
              body
            }
          }
        }
      `

      const updateRes = await this.ghApiGraphql<{
        data?: { updateProjectV2DraftIssue?: { draftIssue?: { id: string } } }
        errors?: Array<{ message: string }>
      }>(updateMutation, {
        draftIssueId: draftNodeId,
        title,
        body: body ?? ''
      })

      if (updateRes.errors?.length) {
        console.error('GraphQL errors updating project draft body:', updateRes.errors)
        return false
      }

      logAction('updateProjectDraftBody: Success', { draftNodeId, title })
      return true
    } catch (error) {
      console.error('Failed to update project draft body:', error)
      return false
    }
  }

  /**
   * List PR to issue links (implements IGithubAdapter)
   */
  async listPRIssueLinks(): Promise<GithubPullRequestIssueLink[]> {
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

      let cursor: string | null = null
      let hasNextPage = true

      while (hasNextPage) {
        const args = [
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          '-F',
          `owner=${this.owner}`,
          '-F',
          `repo=${this.repo}`
        ]
        if (cursor) args.push('-F', `cursor=${cursor}`)

        const { stdout } = await execFileAsync('gh', args, { cwd: this.repoPath })
        const response = JSON.parse(stdout) as {
          data?: {
            repository?: {
              pullRequests?: {
                nodes?: Array<{
                  number?: number
                  url?: string
                  closingIssuesReferences?: { nodes?: Array<{ number?: number }> }
                }>
                pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
              }
            }
          }
          errors?: Array<{ message?: string }>
        }

        if (response.errors?.length) {
          console.error('GraphQL errors fetching PR issue links:', response.errors)
          break
        }

        const prConn = response.data?.repository?.pullRequests
        const nodes = prConn?.nodes ?? []
        for (const pr of nodes) {
          const prNumber = pr.number
          const prUrl = pr.url
          if (!prNumber || !prUrl) continue

          const issueNumbers = (pr.closingIssuesReferences?.nodes ?? [])
            .map((n) => n.number)
            .filter((n): n is number => typeof n === 'number')

          if (issueNumbers.length === 0) continue

          results.push({ prNumber, prUrl, issueNumbers })
        }

        hasNextPage = !!prConn?.pageInfo?.hasNextPage
        cursor = prConn?.pageInfo?.endCursor ?? null
      }
    } catch (error) {
      console.error('Failed to fetch PR issue links:', error)
      return []
    }

    return results
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private Helper Methods
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Derive card status from GitHub Projects V2 status field value.
   * Returns undefined if no mapping is found (falls back to label-based).
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
    if (statusValues.testing && normalize(statusValues.testing) === normalizedStatus)
      return 'testing'
    if (statusValues.inReview && normalize(statusValues.inReview) === normalizedStatus)
      return 'in_review'
    if (statusValues.inProgress && normalize(statusValues.inProgress) === normalizedStatus)
      return 'in_progress'
    if (statusValues.ready && normalize(statusValues.ready) === normalizedStatus) return 'ready'
    if (statusValues.draft && normalize(statusValues.draft) === normalizedStatus) return 'draft'

    return undefined
  }

  private async ghApiGraphql<T>(
    query: string,
    variables: Record<string, string | undefined | null>
  ): Promise<T> {
    const args = ['api', 'graphql', '-f', `query=${query}`]
    for (const [key, value] of Object.entries(variables)) {
      if (value === undefined || value === null || value === '') continue
      // Use `-f` (string) instead of `-F` (type-coercing) so numeric-looking IDs
      // like singleSelectOptionId ("98236657") aren't sent as JSON numbers.
      args.push('-f', `${key}=${value}`)
    }
    const { stdout } = await execFileAsync('gh', args, { cwd: this.repoPath })
    return JSON.parse(stdout) as T
  }

  private async findProjectV2SingleSelectField(
    projectId: string,
    fieldName: string
  ): Promise<{ id: string; name: string; options: Array<{ id: string; name: string }> } | null> {
    const normalizedTarget = fieldName.trim().toLowerCase()
    if (!normalizedTarget) return null

    const query = `
      query($projectId: ID!, $after: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 50, after: $after) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options { id name }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `

    let after: string | null = null
    for (let page = 0; page < 50; page++) {
      const res = await this.ghApiGraphql<{
        data?: {
          node?: {
            fields?: {
              nodes?: Array<{
                id?: string
                name?: string
                options?: Array<{ id: string; name: string }>
              }>
              pageInfo?: { hasNextPage: boolean; endCursor: string | null }
            }
          }
        }
        errors?: Array<{ message: string }>
      }>(query, { projectId, after: after ?? undefined })

      if (res.errors?.length) {
        console.error('GraphQL errors fetching project fields:', res.errors)
        return null
      }

      const fields = res.data?.node?.fields
      const found = fields?.nodes?.find((f) => f.name?.trim().toLowerCase() === normalizedTarget)
      if (found?.id && found.name && found.options) {
        return { id: found.id, name: found.name, options: found.options }
      }

      const pageInfo = fields?.pageInfo
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break
      after = pageInfo.endCursor
    }

    return null
  }

  private async findProjectV2ItemIdByIssueNumber(
    projectId: string,
    issueNumber: number
  ): Promise<string | null> {
    const query = `
      query($projectId: ID!, $after: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              nodes {
                id
                content {
                  ... on Issue { number }
                  ... on PullRequest { number }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `

    let after: string | null = null
    for (let page = 0; page < 200; page++) {
      const res = await this.ghApiGraphql<{
        data?: {
          node?: {
            items?: {
              nodes?: Array<{ id?: string; content?: { number?: number } }>
              pageInfo?: { hasNextPage: boolean; endCursor: string | null }
            }
          }
        }
        errors?: Array<{ message: string }>
      }>(query, { projectId, after: after ?? undefined })

      if (res.errors?.length) {
        console.error('GraphQL errors fetching project items:', res.errors)
        return null
      }

      const items = res.data?.node?.items
      const found = items?.nodes?.find((i) => i.content?.number === issueNumber)
      if (found?.id) return found.id

      const pageInfo = items?.pageInfo
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break
      after = pageInfo.endCursor
    }

    return null
  }

  private async findProjectV2ItemIdByDraftNodeId(
    projectId: string,
    draftNodeId: string
  ): Promise<string | null> {
    const query = `
      query($projectId: ID!, $after: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              nodes {
                id
                content {
                  __typename
                  ... on DraftIssue { id }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `

    let after: string | null = null
    for (let page = 0; page < 200; page++) {
      const res = await this.ghApiGraphql<{
        data?: {
          node?: {
            items?: {
              nodes?: Array<{ id?: string; content?: { __typename?: string; id?: string } }>
              pageInfo?: { hasNextPage: boolean; endCursor: string | null }
            }
          }
        }
        errors?: Array<{ message: string }>
      }>(query, { projectId, after: after ?? undefined })

      if (res.errors?.length) {
        console.error('GraphQL errors fetching project items:', res.errors)
        return null
      }

      const items = res.data?.node?.items
      const found = items?.nodes?.find(
        (i) => i.content?.__typename === 'DraftIssue' && i.content?.id === draftNodeId
      )
      if (found?.id) return found.id

      const pageInfo = items?.pageInfo
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break
      after = pageInfo.endCursor
    }

    return null
  }

  /**
   * Get the project status value name for a given CardStatus
   */
  private getProjectStatusValue(
    status: CardStatus,
    statusValues: NonNullable<NonNullable<PolicyConfig['sync']>['githubProjectsV2']>['statusValues']
  ): string {
    const defaults: Record<CardStatus, string> = {
      draft: 'Backlog',
      ready: 'Ready',
      in_progress: 'In Progress',
      in_review: 'In Review',
      testing: 'Testing',
      done: 'Done'
    }

    if (!statusValues) return defaults[status]

    switch (status) {
      case 'draft':
        return statusValues.draft || defaults.draft
      case 'ready':
        return statusValues.ready || defaults.ready
      case 'in_progress':
        return statusValues.inProgress || defaults.in_progress
      case 'in_review':
        return statusValues.inReview || defaults.in_review
      case 'testing':
        return statusValues.testing || defaults.testing
      case 'done':
        return statusValues.done || defaults.done
      default:
        return defaults.draft
    }
  }

  /**
   * Fetch all labels from the GitHub repository (internal helper).
   */
  private async fetchRepoLabelsInternal(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['label', 'list', '--repo', `${this.owner}/${this.repo}`, '--json', 'name'],
        { cwd: this.repoPath }
      )
      const labels = JSON.parse(stdout) as { name: string }[]
      return labels.map((l) => l.name)
    } catch (error) {
      logAction('fetchRepoLabels: Failed to fetch labels', { error: String(error) })
      return []
    }
  }

  /**
   * Find a matching label in the repository's label list.
   * Handles variations like:
   * - "status::in-progress" vs "In progress" vs "in-progress"
   * - Case differences
   * - With or without "status::" prefix
   */
  private findMatchingLabel(targetLabel: string, repoLabels: string[]): string | null {
    // Normalize function: lowercase, remove dashes/spaces/colons, collapse to single form
    const normalize = (s: string): string => {
      return s
        .toLowerCase()
        .replace(/[-_\s]+/g, '') // Remove dashes, underscores, spaces
        .replace(/:/g, '') // Remove colons too for matching
    }

    const normalizedTarget = normalize(targetLabel)

    // First try exact match
    const exactMatch = repoLabels.find((l) => l === targetLabel)
    if (exactMatch) return exactMatch

    // Then try normalized match (full label)
    const normalizedMatch = repoLabels.find((l) => normalize(l) === normalizedTarget)
    if (normalizedMatch) return normalizedMatch

    // Try matching just the status part after "::" against all labels
    // This handles "In Progress" matching "In progress" or "in-progress"
    if (targetLabel.includes('::')) {
      const statusPart = targetLabel.split('::')[1]
      const normalizedStatus = normalize(statusPart)

      // First check labels that also have "::" prefix
      const prefixedMatch = repoLabels.find((l) => {
        if (l.includes('::')) {
          const labelStatus = l.split('::')[1]
          return normalize(labelStatus) === normalizedStatus
        }
        return false
      })
      if (prefixedMatch) return prefixedMatch

      // Then check labels WITHOUT "::" prefix (e.g., "In progress" matches "In Progress")
      const unprefixedMatch = repoLabels.find((l) => {
        if (!l.includes('::')) {
          return normalize(l) === normalizedStatus
        }
        return false
      })
      if (unprefixedMatch) return unprefixedMatch
    }

    return null
  }

  /**
   * Convert a GitHub issue to a Card.
   */
  private issueToCard(issue: GithubIssue, projectStatus?: string): Card {
    const labels = issue.labels.map((l) => l.name)
    const isClosed = issue.state === 'closed'

    // Priority: Projects V2 status > label-based status
    const projectDerivedStatus = this.deriveStatusFromProjectField(projectStatus)
    const status = isClosed ? 'done' : (projectDerivedStatus ?? this.deriveStatus(labels, isClosed))

    return {
      id: cryptoRandomId(),
      project_id: '', // Will be set by caller
      provider: 'github',
      type: 'issue',
      title: issue.title,
      body: issue.body,
      status,
      ready_eligible: this.isReadyEligible(labels, status) ? 1 : 0,
      assignees_json: JSON.stringify(issue.assignees.map((a) => a.login)),
      labels_json: JSON.stringify(labels),
      remote_url: issue.url || issue.html_url || null,
      remote_repo_key: `github:${this.owner}/${this.repo}`,
      remote_number_or_iid: String(issue.number),
      remote_node_id: issue.node_id,
      updated_remote_at: issue.updatedAt || issue.updated_at || null,
      updated_local_at: new Date().toISOString(),
      sync_state: 'ok',
      last_error: null,
      has_conflicts: 0
    }
  }

  /**
   * Convert a GitHub PR to a Card.
   */
  private prToCard(pr: GithubPR, projectStatus?: string): Card {
    const labels = pr.labels.map((l) => l.name)
    const isDraft = pr.isDraft ?? pr.draft ?? false
    // GitHub CLI returns state as uppercase: OPEN, CLOSED, MERGED
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

    return {
      id: cryptoRandomId(),
      project_id: '', // Will be set by caller
      provider: 'github',
      type: 'pr',
      title: pr.title,
      body: pr.body,
      status,
      ready_eligible: 0, // PRs are not ready eligible
      assignees_json: JSON.stringify(pr.assignees.map((a) => a.login)),
      labels_json: JSON.stringify(labels),
      remote_url: pr.url || pr.html_url || null,
      remote_repo_key: `github:${this.owner}/${this.repo}`,
      remote_number_or_iid: String(pr.number),
      remote_node_id: pr.node_id,
      updated_remote_at: pr.updatedAt || pr.updated_at || null,
      updated_local_at: new Date().toISOString(),
      sync_state: 'ok',
      last_error: null,
      has_conflicts: 0
    }
  }
}
