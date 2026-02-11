/**
 * Card Status Manager
 *
 * Handles card status transitions with remote synchronization.
 */

import {
  getCard,
  updateCardStatus,
  createEvent,
  ensureCardLink,
  deleteFailedWorkerRunJobsForCard
} from "../../db";
import { broadcastToRenderers } from "../../ipc/broadcast";
import { WorkerCanceledError } from "../errors";
import { wakeUpWorkerLoop } from "../loop";
import type { IRepoAdapter } from "../../adapters";
import type { Card, CardStatus } from "../../../shared/types";

export interface CardStatusContext {
  projectId: string;
  cardId: string;
  card: Card | null;
  adapter: IRepoAdapter | null;
}

/**
 * Manages card status transitions for the worker pipeline.
 */
export class CardStatusManager {
  private ctx: CardStatusContext;
  private log: (message: string) => void;
  private cancelJob: (reason?: string) => void;

  constructor(
    ctx: CardStatusContext,
    log: (message: string) => void,
    cancelJob: (reason?: string) => void
  ) {
    this.ctx = ctx;
    this.log = log;
    this.cancelJob = cancelJob;
  }

  /**
   * Update the card reference.
   */
  setCard(card: Card): void {
    this.ctx.card = card;
  }

  /**
   * Get the current card.
   */
  getCard(): Card | null {
    return this.ctx.card;
  }

  /**
   * Ensure card status is in the allowed list, otherwise cancel.
   */
  ensureCardStatusAllowed(allowed: CardStatus[], reason?: string): void {
    const card = getCard(this.ctx.cardId, this.ctx.projectId);
    if (!card) {
      this.log(`Card not found: ${this.ctx.cardId}`);
      this.cancelJob("Canceled: card not found");
      throw new WorkerCanceledError();
    }
    this.ctx.card = card;

    if (allowed.includes(card.status)) return;

    this.log(`Card status '${card.status}' not in allowed list [${allowed.join(", ")}]`);
    this.cancelJob(reason ?? `Canceled: card moved to ${card.status}`);
    throw new WorkerCanceledError();
  }

  /**
   * Move card to In Progress status.
   * Idempotent - if card is already in_progress, this is a no-op.
   */
  async moveToInProgress(): Promise<void> {
    const current = getCard(this.ctx.cardId, this.ctx.projectId);
    if (!current) return;
    // Idempotency check - avoid duplicate events
    if (current.status === "in_progress") return;

    const previousStatus = current.status;
    updateCardStatus(this.ctx.cardId, "in_progress", this.ctx.projectId);
    createEvent(this.ctx.projectId, "status_changed", this.ctx.cardId, {
      from: previousStatus,
      to: "in_progress",
      source: "worker"
    });

    // Update remote if adapter available
    if (this.ctx.adapter && this.ctx.card?.remote_number_or_iid) {
      const issueNumber = parseInt(this.ctx.card.remote_number_or_iid, 10);
      const newLabel = this.ctx.adapter.getStatusLabel("in_progress");
      const allLabels = this.ctx.adapter.getAllStatusLabels();
      await this.ctx.adapter.updateLabels(
        issueNumber,
        [newLabel],
        allLabels.filter((l) => l !== newLabel)
      );
    }

    broadcastToRenderers("card-updated", { cardId: this.ctx.cardId });
  }

  /**
   * Move card to Testing status.
   * Called when E2E phase begins execution.
   */
  async moveToTesting(): Promise<void> {
    const current = getCard(this.ctx.cardId, this.ctx.projectId);
    if (!current) return;
    if (current.status === "testing") return;

    updateCardStatus(this.ctx.cardId, "testing", this.ctx.projectId);
    createEvent(this.ctx.projectId, "status_changed", this.ctx.cardId, {
      from: current.status,
      to: "testing",
      source: "worker"
    });

    // Update remote if adapter available
    if (this.ctx.adapter && this.ctx.card?.remote_number_or_iid) {
      const issueNumber = parseInt(this.ctx.card.remote_number_or_iid, 10);
      const newLabel = this.ctx.adapter.getStatusLabel("testing");
      const allLabels = this.ctx.adapter.getAllStatusLabels();
      await this.ctx.adapter.updateLabels(
        issueNumber,
        [newLabel],
        allLabels.filter((l) => l !== newLabel)
      );
    }

    broadcastToRenderers("card-updated", { cardId: this.ctx.cardId });
  }

  /**
   * Move card to Ready status.
   * Critical local operations are done first (must succeed).
   * Remote label sync is fire-and-forget (can fail without blocking).
   */
  async moveToReady(reason: string): Promise<void> {
    // CRITICAL: Delete failed jobs first to allow immediate retry
    deleteFailedWorkerRunJobsForCard(this.ctx.cardId, this.ctx.projectId);

    const current = getCard(this.ctx.cardId, this.ctx.projectId);
    if (!current) return;
    if (current.status === "ready") return;

    // CRITICAL: Update local DB (must succeed)
    updateCardStatus(this.ctx.cardId, "ready", this.ctx.projectId);
    createEvent(this.ctx.projectId, "status_changed", this.ctx.cardId, {
      from: current.status,
      to: "ready",
      source: "worker",
      reason
    });

    // CRITICAL: Notify UI immediately
    broadcastToRenderers("card-updated", { cardId: this.ctx.cardId });

    // Wake up worker pool for immediate pickup (within ~500ms)
    wakeUpWorkerLoop(this.ctx.projectId);

    // NON-CRITICAL: Update remote labels asynchronously (fire-and-forget)
    this.updateRemoteLabelsAsync("ready");
  }

  /**
   * Move card to Failed status.
   * Does not delete failed jobs or wake the worker loop; card stays failed until user resets.
   */
  async moveToFailed(reason: string): Promise<void> {
    const current = getCard(this.ctx.cardId, this.ctx.projectId);
    if (!current) return;
    if (current.status === "failed") return;

    updateCardStatus(this.ctx.cardId, "failed", this.ctx.projectId);
    createEvent(this.ctx.projectId, "status_changed", this.ctx.cardId, {
      from: current.status,
      to: "failed",
      source: "worker",
      reason
    });

    broadcastToRenderers("card-updated", { cardId: this.ctx.cardId });

    this.updateRemoteLabelsAsync("failed");
  }

  /**
   * Update remote labels asynchronously. Fire-and-forget - failures are logged but don't block.
   */
  private updateRemoteLabelsAsync(status: CardStatus): void {
    if (!this.ctx.adapter || !this.ctx.card?.remote_number_or_iid) return;

    const issueNumber = parseInt(this.ctx.card.remote_number_or_iid, 10);
    const newLabel = this.ctx.adapter.getStatusLabel(status);
    const allLabels = this.ctx.adapter.getAllStatusLabels();

    this.ctx.adapter
      .updateLabels(issueNumber, [newLabel], allLabels.filter((l) => l !== newLabel))
      .catch((err) => {
        console.warn(
          `[CardStatusManager] Remote label update to '${status}' failed (non-critical): ${err}`
        );
      });
  }

  /**
   * Move card to In Review status and link PR.
   * Idempotent - if card is already in_review, only ensures PR link exists.
   */
  async moveToInReview(prUrl: string, created = true): Promise<void> {
    const current = getCard(this.ctx.cardId, this.ctx.projectId);
    if (!current) return;

    // Create card link regardless of status (idempotent)
    const linkedType = this.ctx.adapter?.providerKey === "github" ? "pr" : "mr";
    ensureCardLink(this.ctx.cardId, linkedType, prUrl, undefined, undefined, this.ctx.projectId);

    // Idempotency check for status change - avoid duplicate events
    if (current.status === "in_review") {
      // Still broadcast to ensure UI is updated with link
      broadcastToRenderers("card-updated", { cardId: this.ctx.cardId });
      return;
    }

    const previousStatus = current.status;
    updateCardStatus(this.ctx.cardId, "in_review", this.ctx.projectId);

    createEvent(this.ctx.projectId, "pr_created", this.ctx.cardId, {
      prUrl,
      status: "in_review",
      from: previousStatus,
      existing: !created
    });

    // Update remote labels
    if (this.ctx.adapter && this.ctx.card?.remote_number_or_iid) {
      const issueNumber = parseInt(this.ctx.card.remote_number_or_iid, 10);
      const newLabel = this.ctx.adapter.getStatusLabel("in_review");
      const allLabels = this.ctx.adapter.getAllStatusLabels();
      await this.ctx.adapter.updateLabels(
        issueNumber,
        [newLabel],
        allLabels.filter((l) => l !== newLabel)
      );

      // Comment on issue with PR link
      // if (created) {
      //   await this.ctx.adapter.commentOnIssue(
      //     issueNumber,
      //     `PR created: ${prUrl}\n\n_Automated by FlowPatch_`
      //   )
      // }
    }

    broadcastToRenderers("card-updated", { cardId: this.ctx.cardId });
  }
}
