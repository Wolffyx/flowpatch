/**
 * Commit Manager
 *
 * Utilities for building commit messages and committing/pushing changes.
 */

import type { PipelineContext } from './phases/types'
import type { PolicyConfig, Card } from '@shared/types'
import { detectGitAuthState } from '../utils/git-auth'
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
  updateFromOrigin: boolean = true,
  log?: (message: string) => void
): Promise<void> {
  const commitMsg = buildCommitMessage(ctx.policy, ctx.card)
  const workingDir = getWorkingDir(ctx)

  try {
    log?.(`Commit/push working directory: ${workingDir}`)
    log?.(`Context worktreePath: ${ctx.worktreePath ?? 'null'}`)
    log?.(`Context useWorktree: ${ctx.useWorktree}`)

    if (ctx.useWorktree && !ctx.worktreePath) {
      log?.('WARNING: useWorktree is true but worktreePath is null!')
    }

    // Detect auth mode and warn if HTTPS without creds or SSH unreachable
    try {
      const authState = await detectGitAuthState(workingDir)
      if (authState.warnings?.length) {
        for (const w of authState.warnings) {
          log?.(`Git auth warning: ${w}`)
        }
      }
    } catch (e) {
      log?.(`Git auth check skipped: ${e instanceof Error ? e.message : String(e)}`)
    }

    await stageAll(workingDir)

    if (!(await isWorkingTreeClean(workingDir))) {
      log?.(`Changes detected, committing: ${commitMsg}`)
      await commit(workingDir, commitMsg)
    } else {
      log?.(`No changes to commit in ${workingDir}`)
    }

    // Update from origin before push
    if (updateFromOrigin && branchManager && !ctx.useWorktree) {
      try {
        await branchManager.updateBranchFromOrigin(branchName)
      } catch {
        // Let push surface the issue
      }
    }

    log?.(`Pushing branch ${branchName} from ${workingDir}`)
    await push(workingDir, branchName)
    log?.('Push completed successfully')
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
