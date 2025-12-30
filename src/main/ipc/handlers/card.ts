/**
 * IPC handlers for card operations.
 * Handles: moveCard, createTestCard, createCard
 */

import { ipcMain } from 'electron'
import {
  getProject,
  getCard,
  createLocalTestCard,
  updateCardStatus,
  updateCardLabels,
  upsertCard,
  createEvent,
  createJob,
  getActiveWorkerJobForCard,
  cancelJob,
  updateJobState,
  checkCanMoveToStatus
} from '../../db'
import { SyncEngine } from '../../sync/engine'
import { GithubAdapter } from '../../adapters/github'
import { GitlabAdapter } from '../../adapters/gitlab'
import {
  parsePolicyJson,
  getStatusLabelFromPolicy,
  getAllStatusLabelsFromPolicy,
  logAction
} from '@shared/utils'
import type { CardStatus } from '@shared/types'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerCardHandlers(notifyRenderer: () => void): void {
  // Create test card (legacy - for simple local cards)
  ipcMain.handle('createTestCard', (_e, payload: { projectId: string; title: string }) => {
    logAction('createTestCard', payload)
    const card = createLocalTestCard(payload.projectId, payload.title)
    createEvent(payload.projectId, 'card_created', card.id, { title: payload.title })
    logAction('createTestCard:success', { cardId: card.id })
    notifyRenderer()
    return { card }
  })

  // Create card with type selection (local or GitHub issue)
  ipcMain.handle(
    'createCard',
    async (
      _e,
      payload: {
        projectId: string
        title: string
        body?: string
        createType: 'local' | 'repo_issue' | 'github_issue' | 'gitlab_issue'
      }
    ) => {
      logAction('createCard', payload)
      const project = getProject(payload.projectId)
      if (!project) {
        return { error: 'Project not found' }
      }

      if (payload.createType === 'local') {
        // Create local card
        const card = createLocalTestCard(payload.projectId, payload.title)
        // Update body if provided
        if (payload.body) {
          upsertCard({ ...card, body: payload.body })
        }
        createEvent(payload.projectId, 'card_created', card.id, {
          title: payload.title,
          type: 'local'
        })
        logAction('createCard:local:success', { cardId: card.id })
        notifyRenderer()
        return { card }
      }

      const createType =
        payload.createType === 'repo_issue'
          ? project.remote_repo_key?.startsWith('github:')
            ? 'github_issue'
            : project.remote_repo_key?.startsWith('gitlab:')
              ? 'gitlab_issue'
              : null
          : payload.createType

      if (createType === 'github_issue') {
        if (!project.remote_repo_key?.startsWith('github:')) {
          return { error: 'GitHub remote not configured for this project' }
        }

        // Parse policy
        const policy = parsePolicyJson(project.policy_json)

        // Create GitHub adapter
        const adapter = new GithubAdapter(project.local_path, project.remote_repo_key, policy)

        // Check auth
        const authResult = await adapter.checkAuth()
        if (!authResult.authenticated) {
          return { error: `GitHub authentication failed: ${authResult.error || 'Not logged in'}` }
        }

        // Create the issue on GitHub
        const result = await adapter.createIssue(payload.title, payload.body)
        if (!result) {
          return { error: 'Failed to create GitHub issue' }
        }

        // Store the card in our database
        const card = upsertCard({
          ...result.card,
          project_id: payload.projectId
        })

        createEvent(payload.projectId, 'card_created', card.id, {
          title: payload.title,
          type: 'github_issue',
          issueNumber: result.number,
          url: result.url
        })

        logAction('createCard:github:success', {
          cardId: card.id,
          issueNumber: result.number,
          url: result.url
        })
        notifyRenderer()
        return { card, issueNumber: result.number, url: result.url }
      }

      if (createType === 'gitlab_issue') {
        if (!project.remote_repo_key?.startsWith('gitlab:')) {
          return { error: 'GitLab remote not configured for this project' }
        }

        const policy = parsePolicyJson(project.policy_json)
        const adapter = new GitlabAdapter(project.local_path, project.remote_repo_key, policy)

        const authResult = await adapter.checkAuth()
        if (!authResult.authenticated) {
          return { error: `GitLab authentication failed: ${authResult.error || 'Not logged in'}` }
        }

        const result = await adapter.createIssue(payload.title, payload.body || undefined)
        if (!result) {
          return { error: 'Failed to create GitLab issue' }
        }

        const card = upsertCard({
          ...result.card,
          project_id: payload.projectId
        })

        createEvent(payload.projectId, 'card_created', card.id, {
          title: payload.title,
          type: 'gitlab_issue',
          issueNumber: result.iid,
          url: result.url
        })

        logAction('createCard:gitlab:success', {
          cardId: card.id,
          issueNumber: result.iid,
          url: result.url
        })
        notifyRenderer()
        return { card, issueNumber: result.iid, url: result.url }
      }

      return { error: 'Invalid createType' }
    }
  )

  // Move card
  ipcMain.handle(
    'moveCard',
    async (
      _e,
      payload: {
        cardId: string
        status: CardStatus
        skipDependencyCheck?: boolean
      }
    ) => {
      // Check dependencies unless explicitly skipped
      if (!payload.skipDependencyCheck) {
        const dependencyCheck = checkCanMoveToStatus(payload.cardId, payload.status)
        if (!dependencyCheck.canMove) {
          logAction('moveCard:blocked_by_dependencies', {
            cardId: payload.cardId,
            targetStatus: payload.status,
            blockedBy: dependencyCheck.blockedBy.map((b) => b.depends_on_card_id)
          })
          return {
            card: null,
            error: dependencyCheck.reason ?? 'Blocked by dependencies',
            blockedByDependencies: dependencyCheck.blockedBy
          }
        }
      }

      const before = getCard(payload.cardId)
      const card = updateCardStatus(payload.cardId, payload.status)
      if (card) {
        logAction('moveCard', payload)
        createEvent(card.project_id, 'status_changed', card.id, {
          from: before?.status,
          to: payload.status
        })

        // Update local labels to reflect new status
        const project = getProject(card.project_id)
        if (project) {
          const policy = parsePolicyJson(project.policy_json)

          // Get current labels
          const currentLabels: string[] = card.labels_json ? JSON.parse(card.labels_json) : []

          // Get status label configuration
          const newStatusLabel = getStatusLabelFromPolicy(payload.status, policy)
          const allStatusLabels = getAllStatusLabelsFromPolicy(policy)

          // Replace old status labels with new one
          const filteredLabels = currentLabels.filter((l) => !allStatusLabels.includes(l))
          const updatedLabels = [...filteredLabels, newStatusLabel]

          // Update in database
          updateCardLabels(card.id, JSON.stringify(updatedLabels))
        }

        // If the user moves a card out of Ready/In Progress, cancel any active worker job for it.
        if (
          payload.status === 'draft' ||
          payload.status === 'in_review' ||
          payload.status === 'testing' ||
          payload.status === 'done'
        ) {
          const activeJob = getActiveWorkerJobForCard(payload.cardId)
          if (activeJob) {
            cancelJob(activeJob.id, `Canceled: moved to ${payload.status}`)
            createEvent(card.project_id, 'worker_run', card.id, {
              jobId: activeJob.id,
              action: 'canceled',
              reason: `moved_to_${payload.status}`
            })
          }
        }

        // Queue async remote sync in background (fire-and-forget for fast UI response)
        if (card.remote_repo_key) {
          const projectId = card.project_id
          const cardId = payload.cardId
          const status = payload.status

          setImmediate(async () => {
            const job = createJob(projectId, 'sync_push', cardId, { status })
            try {
              const engine = new SyncEngine(projectId)
              const initialized = await engine.initialize()
              if (initialized) {
                const success = await engine.pushStatusChange(cardId, status)
                updateJobState(job.id, success ? 'succeeded' : 'failed')
                logAction('moveCard:pushStatus', { cardId, success })
              } else {
                updateJobState(job.id, 'failed', undefined, 'Failed to initialize sync engine')
                logAction('moveCard:pushStatus:init_failed', { cardId })
              }
            } catch (error) {
              updateJobState(job.id, 'failed', undefined, String(error))
              logAction('moveCard:pushStatus:error', { cardId, error: String(error) })
            }
            notifyRenderer() // Notify when sync completes
          })
        }
      }
      notifyRenderer()
      return { card }
    }
  )
}
