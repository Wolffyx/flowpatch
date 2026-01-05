import { AdapterRegistry, isGithubAdapter } from '../adapters'
import type { IRepoAdapter, IGithubAdapter } from '../adapters'
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
  ensureCardLink,
  listCardLinks,
  deleteCard
} from '../db'
import type { Project, Card, CardStatus, PolicyConfig } from '../../shared/types'

export class SyncEngine {
  private projectId: string
  private project: Project | null = null
  private policy: PolicyConfig
  private adapter: IRepoAdapter | null = null

  constructor(projectId: string) {
    this.projectId = projectId
    this.policy = {
      version: 1,
      sync: {
        readyLabel: 'ready',
        statusLabels: {
          draft: 'Draft',
          ready: 'Ready',
          inProgress: 'In Progress',
          inReview: 'In Review',
          testing: 'Testing',
          done: 'Done'
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

    // Initialize adapter via registry
    try {
      this.adapter = AdapterRegistry.create({
        repoKey: this.project.remote_repo_key,
        providerHint: this.project.provider_hint,
        repoPath: this.project.local_path,
        policy: this.policy
      })
    } catch (error) {
      console.error('Failed to create adapter:', error)
      return false
    }

    return true
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

      if (isGithubAdapter(this.adapter)) {
        const githubAdapter = this.adapter as IGithubAdapter
        // Persist auto-detected Projects V2 ID so we don't re-discover every sync.
        if (this.policy.sync?.githubProjectsV2?.enabled !== false) {
          const existingProjectId = this.policy.sync?.githubProjectsV2?.projectId
          if (!existingProjectId) {
            const detectedId = await githubAdapter.findRepositoryProject()
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
        githubAdapter.clearProjectStatusCache()
        const [issues, prs, drafts] = await Promise.all([
          githubAdapter.listIssues(),
          githubAdapter.listPullRequests(),
          githubAdapter.listProjectDrafts()
        ])
        remoteCards = [...issues, ...prs, ...drafts]
      } else {
        // GitLab or other adapters
        const [issues, prs] = await Promise.all([
          this.adapter.listIssues(),
          this.adapter.listPullRequests()
        ])
        remoteCards = [...issues, ...prs]
      }

      // Sync each card
      let cardsUpdated = 0
      for (const remoteCard of remoteCards) {
        const updated = await this.syncCard(remoteCard)
        if (updated) cardsUpdated++
      }

      // Detect and handle remote deletions
      const deletedCount = await this.detectRemoteDeletions(remoteCards)
      if (deletedCount > 0) {
        console.log(`[SyncEngine] Detected ${deletedCount} remotely deleted cards`)
      }

      // After cards are present locally, link issues to their related PRs (GitHub only)
      if (isGithubAdapter(this.adapter)) {
        await this.syncGithubIssuePrLinks(this.adapter as IGithubAdapter)
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

  private async syncGithubIssuePrLinks(githubAdapter: IGithubAdapter): Promise<void> {
    if (!this.project?.remote_repo_key) {
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

      const links = await githubAdapter.listPRIssueLinks()
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
      console.warn(
        `[SyncEngine] syncGithubIssuePrLinks failed project=${this.projectId}: ${errorMsg}`
      )
    }
  }

  /**
   * Detect cards that exist locally but have been deleted from the remote.
   * When detected, delete them from the local database.
   */
  private async detectRemoteDeletions(remoteCards: Card[]): Promise<number> {
    if (!this.project?.remote_repo_key) {
      return 0
    }

    // Build a set of remote identifiers for quick lookup
    const remoteIdentifiers = new Set<string>()
    for (const remoteCard of remoteCards) {
      if (remoteCard.remote_repo_key && remoteCard.remote_number_or_iid) {
        remoteIdentifiers.add(`${remoteCard.remote_repo_key}:${remoteCard.remote_number_or_iid}`)
      }
    }

    // Get all local cards with remote references
    const localCards = listCards(this.projectId)
    const cardsToDelete: Card[] = []

    for (const localCard of localCards) {
      // Skip local-only cards (no remote reference)
      if (!localCard.remote_repo_key || !localCard.remote_number_or_iid) {
        continue
      }

      // Skip cards from different remotes (multi-remote support)
      if (localCard.remote_repo_key !== this.project.remote_repo_key) {
        continue
      }

      const localIdentifier = `${localCard.remote_repo_key}:${localCard.remote_number_or_iid}`

      // If card exists locally but not in remote list, it was deleted remotely
      if (!remoteIdentifiers.has(localIdentifier)) {
        cardsToDelete.push(localCard)
      }
    }

    // Delete the cards that were removed from remote
    let deletedCount = 0
    for (const card of cardsToDelete) {
      try {
        // Create event before deletion
        createEvent(this.projectId, 'card_deleted', card.id, {
          title: card.title,
          type: card.type,
          remoteNumber: card.remote_number_or_iid,
          reason: 'remote_deleted'
        })

        // Delete the card locally
        const deleted = deleteCard(card.id)
        if (deleted) {
          deletedCount++
          console.log(
            `[SyncEngine] Deleted locally: ${card.type} #${card.remote_number_or_iid} (${card.title}) - removed from remote`
          )
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error(
          `[SyncEngine] Failed to delete card ${card.id}: ${errorMsg}`
        )
      }
    }

    return deletedCount
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
        isGithubAdapter(this.adapter) &&
        card.type === 'draft' &&
        this.policy.sync?.githubProjectsV2?.enabled !== false &&
        card.remote_node_id
      ) {
        const githubAdapter = this.adapter as IGithubAdapter
        try {
          const success = await githubAdapter.updateProjectDraftStatus(
            card.remote_node_id,
            newStatus
          )
          if (success) {
            updateCardSyncState(cardId, 'ok')
            createEvent(this.projectId, 'synced', cardId, {
              action: 'status_pushed',
              status: newStatus
            })
            console.log(
              `[SyncEngine] pushStatusChange via Projects V2 (draft) success card=${cardId}`
            )
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
      if (
        isGithubAdapter(this.adapter) &&
        this.policy.sync?.githubProjectsV2?.enabled !== false
      ) {
        const githubAdapter = this.adapter as IGithubAdapter
        success = await githubAdapter.updateProjectStatus(issueNumber, newStatus)
        if (success) {
          console.log(`[SyncEngine] pushStatusChange via Projects V2 success card=${cardId}`)
        } else {
          console.warn(
            `[SyncEngine] pushStatusChange via Projects V2 failed, falling back to labels`
          )
        }
      }

      // Always apply label-based status as well (Projects V2 sync alone doesn't update issue labels).
      const newLabel = this.adapter.getStatusLabel(newStatus)
      const allStatusLabels = this.adapter.getAllStatusLabels()
      const labelsToRemove = allStatusLabels.filter((l) => l !== newLabel)
      const labelsToAdd = [newLabel]
      const labelsUpdated = await this.adapter.updateLabels(
        issueNumber,
        labelsToAdd,
        labelsToRemove
      )
      success = labelsUpdated

      // Also update PR labels if card has a linked PR/MR
      if (success) {
        const cardLinks = listCardLinks(cardId)
        const prLink = cardLinks.find((link) => link.linked_type === 'pr' || link.linked_type === 'mr')
        if (prLink?.linked_number_or_iid) {
          const prNumber = parseInt(prLink.linked_number_or_iid, 10)
          if (!isNaN(prNumber)) {
            const prLabelsUpdated = await this.adapter.updatePRLabels(
              prNumber,
              labelsToAdd,
              labelsToRemove
            )
            if (prLabelsUpdated) {
              console.log(`[SyncEngine] pushStatusChange PR labels updated prNumber=${prNumber}`)
            } else {
              console.warn(`[SyncEngine] pushStatusChange PR labels failed prNumber=${prNumber}`)
            }
          }
        }
      }

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
