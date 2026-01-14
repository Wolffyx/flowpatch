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
  deleteCard,
  createCardDependency
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
import type { Card, CardStatus } from '@shared/types'

function appendUniqueLines(body: string | null, lines: string[]): string {
  const trimmed = (body ?? '').trim()
  const existing = trimmed ? trimmed.split(/\r?\n/) : []
  const toAdd = lines.filter((line) => line.trim() && !existing.includes(line))
  if (toAdd.length === 0) return trimmed
  if (!trimmed) return toAdd.join('\n')
  return `${trimmed}\n\n${toAdd.join('\n')}`
}

function buildParentBacklink(card: { title: string; remote_number_or_iid: string | null; remote_url: string | null }): string[] {
  const issueRef = card.remote_number_or_iid ? `#${card.remote_number_or_iid} ${card.title}` : card.title
  const label = card.remote_number_or_iid ? `Parent issue: ${issueRef}` : `Parent card: ${issueRef}`
  const lines = [label]
  if (card.remote_url) lines.push(card.remote_url)
  return lines
}

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

  // Split card into multiple new cards
  ipcMain.handle(
    'splitCard',
    async (
      _e,
      payload: {
        cardId: string
        items: Array<{ title: string; body?: string }>
      }
    ) => {
      logAction('splitCard', { cardId: payload.cardId })

      const parent = getCard(payload.cardId)
      if (!parent) {
        return { error: 'Card not found' }
      }

      const project = getProject(parent.project_id)
      if (!project) {
        return { error: 'Project not found' }
      }

      const items = (payload.items || []).filter((item) => item?.title?.trim())
      if (items.length === 0) {
        return { error: 'At least one card title is required' }
      }

      const createType: 'local' | 'repo_issue' =
        parent.remote_repo_key ? 'repo_issue' : 'local'

      const policy = parsePolicyJson(project.policy_json)
      const adapter =
        createType === 'repo_issue'
          ? AdapterRegistry.create({
              repoKey: project.remote_repo_key!,
              providerHint: project.provider_hint,
              repoPath: project.local_path,
              policy
            })
          : null

      if (adapter) {
        const authResult = await adapter.checkAuth()
        if (!authResult.authenticated) {
          const provider = adapter.providerKey === 'gitlab' ? 'GitLab' : 'GitHub'
          return { error: `${provider} authentication failed: ${authResult.error || 'Not logged in'}` }
        }
      }

      const createdCards: Card[] = []
      const childIssueNumbers: string[] = []

      for (const item of items) {
        const backlinkLines = buildParentBacklink(parent)
        const bodyWithBacklink = appendUniqueLines(item.body ?? null, backlinkLines)

        if (createType === 'local') {
          const card = createLocalTestCard(project.id, item.title.trim())
          const updatedCard = bodyWithBacklink ? upsertCard({ ...card, body: bodyWithBacklink }) : card
          createEvent(project.id, 'card_created', card.id, {
            title: item.title.trim(),
            type: 'local',
            parentCardId: parent.id
          })
          createdCards.push(updatedCard)
        } else {
          const result = await adapter!.createIssue(item.title.trim(), bodyWithBacklink || undefined)
          if (!result) {
            const provider = adapter!.providerKey === 'gitlab' ? 'GitLab' : 'GitHub'
            return { error: `Failed to create ${provider} issue` }
          }

          const card = upsertCard({
            ...result.card,
            project_id: project.id
          })

          createEvent(project.id, 'card_created', card.id, {
            title: item.title.trim(),
            type: adapter!.providerKey === 'gitlab' ? 'gitlab_issue' : 'github_issue',
            issueNumber: result.number,
            url: result.url,
            parentCardId: parent.id
          })

          createdCards.push(card)
          childIssueNumbers.push(String(result.number))
        }

        const created = createdCards[createdCards.length - 1]
        createCardDependency({
          projectId: project.id,
          cardId: parent.id,
          dependsOnCardId: created.id
        })
      }

      createEvent(project.id, 'card_split', parent.id, {
        parentCardId: parent.id,
        childCardIds: createdCards.map((c) => c.id),
        childIssueNumbers: childIssueNumbers.length > 0 ? childIssueNumbers : undefined
      })

      // Update parent body with remote relationship hints
      const blockedByLines =
        parent.remote_number_or_iid && childIssueNumbers.length > 0
          ? childIssueNumbers.map((num) => `Blocked by #${num}`)
          : createdCards.map((c) => `Blocked by: ${c.title}`)

      const updatedParentBody = appendUniqueLines(parent.body, blockedByLines)
      if (updatedParentBody && updatedParentBody !== parent.body) {
        const updatedParent = upsertCard({
          ...parent,
          body: updatedParentBody,
          sync_state: parent.remote_repo_key ? 'pending' : 'ok'
        })

        if (parent.remote_repo_key && parent.remote_number_or_iid && adapter) {
          const issueNumber = parseInt(parent.remote_number_or_iid, 10)
          if (!isNaN(issueNumber)) {
            try {
              const success = await adapter.updateIssueBody(issueNumber, updatedParentBody)
              if (success) {
                upsertCard({ ...updatedParent, sync_state: 'ok' })
              }
            } catch (error) {
              logAction('splitCard:parentRemoteUpdateFailed', {
                cardId: parent.id,
                error: String(error)
              })
            }
          }
        }
      }

      notifyRenderer()
      return { cards: createdCards }
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
