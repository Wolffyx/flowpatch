import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Card, CardStatus, PolicyConfig, RepoLabel } from '../../shared/types'
import { cryptoRandomId } from '../db'

const execFileAsync = promisify(execFile)

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

export class GitlabAdapter {
  private repoPath: string
  private host: string
  private projectPath: string
  private policy: PolicyConfig

  constructor(repoPath: string, repoKey: string, policy: PolicyConfig) {
    this.repoPath = repoPath
    // Parse repoKey like "gitlab:gitlab.com/group/repo"
    const keyWithoutPrefix = repoKey.replace(/^gitlab:/, '')
    const parts = keyWithoutPrefix.split('/')
    this.host = parts[0]
    this.projectPath = parts.slice(1).join('/')
    this.policy = policy
  }

  async checkAuth(): Promise<{ authenticated: boolean; username?: string; error?: string }> {
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

  async createRepoLabel(label: RepoLabel): Promise<{ created: boolean; error?: string }> {
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

  async createIssue(
    title: string,
    description?: string
  ): Promise<{ iid: number; url: string; card: Card } | null> {
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

      return { iid, url, card }
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

      return { iid, url, card }
    } catch (error) {
      console.error('Failed to create GitLab issue:', error)
      return null
    }
  }

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

  async updateLabels(
    issueIid: number,
    labelsToAdd: string[],
    labelsToRemove: string[]
  ): Promise<boolean> {
    try {
      if (labelsToAdd.length > 0) {
        await execFileAsync(
          'glab',
          ['issue', 'update', String(issueIid), '--label', labelsToAdd.join(',')],
          { cwd: this.repoPath }
        )
      }
      if (labelsToRemove.length > 0) {
        await execFileAsync(
          'glab',
          ['issue', 'update', String(issueIid), '--unlabel', labelsToRemove.join(',')],
          { cwd: this.repoPath }
        )
      }
      return true
    } catch (error) {
      console.error('Failed to update labels:', error)
      return false
    }
  }

  async createMR(
    title: string,
    description: string,
    sourceBranch: string,
    targetBranch = 'main'
  ): Promise<{ iid: number; url: string } | null> {
    try {
      const { stdout } = await execFileAsync(
        'glab',
        [
          'mr',
          'create',
          '--title',
          title,
          '--description',
          description,
          '--source-branch',
          sourceBranch,
          '--target-branch',
          targetBranch,
          '-F',
          'json'
        ],
        { cwd: this.repoPath }
      )

      const result = JSON.parse(stdout)
      return { iid: result.iid, url: result.web_url }
    } catch (error) {
      console.error('Failed to create MR:', error)
      return null
    }
  }

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
      last_error: null
    }
  }

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
      last_error: null
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
    const normalized = (labels || []).map(normalize)
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
