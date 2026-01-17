/**
 * PR/MR Phase
 *
 * Handles pull request / merge request creation.
 */

import type { PipelineContext } from './types'
import { updateCardStatus, createCardLink, createEvent } from '../../db'

export interface PRResult {
  number: number
  url: string
}

/**
 * Create a pull request or merge request.
 */
export async function createPR(
  ctx: PipelineContext,
  branchName: string,
  plan: string,
  checksPass: boolean
): Promise<PRResult | null> {
  if (!ctx.adapter || !ctx.card) return null

  const title = checksPass ? ctx.card.title : `[WIP] ${ctx.card.title}`

  const body = `
## Summary
${ctx.card.body || 'Automated implementation'}

## Plan
${plan}

## Testing
${checksPass ? 'All checks passed' : 'Some checks failed - needs review'}

---
Closes #${ctx.card.remote_number_or_iid}

_Automated by FlowPatch_
`.trim()

  // Get status label to attach to PR on creation
  const statusLabel = ctx.adapter.getStatusLabel('in_review')

  // Use unified interface - works for both GitHub and GitLab
  const result = await ctx.adapter.createPullRequest(title, body, branchName, undefined, [statusLabel])
  return result ? { number: result.number, url: result.url } : null
}

/**
 * Move card to In Review and link PR.
 */
export async function moveToInReview(ctx: PipelineContext, prUrl: string): Promise<void> {
  updateCardStatus(ctx.cardId, 'in_review')

  // Create card link - use providerKey instead of instanceof
  const linkedType = ctx.adapter?.providerKey === 'github' ? 'pr' : 'mr'
  createCardLink(ctx.cardId, linkedType, prUrl)

  createEvent(ctx.projectId, 'pr_created', ctx.cardId, {
    prUrl,
    status: 'in_review'
  })

  // Update remote labels
  if (ctx.adapter && ctx.card?.remote_number_or_iid) {
    const issueNumber = parseInt(ctx.card.remote_number_or_iid, 10)
    const newLabel = ctx.adapter.getStatusLabel('in_review')
    const allLabels = ctx.adapter.getAllStatusLabels()
    await ctx.adapter.updateLabels(
      issueNumber,
      [newLabel],
      allLabels.filter((l) => l !== newLabel)
    )

    // Comment on issue with PR link
    await ctx.adapter.commentOnIssue(
      issueNumber,
      `PR created: ${prUrl}\n\n_Automated by FlowPatch_`
    )
  }
}
