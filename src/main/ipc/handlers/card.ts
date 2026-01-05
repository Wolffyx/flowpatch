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
  checkCanMoveToStatus,
  deleteCard
} from '../../db'
import { SyncEngine } from '../../sync/engine'
import { triggerProjectSync } from '../../sync/scheduler'
import { AdapterRegistry, isGithubAdapter } from '../../adapters'
import type { IGithubAdapter } from '../../adapters'
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

      if (createType === 'github_issue' || createType === 'gitlab_issue') {
        const expectedPrefix = createType === 'github_issue' ? 'github:' : 'gitlab:'
        if (!project.remote_repo_key?.startsWith(expectedPrefix)) {
          const provider = createType === 'github_issue' ? 'GitHub' : 'GitLab'
          return { error: `${provider} remote not configured for this project` }
        }

        // Parse policy and create adapter via registry
        const policy = parsePolicyJson(project.policy_json)
        const adapter = AdapterRegistry.create({
          repoKey: project.remote_repo_key,
          providerHint: project.provider_hint,
          repoPath: project.local_path,
          policy
        })

        // Check auth
        const authResult = await adapter.checkAuth()
        if (!authResult.authenticated) {
          const provider = createType === 'github_issue' ? 'GitHub' : 'GitLab'
          return { error: `${provider} authentication failed: ${authResult.error || 'Not logged in'}` }
        }

        // Create the issue via unified interface
        const result = await adapter.createIssue(payload.title, payload.body || undefined)
        if (!result) {
          const provider = createType === 'github_issue' ? 'GitHub' : 'GitLab'
          return { error: `Failed to create ${provider} issue` }
        }

        // Store the card in our database
        const card = upsertCard({
          ...result.card,
          project_id: payload.projectId
        })

        createEvent(payload.projectId, 'card_created', card.id, {
          title: payload.title,
          type: createType,
          issueNumber: result.number,
          url: result.url
        })

        logAction(`createCard:${adapter.providerKey}:success`, {
          cardId: card.id,
          issueNumber: result.number,
          url: result.url
        })
        notifyRenderer()
        return { card, issueNumber: result.number, url: result.url }
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

            // Trigger a full poll sync to catch any remote changes (debounced)
            triggerProjectSync(projectId)
          })
        }
      }
      notifyRenderer()
      return { card }
    }
  )

  // Edit card body/description
  ipcMain.handle(
    'editCardBody',
    async (
      _e,
      payload: {
        cardId: string
        body: string | null
      }
    ) => {
      logAction('editCardBody', { cardId: payload.cardId })
      const card = getCard(payload.cardId)
      if (!card) {
        return { error: 'Card not found' }
      }

      const project = getProject(card.project_id)

      // Update the card body locally
      const updatedCard = upsertCard({
        ...card,
        body: payload.body,
        sync_state: card.remote_repo_key ? 'pending' : 'ok'
      })

      createEvent(card.project_id, 'card_updated', card.id, {
        field: 'body',
        action: 'edit'
      })

      // Push body update to remote asynchronously
      if (project?.remote_repo_key && card.remote_repo_key) {
        setImmediate(async () => {
          try {
            const policy = parsePolicyJson(project.policy_json)
            const adapter = AdapterRegistry.create({
              repoKey: project.remote_repo_key,
              providerHint: project.provider_hint,
              repoPath: project.local_path,
              policy
            })

            const authResult = await adapter.checkAuth()
            if (!authResult.authenticated) {
              logAction('editCardBody:remotePush:notAuthenticated', { cardId: payload.cardId })
              return
            }

            let success = false

            // For GitHub Projects V2 draft items, use the special draft update method
            if (card.type === 'draft' && card.remote_node_id && isGithubAdapter(adapter)) {
              const githubAdapter = adapter as IGithubAdapter
              success = await githubAdapter.updateProjectDraftBody(
                card.remote_node_id,
                card.title,
                payload.body
              )
            }
            // For issues and PRs/MRs, use the standard updateIssueBody method
            else if (card.remote_number_or_iid && (card.type === 'issue' || card.type === 'pr' || card.type === 'mr')) {
              const issueNumber = parseInt(card.remote_number_or_iid, 10)
              if (!isNaN(issueNumber)) {
                success = await adapter.updateIssueBody(issueNumber, payload.body)
              }
            }

            if (success) {
              upsertCard({ ...updatedCard, sync_state: 'ok' })
              logAction('editCardBody:remotePush:success', { cardId: payload.cardId, type: card.type })
            } else {
              logAction('editCardBody:remotePush:failed', { cardId: payload.cardId, type: card.type })
            }
            notifyRenderer()
          } catch (error) {
            logAction('editCardBody:remotePush:error', {
              cardId: payload.cardId,
              error: String(error)
            })
          }
        })
      }

      logAction('editCardBody:success', { cardId: payload.cardId })
      notifyRenderer()
      return { card: updatedCard }
    }
  )

  // Delete card (local and optionally remote)
  ipcMain.handle(
    'deleteCard',
    async (
      _e,
      payload: {
        cardId: string
        deleteRemote?: boolean
      }
    ) => {
      logAction('deleteCard', payload)
      const card = getCard(payload.cardId)
      if (!card) {
        return { error: 'Card not found' }
      }

      const projectId = card.project_id
      const project = getProject(projectId)

      // Cancel any active worker job for this card
      const activeJob = getActiveWorkerJobForCard(payload.cardId)
      if (activeJob) {
        cancelJob(activeJob.id, 'Card deleted')
      }

      // If card has remote and user wants to delete remote, attempt remote deletion
      if (payload.deleteRemote && card.remote_repo_key && card.remote_number_or_iid && project) {
        try {
          const policy = parsePolicyJson(project.policy_json)
          const adapter = AdapterRegistry.create({
            repoKey: project.remote_repo_key,
            providerHint: project.provider_hint,
            repoPath: project.local_path,
            policy
          })

          const authResult = await adapter.checkAuth()
          if (authResult.authenticated) {
            const issueNumber = parseInt(card.remote_number_or_iid, 10)
            if (!isNaN(issueNumber)) {
              // Note: GitHub/GitLab APIs don't allow deleting issues directly,
              // but we can close them. For now, we just delete locally.
              // In the future, we could add closeIssue to the adapter interface.
              logAction('deleteCard:remote_deletion_not_supported', { cardId: payload.cardId })
            }
          }
        } catch (error) {
          logAction('deleteCard:remote_error', { cardId: payload.cardId, error: String(error) })
          // Continue with local deletion even if remote fails
        }
      }

      // Create event before deletion (so we have the card info)
      createEvent(projectId, 'card_deleted', payload.cardId, {
        title: card.title,
        type: card.type,
        remoteNumber: card.remote_number_or_iid
      })

      // Delete the card locally (cascade will handle related records)
      const deleted = deleteCard(payload.cardId)
      if (!deleted) {
        return { error: 'Failed to delete card' }
      }

      logAction('deleteCard:success', { cardId: payload.cardId })
      notifyRenderer()
      return { success: true }
    }
  )
}
