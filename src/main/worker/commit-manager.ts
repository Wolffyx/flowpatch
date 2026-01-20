/**
 * Commit Manager
 *
 * Utilities for building commit messages and committing/pushing changes.
 */

import type { PipelineContext } from './phases/types'
import type { PolicyConfig, Card } from '@shared/types'
import { stageAll, commit, push, isWorkingTreeClean } from './git-operations'
import { getWorkingDir } from './phases/types'

/**
 * Build commit message from policy template.
 */
export function buildCommitMessage(policy: PolicyConfig, card: Card | null): string {
  const template =
    policy.worker?.commitMessage || '#{issue} {title}'
  
  return template
    .replace('{issue}', card?.remote_number_or_iid || '')
    .replace('{title}', card?.title || '')
}

/**
 * Commit and push changes to the specified branch.
 *
 * @param ctx - Pipeline context
 * @param branchName - Branch to push to
 * @param branchManager - Optional branch manager for updating from origin
 * @param updateFromOrigin - Whether to update branch from origin before pushing
 */
export async function commitAndPush(
  ctx: PipelineContext,
  branchName: string,
  branchManager?: { updateBranchFromOrigin(branch: string): Promise<void> } | null,
  updateFromOrigin: boolean = true
): Promise<void> {
  const commitMsg = buildCommitMessage(ctx.policy, ctx.card)
  const workingDir = getWorkingDir(ctx)

  try {
    await stageAll(workingDir)

    if (!(await isWorkingTreeClean(workingDir))) {
      await commit(workingDir, commitMsg)
    }

    // Update from origin before push
    if (updateFromOrigin && branchManager) {
      try {
        await branchManager.updateBranchFromOrigin(branchName)
      } catch {
        // Let push surface the issue
      }
    }

    await push(workingDir, branchName)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('could not read Username') ||
      message.includes('Authentication failed')
    ) {
      throw new Error('Git push failed: missing credentials.')
    }
    throw error
  }
}
