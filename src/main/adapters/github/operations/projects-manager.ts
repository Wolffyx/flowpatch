/**
 * GitHub Projects Manager
 * Handles all GitHub Projects V2 operations
 */

import type { Card, CardStatus, PolicyConfig } from '@shared/types'
import { cryptoRandomId } from '../../../db'
import { logAction } from '@shared/utils'
import type { GithubCLIWrapper } from '../helpers/cli-wrapper'
import type { GithubGraphQLClient } from '../helpers/graphql-client'
import type { ProjectStatusMap, ProjectV2Response } from '../types'

/**
 * Manages GitHub Projects V2 operations
 */
export class GithubProjectsManager {
  private projectStatusCache: ProjectStatusMap | null = null

  constructor(
    private owner: string,
    private repo: string,
    private policy: PolicyConfig,
    private cli: GithubCLIWrapper,
    private graphql: GithubGraphQLClient
  ) {}

  /**
   * List all GitHub Projects V2 linked to this repository
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

      const [owner, repo] = this.cli.repoIdentifier.split('/')
      const response = await this.graphql.query<{
        data?: {
          repository?: {
            projectsV2?: {
              nodes?: Array<{ id: string; title: string; number: number }>
            }
          }
        }
      }>(query, { owner, repo })

      const projects = response.data?.repository?.projectsV2?.nodes || []
      logAction('listRepositoryProjects: Found projects', { count: projects.length })
      return projects
    } catch (error) {
      console.error('Failed to list repository projects:', error)
      return []
    }
  }

  /**
   * Find the GitHub Projects V2 associated with this repository
   */
  async findRepositoryProject(): Promise<string | null> {
    try {
      logAction('findRepositoryProject: Searching for projects', {
        owner: this.owner,
        repo: this.repo
      })

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

      const [owner, repo] = this.cli.repoIdentifier.split('/')
      const response = await this.graphql.query<{
        data?: {
          repository?: {
            projectsV2?: {
              nodes?: Array<{ id: string; title: string; number: number }>
            }
          }
        }
      }>(query, { owner, repo })

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
        const matchingProject = projects.find((p) => p.id === configuredProjectId)
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
   * Get project ID (auto-detect if not configured)
   */
  private async getProjectId(): Promise<string | null> {
    const projectConfig = this.policy.sync?.githubProjectsV2
    let projectId: string | undefined = projectConfig?.projectId

    if (!projectId) {
      const detectedId = await this.findRepositoryProject()
      if (!detectedId) {
        return null
      }
      projectId = detectedId
    }

    return projectId
  }

  /**
   * Check if Projects V2 is enabled
   */
  private isEnabled(): boolean {
    const projectConfig = this.policy.sync?.githubProjectsV2
    // Only respect enabled:false if the user has explicitly configured a projectId
    return !(projectConfig?.enabled === false && projectConfig?.projectId)
  }

  /**
   * Fetch all project items and build a map of issue/PR number to their status field value
   */
  async fetchProjectStatusMap(): Promise<ProjectStatusMap> {
    if (!this.isEnabled()) {
      this.projectStatusCache = new Map()
      return this.projectStatusCache
    }

    const projectId = await this.getProjectId()
    if (!projectId) {
      this.projectStatusCache = new Map()
      return this.projectStatusCache
    }

    const projectConfig = this.policy.sync?.githubProjectsV2
    const statusFieldName = projectConfig?.statusFieldName || 'Status'
    const statusMap: ProjectStatusMap = new Map()

    try {
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

      const items = await this.graphql.paginatedQuery(
        query,
        { projectId },
        (response: ProjectV2Response) => ({
          items: response.data?.node?.items?.nodes ?? [],
          pageInfo: response.data?.node?.items?.pageInfo ?? {
            hasNextPage: false,
            endCursor: null
          }
        })
      )

      for (const item of items) {
        if (!item.content?.number) continue

        const statusField = item.fieldValues.nodes.find(
          (fv) =>
            fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
            fv.field?.name === statusFieldName
        )

        if (statusField?.name) {
          statusMap.set(item.content.number, statusField.name)
        }
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
   * Clear the cached project status map
   */
  clearProjectStatusCache(): void {
    this.projectStatusCache = null
  }

  /**
   * Get the current status cache (for use by other operations)
   */
  getStatusCache(): ProjectStatusMap | null {
    return this.projectStatusCache
  }

  /**
   * Get project status for an issue/PR number from cache or fetch if needed
   */
  async getProjectStatus(issueNumber: number): Promise<string | undefined> {
    if (!this.isEnabled()) {
      return undefined
    }

    if (!this.projectStatusCache) {
      await this.fetchProjectStatusMap()
    }

    return this.projectStatusCache?.get(issueNumber)
  }

  /**
   * List draft items ("DraftIssue") from a GitHub Projects V2 board
   */
  async listProjectDrafts(): Promise<Card[]> {
    const projectConfig = this.policy.sync?.githubProjectsV2
    logAction('listProjectDrafts:start', {
      enabled: projectConfig?.enabled,
      projectId: projectConfig?.projectId
    })

    if (!this.isEnabled()) {
      logAction('listProjectDrafts: Explicitly disabled with projectId, returning empty')
      return []
    }

    const projectId = await this.getProjectId()
    if (!projectId) {
      logAction('listProjectDrafts: No project found for repository')
      return []
    }

    const statusFieldName = projectConfig?.statusFieldName || 'Status'
    const drafts: Card[] = []

    try {
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

      const items = await this.graphql.paginatedQuery(
        query,
        { projectId },
        (response: ProjectV2Response) => ({
          items: response.data?.node?.items?.nodes ?? [],
          pageInfo: response.data?.node?.items?.pageInfo ?? {
            hasNextPage: false,
            endCursor: null
          }
        })
      )

      logAction('listProjectDrafts: Processing items', {
        itemCount: items.length,
        types: items.map((i) => i.content?.__typename)
      })

      for (const item of items) {
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
    } catch (error) {
      logAction('listProjectDrafts: Error', { error: String(error) })
      console.error('Failed to list GitHub Projects V2 drafts:', error)
      return []
    }

    logAction('listProjectDrafts: Complete', { count: drafts.length })
    return drafts
  }

  /**
   * Update the status field on a GitHub Projects V2 item
   */
  async updateProjectStatus(issueNumber: number, newStatus: CardStatus): Promise<boolean> {
    if (!this.isEnabled()) {
      return false
    }

    const projectId = await this.getProjectId()
    if (!projectId) {
      return false
    }

    try {
      const projectConfig = this.policy.sync?.githubProjectsV2
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

      const updateRes = await this.graphql.query<{ errors?: Array<{ message: string }> }>(
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
   * Update the status field on a GitHub Projects V2 draft item
   */
  async updateProjectDraftStatus(draftNodeId: string, newStatus: CardStatus): Promise<boolean> {
    if (!this.isEnabled()) {
      return false
    }

    const projectId = await this.getProjectId()
    if (!projectId) {
      return false
    }

    try {
      const projectConfig = this.policy.sync?.githubProjectsV2
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

      const updateRes = await this.graphql.query<{ errors?: Array<{ message: string }> }>(
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
   * Update the title and body of a GitHub Projects V2 draft item
   */
  async updateProjectDraftBody(
    draftNodeId: string,
    title: string,
    body: string | null
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      return false
    }

    const projectId = await this.getProjectId()
    if (!projectId) {
      return false
    }

    try {
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

      const updateRes = await this.graphql.query<{
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
   * Find a ProjectV2 single select field by name
   */
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

    const found = await this.graphql.findOne(
      query,
      { projectId },
      (response: any) => ({
        items: response.data?.node?.fields?.nodes ?? [],
        pageInfo: response.data?.node?.fields?.pageInfo ?? {
          hasNextPage: false,
          endCursor: null
        }
      }),
      (field: any) => field.name?.trim().toLowerCase() === normalizedTarget,
      50
    )

    if (found?.id && found.name && found.options) {
      return { id: found.id, name: found.name, options: found.options }
    }

    return null
  }

  /**
   * Find a project item ID by issue/PR number
   */
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

    const found = await this.graphql.findOne(
      query,
      { projectId },
      (response: any) => ({
        items: response.data?.node?.items?.nodes ?? [],
        pageInfo: response.data?.node?.items?.pageInfo ?? {
          hasNextPage: false,
          endCursor: null
        }
      }),
      (item: any) => item.content?.number === issueNumber,
      200
    )

    return found?.id ?? null
  }

  /**
   * Find a project item ID by draft node ID
   */
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

    const found = await this.graphql.findOne(
      query,
      { projectId },
      (response: any) => ({
        items: response.data?.node?.items?.nodes ?? [],
        pageInfo: response.data?.node?.items?.pageInfo ?? {
          hasNextPage: false,
          endCursor: null
        }
      }),
      (item: any) => item.content?.__typename === 'DraftIssue' && item.content?.id === draftNodeId,
      200
    )

    return found?.id ?? null
  }

  /**
   * Derive card status from GitHub Projects V2 status field value
   */
  private deriveStatusFromProjectField(projectStatus: string | undefined): CardStatus | undefined {
    if (!projectStatus) return undefined

    const statusValues = this.policy.sync?.githubProjectsV2?.statusValues
    if (!statusValues) {
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

    const normalize = (s: string): string => s.toLowerCase().trim()
    const normalizedStatus = normalize(projectStatus)

    if (statusValues.done && normalize(statusValues.done) === normalizedStatus) return 'done'
    if (statusValues.testing && normalize(statusValues.testing) === normalizedStatus) return 'testing'
    if (statusValues.inReview && normalize(statusValues.inReview) === normalizedStatus)
      return 'in_review'
    if (statusValues.inProgress && normalize(statusValues.inProgress) === normalizedStatus)
      return 'in_progress'
    if (statusValues.ready && normalize(statusValues.ready) === normalizedStatus) return 'ready'
    if (statusValues.draft && normalize(statusValues.draft) === normalizedStatus) return 'draft'

    return undefined
  }

  /**
   * Get the project status value name for a given CardStatus
   */
  private getProjectStatusValue(
    status: CardStatus,
    statusValues: NonNullable<
      NonNullable<PolicyConfig['sync']>['githubProjectsV2']
    >['statusValues']
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
}
