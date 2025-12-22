import { GithubAdapter } from '../adapters/github'
import { GitlabAdapter } from '../adapters/gitlab'
import {
  getProject,
  listCards,
  upsertCard,
  getCardByRemote,
  updateCardSyncState,
  updateProjectSyncTime,
  updateProjectPolicyJson,
  setSyncCursor,
  updateJobState,
  getJob,
  createEvent,
  ensureCardLink
} from '../db'
import type { Project, Card, CardStatus, PolicyConfig } from '../../shared/types'

export class SyncEngine {
  private projectId: string
  private project: Project | null = null
  private policy: PolicyConfig
  private adapter: GithubAdapter | GitlabAdapter | null = null

  constructor(projectId: string) {
    this.projectId = projectId
    this.policy = {
      version: 1,
      sync: {
        readyLabel: 'ready',
        statusLabels: {
          draft: 'status::draft',
          ready: 'status::ready',
          inProgress: 'status::in-progress',
          inReview: 'status::in-review',
          testing: 'status::testing',
          done: 'status::done'
        }
      }
    }
  }

  async initialize(): Promise<boolean> {
    console.log(`[SyncEngine] initialize project=${this.projectId}`)
    this.project = getProject(this.projectId)
    if (!this.project) {
      console.error('Project not found:', this.projectId)
      return false
    }

    if (!this.project.remote_repo_key) {
      console.error('No remote configured for project:', this.projectId)
      return false
    }

    // Load policy
    if (this.project.policy_json) {
      try {
        this.policy = JSON.parse(this.project.policy_json)
      } catch {
        console.warn('Failed to parse policy, using defaults')
      }
    }

    // Initialize adapter based on provider
    const provider = this.project.provider_hint || this.detectProvider(this.project.remote_repo_key)

    if (provider === 'github') {
      this.adapter = new GithubAdapter(
        this.project.local_path,
        this.project.remote_repo_key,
        this.policy
      )
    } else if (provider === 'gitlab') {
      this.adapter = new GitlabAdapter(
        this.project.local_path,
        this.project.remote_repo_key,
        this.policy
      )
    } else {
      console.error('Unknown provider for:', this.project.remote_repo_key)
      return false
    }

    return true
  }

  private detectProvider(repoKey: string): 'github' | 'gitlab' | 'unknown' {
    if (repoKey.startsWith('github:')) return 'github'
    if (repoKey.startsWith('gitlab:')) return 'gitlab'
    return 'unknown'
  }

  async runPollSync(): Promise<{ success: boolean; cardsUpdated: number; error?: string }> {
    if (!this.adapter || !this.project) {
      return { success: false, cardsUpdated: 0, error: 'Not initialized' }
    }

    try {
      console.log(`[SyncEngine] runPollSync start project=${this.projectId}`)
      // Check auth first
      const auth = await this.adapter.checkAuth()
      if (!auth.authenticated) {
        console.warn(`[SyncEngine] auth failed project=${this.projectId} error=${auth.error}`)
        return { success: false, cardsUpdated: 0, error: auth.error || 'Not authenticated' }
      }

      // Fetch all issues and PRs/MRs
      let remoteCards: Card[] = []

      if (this.adapter instanceof GithubAdapter) {
        // Persist auto-detected Projects V2 ID so we don't re-discover every sync.
        if (this.policy.sync?.githubProjectsV2?.enabled !== false) {
          const existingProjectId = this.policy.sync?.githubProjectsV2?.projectId
          if (!existingProjectId) {
            const detectedId = await this.adapter.findRepositoryProject()
            if (detectedId) {
              this.policy.sync = this.policy.sync ?? {}
              this.policy.sync.githubProjectsV2 = this.policy.sync.githubProjectsV2 ?? {}
              this.policy.sync.githubProjectsV2.projectId = detectedId
              updateProjectPolicyJson(this.projectId, JSON.stringify(this.policy))
              this.project.policy_json = JSON.stringify(this.policy)
            }
          }
        }

        // Clear project status cache to ensure fresh data
        this.adapter.clearProjectStatusCache()
        const [issues, prs, drafts] = await Promise.all([
          this.adapter.listIssues(),
          this.adapter.listPRs(),
          this.adapter.listProjectDrafts()
        ])
        remoteCards = [...issues, ...prs, ...drafts]
      } else if (this.adapter instanceof GitlabAdapter) {
        const [issues, mrs] = await Promise.all([
          this.adapter.listIssues(),
          this.adapter.listMRs()
        ])
        remoteCards = [...issues, ...mrs]
      }

      // Sync each card
      let cardsUpdated = 0
      for (const remoteCard of remoteCards) {
        const updated = await this.syncCard(remoteCard)
        if (updated) cardsUpdated++
      }

      // After cards are present locally, link issues to their related PRs (GitHub only)
      if (this.adapter instanceof GithubAdapter) {
        await this.syncGithubIssuePrLinks()
      }

      // Update project sync time
      updateProjectSyncTime(this.projectId)

      // Update cursor
      setSyncCursor(
        this.projectId,
        this.project.provider_hint || 'auto',
        'last_poll',
        new Date().toISOString()
      )

      console.log(`[SyncEngine] runPollSync done project=${this.projectId} updated=${cardsUpdated}`)
      return { success: true, cardsUpdated }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[SyncEngine] runPollSync error project=${this.projectId}: ${errorMsg}`)
      return { success: false, cardsUpdated: 0, error: errorMsg }
    }
  }

  private async syncCard(remoteCard: Card): Promise<boolean> {
    if (!this.project) return false

    // Check if card already exists
    const existingCard = getCardByRemote(
      this.projectId,
      remoteCard.remote_repo_key || '',
      remoteCard.remote_number_or_iid || ''
    )

    if (existingCard) {
      // Update if remote is newer OR if important fields changed (Projects V2 status changes
      // don't always bump Issue/PR updatedAt).
      const remoteTime = new Date(remoteCard.updated_remote_at || 0).getTime()
      const localTime = new Date(existingCard.updated_remote_at || 0).getTime()

      const shouldUpdate =
        remoteTime > localTime ||
        remoteCard.status !== existingCard.status ||
        remoteCard.ready_eligible !== existingCard.ready_eligible ||
        remoteCard.title !== existingCard.title ||
        (remoteCard.body ?? null) !== (existingCard.body ?? null) ||
        (remoteCard.labels_json ?? null) !== (existingCard.labels_json ?? null) ||
        (remoteCard.assignees_json ?? null) !== (existingCard.assignees_json ?? null) ||
        (remoteCard.remote_url ?? null) !== (existingCard.remote_url ?? null) ||
        (remoteCard.remote_node_id ?? null) !== (existingCard.remote_node_id ?? null) ||
        (remoteCard.type ?? null) !== (existingCard.type ?? null)

      if (shouldUpdate) {
        upsertCard({
          ...existingCard,
          type: remoteCard.type,
          title: remoteCard.title,
          body: remoteCard.body,
          status: remoteCard.status,
          ready_eligible: remoteCard.ready_eligible,
          assignees_json: remoteCard.assignees_json,
          labels_json: remoteCard.labels_json,
          remote_url: remoteCard.remote_url,
          remote_node_id: remoteCard.remote_node_id,
          updated_remote_at: remoteCard.updated_remote_at,
          updated_local_at: new Date().toISOString(),
          sync_state: 'ok'
        })
        return true
      }
      return false
    }

    // Create new card
    upsertCard({
      ...remoteCard,
      project_id: this.projectId,
      sync_state: 'ok'
    })

    createEvent(this.projectId, 'synced', remoteCard.id, {
      action: 'card_imported',
      number: remoteCard.remote_number_or_iid
    })

    return true
  }

  private async syncGithubIssuePrLinks(): Promise<void> {
    if (!this.adapter || !(this.adapter instanceof GithubAdapter) || !this.project?.remote_repo_key) {
      return
    }

    try {
      const localCards = listCards(this.projectId)
      const issueCardIdByNumber = new Map<number, string>()

      for (const card of localCards) {
        if (card.type !== 'issue') continue
        const n = card.remote_number_or_iid ? Number.parseInt(card.remote_number_or_iid, 10) : NaN
        if (Number.isNaN(n)) continue
        issueCardIdByNumber.set(n, card.id)
      }

      if (issueCardIdByNumber.size === 0) return

      const links = await this.adapter.listPRIssueLinks()
      for (const link of links) {
        for (const issueNumber of link.issueNumbers) {
          const issueCardId = issueCardIdByNumber.get(issueNumber)
          if (!issueCardId) continue
          ensureCardLink(
            issueCardId,
            'pr',
            link.prUrl,
            this.project.remote_repo_key,
            String(link.prNumber)
          )
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.warn(`[SyncEngine] syncGithubIssuePrLinks failed project=${this.projectId}: ${errorMsg}`)
    }
  }

  async pushStatusChange(cardId: string, newStatus: CardStatus): Promise<boolean> {
    if (!this.adapter || !this.project) {
      return false
    }

    const cards = listCards(this.projectId)
    const card = cards.find((c) => c.id === cardId)
    if (!card || !card.remote_number_or_iid) {
      return false
    }

    console.log(`[SyncEngine] pushStatusChange card=${cardId} status=${newStatus}`)
    const issueNumber = parseInt(card.remote_number_or_iid, 10)
    if (isNaN(issueNumber)) {
      if (
        this.adapter instanceof GithubAdapter &&
        card.type === 'draft' &&
        this.policy.sync?.githubProjectsV2?.enabled !== false &&
        card.remote_node_id
      ) {
        try {
          const success = await this.adapter.updateProjectDraftStatus(card.remote_node_id, newStatus)
          if (success) {
            updateCardSyncState(cardId, 'ok')
            createEvent(this.projectId, 'synced', cardId, {
              action: 'status_pushed',
              status: newStatus
            })
            console.log(`[SyncEngine] pushStatusChange via Projects V2 (draft) success card=${cardId}`)
            return true
          }
          updateCardSyncState(cardId, 'error', 'Failed to update project draft status')
          return false
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          updateCardSyncState(cardId, 'error', errorMsg)
          console.error(`[SyncEngine] pushStatusChange error card=${cardId}: ${errorMsg}`)
          return false
        }
      }

      return false
    }

    try {
      let success = false

      // If GitHub Projects V2 is not explicitly disabled, try to update project status
      if (this.adapter instanceof GithubAdapter && this.policy.sync?.githubProjectsV2?.enabled !== false) {
        success = await this.adapter.updateProjectStatus(issueNumber, newStatus)
        if (success) {
          console.log(`[SyncEngine] pushStatusChange via Projects V2 success card=${cardId}`)
        } else {
          console.warn(`[SyncEngine] pushStatusChange via Projects V2 failed, falling back to labels`)
        }
      }

      // Always apply label-based status as well (Projects V2 sync alone doesn't update issue labels).
      const newLabel = this.adapter.getStatusLabel(newStatus)
      const allStatusLabels = this.adapter.getAllStatusLabels()
      const labelsToRemove = allStatusLabels.filter((l) => l !== newLabel)
      const labelsToAdd = [newLabel]
      const labelsUpdated = await this.adapter.updateLabels(issueNumber, labelsToAdd, labelsToRemove)
      success = labelsUpdated

      if (success) {
        updateCardSyncState(cardId, 'ok')
        createEvent(this.projectId, 'synced', cardId, {
          action: 'status_pushed',
          status: newStatus
        })
        console.log(`[SyncEngine] pushStatusChange success card=${cardId}`)
      } else {
        updateCardSyncState(cardId, 'error', 'Failed to update status')
        console.warn(`[SyncEngine] pushStatusChange failed card=${cardId}`)
      }

      return success
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      updateCardSyncState(cardId, 'error', errorMsg)
      console.error(`[SyncEngine] pushStatusChange error card=${cardId}: ${errorMsg}`)
      return false
    }
  }

  async processJob(jobId: string): Promise<boolean> {
    const job = getJob(jobId)
    if (!job) return false

    const initialized = await this.initialize()
    if (!initialized) {
      updateJobState(jobId, 'failed', undefined, 'Failed to initialize sync engine')
      return false
    }

    try {
      if (job.type === 'sync_poll') {
        const result = await this.runPollSync()
        if (result.success) {
          updateJobState(jobId, 'succeeded', { cardsUpdated: result.cardsUpdated })
        } else {
          updateJobState(jobId, 'failed', undefined, result.error)
        }
        return result.success
      }

      if (job.type === 'sync_push' && job.card_id) {
        const payload = job.payload_json ? JSON.parse(job.payload_json) : {}
        const success = await this.pushStatusChange(job.card_id, payload.status)
        if (success) {
          updateJobState(jobId, 'succeeded')
        } else {
          updateJobState(jobId, 'failed', undefined, 'Failed to push status change')
        }
        return success
      }

      return false
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      updateJobState(jobId, 'failed', undefined, errorMsg)
      return false
    }
  }
}

export async function runSync(projectId: string): Promise<{ success: boolean; error?: string }> {
  const engine = new SyncEngine(projectId)
  const initialized = await engine.initialize()
  if (!initialized) {
    return { success: false, error: 'Failed to initialize sync engine' }
  }

  const result = await engine.runPollSync()
  return { success: result.success, error: result.error }
}
