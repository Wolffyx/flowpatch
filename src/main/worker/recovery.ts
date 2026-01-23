/**
 * Worker Recovery
 *
 * Recovers cards stuck in worker states from previous crashes.
 * Called on app startup to ensure no cards are left in limbo.
 */

import { listProjects, listCards, updateCardStatus, getRunningJobs } from '../db'
import { broadcastToRenderers } from '../ipc/broadcast'
import { logAction } from '../../shared/utils'

/**
 * Recovers cards stuck in worker states from previous crashes.
 * A card is considered stuck if it's in 'in_progress' or 'testing' status
 * but has no active worker job running for it.
 *
 * @returns The number of cards recovered
 */
export async function recoverStuckCards(): Promise<number> {
  let recovered = 0
  const projects = listProjects()

  for (const project of projects) {
    const cards = listCards(project.id)
    const runningJobs = getRunningJobs(project.id)

    // Build a set of card IDs that have active jobs
    const activeJobCardIds = new Set(
      runningJobs
        .filter((j) => j.type === 'worker_run')
        .map((j) => j.card_id)
        .filter(Boolean) as string[]
    )

    for (const card of cards) {
      // Cards in worker states without active jobs are stuck
      if (['in_progress', 'testing'].includes(card.status)) {
        if (!activeJobCardIds.has(card.id)) {
          try {
            updateCardStatus(card.id, 'ready', project.id)
            logAction('recovery:stuckCardRecovered', {
              cardId: card.id,
              projectId: project.id,
              previousStatus: card.status
            })
            recovered++
          } catch (error) {
            logAction('recovery:stuckCardRecoveryFailed', {
              cardId: card.id,
              projectId: project.id,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      }
    }
  }

  if (recovered > 0) {
    broadcastToRenderers('stateUpdated')
    console.log(`[Recovery] Recovered ${recovered} stuck card(s)`)
  }

  return recovered
}
