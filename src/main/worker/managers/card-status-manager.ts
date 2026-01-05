/**
 * Card Status Manager
 *
 * Handles card status transitions with remote synchronization.
 */

import {
  getCard,
  updateCardStatus,
  createEvent,
  ensureCardLink
} from '../../db'
import { broadcastToRenderers } from '../../ipc/broadcast'
import { WorkerCanceledError } from '../errors'
import type { IRepoAdapter } from '../../adapters'
import type { Card, CardStatus } from '../../../shared/types'

export interface CardStatusContext {
  projectId: string
  cardId: string
  card: Card | null
  adapter: IRepoAdapter | null
}

/**
 * Manages card status transitions for the worker pipeline.
 */
export class CardStatusManager {
  private ctx: CardStatusContext
  private cancelJob: (reason?: string) => void

  constructor(
    ctx: CardStatusContext,
    _log: (message: string) => void,
    cancelJob: (reason?: string) => void
  ) {
    this.ctx = ctx
    this.cancelJob = cancelJob
  }

  /**
   * Update the card reference.
   */
  setCard(card: Card): void {
    this.ctx.card = card
  }

  /**
   * Get the current card.
   */
  getCard(): Card | null {
    return this.ctx.card
  }

  /**
   * Ensure card status is in the allowed list, otherwise cancel.
   */
  ensureCardStatusAllowed(allowed: CardStatus[], reason?: string): void {
    const card = getCard(this.ctx.cardId)
    if (!card) return
    this.ctx.card = card

    if (allowed.includes(card.status)) return

    this.cancelJob(reason ?? `Canceled: card moved to ${card.status}`)
    throw new WorkerCanceledError()
  }

  /**
   * Move card to In Progress status.
   */
  async moveToInProgress(): Promise<void> {
    updateCardStatus(this.ctx.cardId, 'in_progress')
    createEvent(this.ctx.projectId, 'status_changed', this.ctx.cardId, {
      from: this.ctx.card?.status,
      to: 'in_progress',
      source: 'worker'
    })

    // Update remote if adapter available
    if (this.ctx.adapter && this.ctx.card?.remote_number_or_iid) {
      const issueNumber = parseInt(this.ctx.card.remote_number_or_iid, 10)
      const newLabel = this.ctx.adapter.getStatusLabel('in_progress')
      const allLabels = this.ctx.adapter.getAllStatusLabels()
      await this.ctx.adapter.updateLabels(
        issueNumber,
        [newLabel],
        allLabels.filter((l) => l !== newLabel)
      )
    }
  }

  /**
   * Move card to Ready status.
   */
  async moveToReady(reason: string): Promise<void> {
    const current = getCard(this.ctx.cardId)
    if (!current) return
    if (current.status === 'ready') return

    updateCardStatus(this.ctx.cardId, 'ready')
    createEvent(this.ctx.projectId, 'status_changed', this.ctx.cardId, {
      from: current.status,
      to: 'ready',
      source: 'worker',
      reason
    })

    // Update remote if adapter available
    if (this.ctx.adapter && this.ctx.card?.remote_number_or_iid) {
      const issueNumber = parseInt(this.ctx.card.remote_number_or_iid, 10)
      const newLabel = this.ctx.adapter.getStatusLabel('ready')
      const allLabels = this.ctx.adapter.getAllStatusLabels()
      await this.ctx.adapter.updateLabels(
        issueNumber,
        [newLabel],
        allLabels.filter((l) => l !== newLabel)
      )
    }
  }

  /**
   * Move card to In Review status and link PR.
   */
  async moveToInReview(prUrl: string, created = true): Promise<void> {
    updateCardStatus(this.ctx.cardId, 'in_review')

    // Create card link
    const linkedType = this.ctx.adapter?.providerKey === 'github' ? 'pr' : 'mr'
    ensureCardLink(this.ctx.cardId, linkedType, prUrl)

    createEvent(this.ctx.projectId, 'pr_created', this.ctx.cardId, {
      prUrl,
      status: 'in_review',
      existing: !created
    })

    // Update remote labels
    if (this.ctx.adapter && this.ctx.card?.remote_number_or_iid) {
      const issueNumber = parseInt(this.ctx.card.remote_number_or_iid, 10)
      const newLabel = this.ctx.adapter.getStatusLabel('in_review')
      const allLabels = this.ctx.adapter.getAllStatusLabels()
      await this.ctx.adapter.updateLabels(
        issueNumber,
        [newLabel],
        allLabels.filter((l) => l !== newLabel)
      )

      // Comment on issue with PR link
      if (created) {
        await this.ctx.adapter.commentOnIssue(
          issueNumber,
          `PR created: ${prUrl}\n\n_Automated by Patchwork_`
        )
      }
    }

    broadcastToRenderers('card-updated', { cardId: this.ctx.cardId })
  }
}
