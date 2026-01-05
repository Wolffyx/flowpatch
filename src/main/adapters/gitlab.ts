/**
 * GitlabAdapter - Adapter for GitLab repositories.
 *
 * Implements IRepoAdapter interface, providing full GitLab API integration
 * via the glab CLI tool.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Card, CardStatus, PolicyConfig, Provider, RepoLabel } from '../../shared/types'
import { cryptoRandomId } from '../db'
import { BaseAdapter } from './base'
import type { AuthResult, IssueResult, LabelResult, PRResult } from './types'

const execFileAsync = promisify(execFile)

// ============================================================================
// GitLab-specific Types
// ============================================================================

interface GitlabIssue {
  iid: number
  title: string
  description: string | null
  state: string
  web_url: string
  labels: string[]
  assignees: { username: string }[]
  updated_at: string
}

interface GitlabMR {
  iid: number
  title: string
  description: string | null
  state: string
  web_url: string
  labels: string[]
  assignees: { username: string }[]
  updated_at: string
  draft: boolean
}

// ============================================================================
// GitlabAdapter Class
// ============================================================================

export class GitlabAdapter extends BaseAdapter {
  // IRepoAdapter properties
  readonly provider: Provider = 'gitlab'
  readonly providerKey = 'gitlab'
  readonly isLocal = false

  // GitLab-specific properties
  private host: string
  private projectPath: string

  constructor(repoPath: string, repoKey: string, policy: PolicyConfig) {
    super(repoPath, repoKey, policy)
    // Parse repoKey like "gitlab:gitlab.com/group/repo"
    const keyWithoutPrefix = repoKey.replace(/^gitlab:/, '')
    const parts = keyWithoutPrefix.split('/')
    this.host = parts[0]
    this.projectPath = parts.slice(1).join('/')
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Authentication
  // ──────────────────────────────────────────────────────────────────────────

  async checkAuth(): Promise<AuthResult> {
    try {
      const { stdout } = await execFileAsync('glab', ['auth', 'status'], {
        cwd: this.repoPath
      })
      // Parse the output to extract username
      const match = stdout.match(/Logged in to .+ as (\S+)/)
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
      const { stdout } = await execFileAsync(
        'glab',
        ['issue', 'list', '--all', '-F', 'json', '-P', '100'],
        { cwd: this.repoPath }
      )

      const issues: GitlabIssue[] = JSON.parse(stdout)
      return issues.map((issue) => this.issueToCard(issue))
    } catch (error) {
      console.error('Failed to list GitLab issues:', error)
      return []
    }
  }

  async getIssue(issueIid: number): Promise<Card | null> {
    try {
      const { stdout } = await execFileAsync(
        'glab',
        ['issue', 'view', String(issueIid), '-F', 'json'],
        { cwd: this.repoPath }
      )

      const issue: GitlabIssue = JSON.parse(stdout)
      return this.issueToCard(issue)
    } catch (error) {
      console.error('Failed to get issue:', error)
      return null
    }
  }

  async createIssue(
    title: string,
    description?: string,
    _labels?: string[]
  ): Promise<IssueResult | null> {
    const trimmedTitle = (title || '').trim()
    if (!trimmedTitle) return null

    const argsJson = ['issue', 'create', '--title', trimmedTitle, '-F', 'json']
    if (description) {
      argsJson.push('--description', description)
    }

    try {
      const { stdout } = await execFileAsync('glab', argsJson, { cwd: this.repoPath })
      const created = JSON.parse(stdout) as { iid?: number; web_url?: string }
      const iid = created.iid
      const url = (created.web_url || '').trim()
      if (!iid || !url) return null

      const card = await this.getIssue(iid)
      if (!card) return null

      return { number: iid, url, card }
    } catch {
      // Fallback: parse URL from non-JSON output
    }

    try {
      const args = ['issue', 'create', '--title', trimmedTitle]
      if (description) {
        args.push('--description', description)
      }

      const { stdout } = await execFileAsync('glab', args, { cwd: this.repoPath })
      const out = stdout.trim()
      const urlMatch = out.match(/https?:\/\/\S+/)
      const url = urlMatch ? urlMatch[0] : ''
      const iidMatch = url.match(/\/issues\/(\d+)(?:\D|$)/)
      if (!iidMatch) return null
      const iid = parseInt(iidMatch[1], 10)
      if (!iid || !url) return null

      const card = await this.getIssue(iid)
      if (!card) return null

      return { number: iid, url, card }
    } catch (error) {
      console.error('Failed to create GitLab issue:', error)
      return null
    }
  }

  /**
   * Update the body/description of an issue (implements IRepoAdapter)
   */
  async updateIssueBody(issueIid: number, body: string | null): Promise<boolean> {
    try {
      const args = [
        'issue',
        'update',
        String(issueIid),
        '--description',
        body ?? ''
      ]

      await execFileAsync('glab', args, { cwd: this.repoPath })
      console.log(`[GitLabAdapter] updateIssueBody: Success iid=${issueIid}`)
      return true
    } catch (error) {
      console.error('Failed to update GitLab issue body:', error)
      return false
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Merge Requests (Pull Requests)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * List all merge requests (implements IRepoAdapter.listPullRequests)
   */
  async listPullRequests(): Promise<Card[]> {
    return this.listMRs()
  }

  /**
   * List all merge requests (legacy method name, kept for compatibility)
   */
  async listMRs(): Promise<Card[]> {
    try {
      const { stdout } = await execFileAsync(
        'glab',
        ['mr', 'list', '--all', '-F', 'json', '-P', '100'],
        { cwd: this.repoPath }
      )

      const mrs: GitlabMR[] = JSON.parse(stdout)
      return mrs.map((mr) => this.mrToCard(mr))
    } catch (error) {
      console.error('Failed to list GitLab MRs:', error)
      return []
    }
  }

  /**
   * Create a merge request (implements IRepoAdapter.createPullRequest)
   */
  async createPullRequest(
    title: string,
    body: string,
    branch: string,
    baseBranch = 'main',
    labels?: string[]
  ): Promise<PRResult | null> {
    return this.createMR(title, body, branch, baseBranch, labels)
  }

  /**
   * Create a merge request (legacy method name, kept for compatibility)
   */
  async createMR(
    title: string,
    description: string,
    sourceBranch: string,
    targetBranch = 'main',
    labels?: string[]
  ): Promise<PRResult | null> {
    try {
      const args = [
        'mr',
        'create',
        '--title',
        title,
        '--description',
        description,
        '--source-branch',
        sourceBranch,
        '--target-branch',
        targetBranch
      ]

      // Add labels if provided
      if (labels && labels.length > 0) {
        args.push('--label', labels.join(','))
      }

      args.push('-F', 'json')

      const { stdout } = await execFileAsync('glab', args, { cwd: this.repoPath })

      const result = JSON.parse(stdout)
      return { number: result.iid, url: result.web_url }
    } catch (error) {
      console.error('Failed to create MR:', error)
      return null
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Labels
  // ──────────────────────────────────────────────────────────────────────────

  async listRepoLabels(): Promise<RepoLabel[]> {
    try {
      const { stdout } = await execFileAsync('glab', ['label', 'list', '-F', 'json'], {
        cwd: this.repoPath
      })
      const labels = JSON.parse(stdout) as Array<{
        name: string
        description?: string
        color?: string
      }>
      return labels.map((l) => ({ name: l.name, description: l.description, color: l.color }))
    } catch {
      return []
    }
  }

  async createRepoLabel(label: RepoLabel): Promise<LabelResult> {
    const name = (label.name || '').trim()
    if (!name) return { created: false, error: 'Label name is required' }

    const args = ['label', 'create', '--name', name]
    if (label.description) args.push('--description', label.description)
    if (label.color) args.push('--color', label.color)

    try {
      await execFileAsync('glab', args, { cwd: this.repoPath })
      return { created: true }
    } catch (error) {
      return { created: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async updateLabels(
    issueIid: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    try {
      // Consolidate into a single call when both add and remove are needed
      const args = ['issue', 'update', String(issueIid)]
      if (labelsToAdd.length > 0) {
        args.push('--label', labelsToAdd.join(','))
      }
      if (labelsToRemove.length > 0) {
        args.push('--unlabel', labelsToRemove.join(','))
      }
      if (args.length > 3) {
        // Only execute if there are labels to add or remove
        await execFileAsync('glab', args, { cwd: this.repoPath })
      }
      return true
    } catch (error) {
      console.error('Failed to update labels:', error)
      return false
    }
  }

  async updatePRLabels(
    mrIid: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    try {
      // Consolidate into a single call when both add and remove are needed
      const args = ['mr', 'update', String(mrIid)]
      if (labelsToAdd.length > 0) {
        args.push('--label', labelsToAdd.join(','))
      }
      if (labelsToRemove.length > 0) {
        args.push('--unlabel', labelsToRemove.join(','))
      }
      if (args.length > 3) {
        // Only execute if there are labels to add or remove
        await execFileAsync('glab', args, { cwd: this.repoPath })
      }
      return true
    } catch (error) {
      console.error('Failed to update MR labels:', error)
      return false
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Comments
  // ──────────────────────────────────────────────────────────────────────────

  async commentOnIssue(issueIid: number, comment: string): Promise<boolean> {
    try {
      await execFileAsync('glab', ['issue', 'note', String(issueIid), '--message', comment], {
        cwd: this.repoPath
      })
      return true
    } catch (error) {
      console.error('Failed to comment on issue:', error)
      return false
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private Helper Methods
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Convert a GitLab issue to a Card.
   */
  private issueToCard(issue: GitlabIssue): Card {
    const labels = issue.labels || []
    const status = this.deriveStatus(labels, issue.state === 'closed')

    return {
      id: cryptoRandomId(),
      project_id: '', // Will be set by caller
      provider: 'gitlab',
      type: 'issue',
      title: issue.title,
      body: issue.description,
      status,
      ready_eligible: this.isReadyEligible(labels, status) ? 1 : 0,
      assignees_json: JSON.stringify(issue.assignees?.map((a) => a.username) || []),
      labels_json: JSON.stringify(labels),
      remote_url: issue.web_url,
      remote_repo_key: `gitlab:${this.host}/${this.projectPath}`,
      remote_number_or_iid: String(issue.iid),
      remote_node_id: null,
      updated_remote_at: issue.updated_at,
      updated_local_at: new Date().toISOString(),
      sync_state: 'ok',
      last_error: null,
      has_conflicts: 0
    }
  }

  /**
   * Convert a GitLab MR to a Card.
   */
  private mrToCard(mr: GitlabMR): Card {
    const labels = mr.labels || []
    let status = this.deriveStatus(labels, mr.state === 'closed' || mr.state === 'merged')

    // MRs are typically in review
    if (status === 'draft' && !mr.draft) {
      status = 'in_review'
    }

    return {
      id: cryptoRandomId(),
      project_id: '', // Will be set by caller
      provider: 'gitlab',
      type: 'mr',
      title: mr.title,
      body: mr.description,
      status,
      ready_eligible: 0, // MRs are not ready eligible
      assignees_json: JSON.stringify(mr.assignees?.map((a) => a.username) || []),
      labels_json: JSON.stringify(labels),
      remote_url: mr.web_url,
      remote_repo_key: `gitlab:${this.host}/${this.projectPath}`,
      remote_number_or_iid: String(mr.iid),
      remote_node_id: null,
      updated_remote_at: mr.updated_at,
      updated_local_at: new Date().toISOString(),
      sync_state: 'ok',
      last_error: null,
      has_conflicts: (mr as unknown as { has_conflicts?: boolean }).has_conflicts ? 1 : 0
    }
  }
}
