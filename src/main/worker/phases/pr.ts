/**
 * PR/MR Phase
 *
 * Handles pull request / merge request creation.
 */

import type { PipelineContext } from './types'
import { updateCardStatus, createCardLink, createEvent, listCardLinks } from '../../db'

export interface PRResult {
  number: number
  url: string
  existing?: boolean
}

/**
 * Find existing PR/MR for a card.
 */
export function findExistingPR(ctx: PipelineContext): PRResult | null {
  if (!ctx.adapter || !ctx.card) return null

  const linkedType = ctx.adapter.providerKey === 'github' ? 'pr' : 'mr'
  const existingLink = listCardLinks(ctx.cardId).find((link) => link.linked_type === linkedType)

  if (existingLink?.linked_url) {
    const url = existingLink.linked_url
    const numberMatch =
      linkedType === 'pr' ? url.match(/\/pull\/(\d+)/) : url.match(/\/merge_requests\/(\d+)/)
    const number = numberMatch ? parseInt(numberMatch[1], 10) : 0
    return { number, url, existing: true }
  }

  return null
}

/**
 * Create a pull request or merge request.
 */
export async function createPR(
  ctx: PipelineContext,
  branchName: string,
  plan: string,
  checksPass: boolean,
  baseBranch?: string
): Promise<PRResult | null> {
  if (!ctx.adapter || !ctx.card) return null

  // Check for existing PR first
  const existing = findExistingPR(ctx)
  if (existing) {
    return existing
  }

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

`.trim()
// _Automated by FlowPatch_

  // Get status label to attach to PR on creation
  const statusLabel = ctx.adapter.getStatusLabel('in_review')

  // Use unified interface - works for both GitHub and GitLab
  const result = await ctx.adapter.createPullRequest(
    title,
    body,
    branchName,
    baseBranch,
    [statusLabel]
  )
  return result ? { number: result.number, url: result.url, existing: false } : null
}

/**
 * Move card to In Review and link PR.
 */
export async function moveToInReview(
  ctx: PipelineContext,
  prUrl: string,
  isNewPR: boolean = true
): Promise<void> {
  updateCardStatus(ctx.cardId, 'in_review', ctx.projectId)

  // Create card link - use providerKey instead of instanceof
  const linkedType = ctx.adapter?.providerKey === 'github' ? 'pr' : 'mr'
  createCardLink(ctx.cardId, linkedType, prUrl, undefined, undefined, ctx.projectId)

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

    // // Comment on issue with PR link (only for new PRs)
    // if (isNewPR) {
    //   await ctx.adapter.commentOnIssue(
    //     issueNumber,
    //     `PR created: ${prUrl}\n\n_Automated by FlowPatch_`
    //   )
    // }
  }
}
