import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Card, CardStatus, PolicyConfig, RepoLabel } from '@shared/types'
import { cryptoRandomId } from '../db'
import { logAction } from '@shared/utils'

const execFileAsync = promisify(execFile)

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

export class GithubAdapter {
  private repoPath: string
  private owner: string
  private repo: string
  private policy: PolicyConfig
  private projectStatusCache: ProjectStatusMap | null = null

  constructor(repoPath: string, repoKey: string, policy: PolicyConfig) {
    this.repoPath = repoPath
    // Parse repoKey like "github:owner/repo"
    const parts = repoKey.replace('github:', '').split('/')
    this.owner = parts[0]
    this.repo = parts[1]
    this.policy = policy
  }

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

  async createRepoLabel(label: RepoLabel): Promise<{ created: boolean; error?: string }> {
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

  /**
   * Find the GitHub Projects V2 associated with this repository.
   * Returns the project ID if found, null otherwise.
   */
  async findRepositoryProject(): Promise<string | null> {
    try {
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
    if (projectConfig?.enabled === false) {
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

  async checkAuth(): Promise<{ authenticated: boolean; username?: string; error?: string }> {
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

  async listIssues(): Promise<Card[]> {
    try {
      // Pre-fetch project statuses once (auto-detects project if not explicitly disabled)
      const projectConfig = this.policy.sync?.githubProjectsV2
      if (projectConfig?.enabled !== false && !this.projectStatusCache) {
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

  async listPRs(): Promise<Card[]> {
    try {
      // Pre-fetch project statuses if not already fetched (auto-detects project)
      const projectConfig = this.policy.sync?.githubProjectsV2
      if (projectConfig?.enabled !== false && !this.projectStatusCache) {
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

  /**
   * List draft items ("DraftIssue") from a GitHub Projects V2 board.
   * These items don't appear in `gh issue list`, so we fetch them from the project directly.
   */
  async listProjectDrafts(): Promise<Card[]> {
    const projectConfig = this.policy.sync?.githubProjectsV2
    if (projectConfig?.enabled === false) {
      return []
    }

    // Auto-detect project ID if not configured
    let projectId: string | undefined = projectConfig?.projectId
    if (!projectId) {
      const detectedId = await this.findRepositoryProject()
      if (!detectedId) {
        return []
      }
      projectId = detectedId
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
          break
        }

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
      console.error('Failed to list GitHub Projects V2 drafts:', error)
      return []
    }

    return drafts
  }

  async updateLabels(
    issueNumber: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    try {
      // Fetch existing labels from the repository to match against
      const repoLabels = await this.fetchRepoLabels()
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

  /**
   * Fetch all labels from the GitHub repository.
   */
  private async fetchRepoLabels(): Promise<string[]> {
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
    // This handles "status::in-progress" matching "In progress" or "in-progress"
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

      // Then check labels WITHOUT "::" prefix (e.g., "In progress" matches "status::in-progress")
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
   * Update the status field on a GitHub Projects V2 item.
   * Auto-detects the project if not configured.
   */
  async updateProjectStatus(issueNumber: number, newStatus: CardStatus): Promise<boolean> {
    const projectConfig = this.policy.sync?.githubProjectsV2
    if (projectConfig?.enabled === false) {
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
    if (projectConfig?.enabled === false) {
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

  async createPR(
    title: string,
    body: string,
    branch: string,
    baseBranch = 'main'
  ): Promise<{ number: number; url: string } | null> {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
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
        ],
        { cwd: this.repoPath }
      )

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
  ): Promise<{ number: number; url: string; card: Card } | null> {
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

  private prToCard(pr: GithubPR, projectStatus?: string): Card {
    const labels = pr.labels.map((l) => l.name)
    const isDraft = pr.isDraft ?? pr.draft ?? false
    const isClosed = pr.state === 'closed' || pr.state === 'merged'

    // Priority: closed state > PR draft state > Projects V2 status > label-based status
    let status: CardStatus
    if (isClosed) {
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

  private deriveStatus(labels: string[], isClosed: boolean): CardStatus {
    if (isClosed) return 'done'
    const statusLabels = this.policy.sync?.statusLabels || {
      draft: 'status::draft',
      ready: 'status::ready',
      inProgress: 'status::in-progress',
      inReview: 'status::in-review',
      testing: 'status::testing',
      done: 'status::done'
    }

    // Normalize strings by lowercasing and removing spaces to handle:
    // - CamelCase: "InProgress", "InReview"
    // - Title case with spaces: "In Progress", "In Review"
    // - Lowercase with spaces: "in progress", "in review"
    const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

    const normalized = labels.map(normalize)
    const matches = (candidates: (string | undefined)[]): boolean =>
      candidates.filter(Boolean).some((c) => normalized.includes(normalize(String(c))))
    logAction('deriveStatus', matches)

    if (matches([statusLabels.done, 'done', 'indone'])) return 'done'
    if (matches([statusLabels.testing, 'testing', 'qa'])) return 'testing'
    if (matches([statusLabels.inReview, 'inreview', 'in review', 'review'])) return 'in_review'
    if (matches([statusLabels.inProgress, 'inprogress', 'in progress', 'wip'])) return 'in_progress'
    if (matches([statusLabels.ready, 'ready'])) return 'ready'

    const readyLabel = this.policy.sync?.readyLabel || 'ready'
    if (matches([readyLabel])) return 'ready'

    return 'draft'
  }

  private isReadyEligible(labels: string[], status: CardStatus): boolean {
    if (status === 'ready') return true
    const readyLabel = this.policy.sync?.readyLabel || 'ready'
    return labels.includes(readyLabel)
  }

  getStatusLabel(status: CardStatus): string {
    const statusLabels = this.policy.sync?.statusLabels || {}
    switch (status) {
      case 'draft':
        return statusLabels.draft || 'status::draft'
      case 'ready':
        return statusLabels.ready || 'status::ready'
      case 'in_progress':
        return statusLabels.inProgress || 'status::in-progress'
      case 'in_review':
        return statusLabels.inReview || 'status::in-review'
      case 'testing':
        return statusLabels.testing || 'status::testing'
      case 'done':
        return statusLabels.done || 'status::done'
      default:
        return 'status::draft'
    }
  }

  getAllStatusLabels(): string[] {
    const statusLabels = this.policy.sync?.statusLabels || {}
    return [
      statusLabels.draft || 'status::draft',
      statusLabels.ready || 'status::ready',
      statusLabels.inProgress || 'status::in-progress',
      statusLabels.inReview || 'status::in-review',
      statusLabels.testing || 'status::testing',
      statusLabels.done || 'status::done'
    ]
  }
}
