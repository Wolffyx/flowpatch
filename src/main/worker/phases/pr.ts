/**
 * PR/MR Phase
 *
 * Handles pull request / merge request creation.
 */

import type { PipelineContext } from './types'
import { GithubAdapter } from '../../adapters/github'
import { GitlabAdapter } from '../../adapters/gitlab'
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

_Automated by Patchwork_
`.trim()

  if (ctx.adapter instanceof GithubAdapter) {
    return ctx.adapter.createPR(title, body, branchName)
  } else if (ctx.adapter instanceof GitlabAdapter) {
    const result = await ctx.adapter.createMR(title, body, branchName)
    return result ? { number: result.iid, url: result.url } : null
  }

  return null
}

/**
 * Move card to In Review and link PR.
 */
export async function moveToInReview(ctx: PipelineContext, prUrl: string): Promise<void> {
  updateCardStatus(ctx.cardId, 'in_review')

  // Create card link
  const linkedType = ctx.adapter instanceof GithubAdapter ? 'pr' : 'mr'
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
      `PR created: ${prUrl}\n\n_Automated by Patchwork_`
    )
  }
}
