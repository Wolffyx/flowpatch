/**
 * Branch Sync Phase
 *
 * Synchronizes the card's branch with main before AI work begins.
 * Handles conflict detection and AI-powered conflict resolution.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  merge,
  getConflictFiles,
  abortMerge,
  stageFile,
  completeMerge,
  localBranchExists,
  remoteBranchExists,
  fetchOrigin
} from '../git-operations'
import { runClaudeCode, runCodex, checkCommand, isClaudeRetryableLimitError } from './ai'
import { getWorkingDir, type PipelineContext, type LogFn } from './types'

export interface BranchSyncResult {
  success: boolean
  hadConflicts: boolean
  conflictsResolved: boolean
  unresolvedFiles?: string[]
  error?: string
}

/**
 * Build a prompt for AI conflict resolution.
 */
function buildConflictResolutionPrompt(
  conflictFiles: { path: string; content: string }[],
  cardTitle: string,
  mainBranch: string
): string {
  let prompt = `# Git Merge Conflict Resolution

You are resolving merge conflicts between the current feature branch and ${mainBranch}.

## Context
Feature: ${cardTitle}

## Conflicted Files
The following files have merge conflicts that need to be resolved:

`
  for (const file of conflictFiles) {
    prompt += `### ${file.path}
\`\`\`
${file.content}
\`\`\`

`
  }

  prompt += `## Instructions
1. Resolve each conflict by keeping the appropriate changes
2. Remove all conflict markers (<<<<<<, ======, >>>>>>>)
3. Ensure the resulting code is syntactically correct and functional
4. Preserve the intent of the feature being developed
5. Write the resolved content to each file

IMPORTANT: You must resolve ALL conflicts. Do not leave any conflict markers in the files.
`

  return prompt
}

/**
 * Check if a file still has conflict markers.
 */
function hasConflictMarkers(content: string): boolean {
  return (
    content.includes('<<<<<<<') || content.includes('=======') || content.includes('>>>>>>>')
  )
}

/**
 * Run the branch sync phase.
 */
export async function runBranchSyncPhase(
  ctx: PipelineContext,
  branchName: string,
  log: LogFn,
  isCanceled: () => boolean
): Promise<BranchSyncResult> {
  const workingDir = getWorkingDir(ctx)
  const mainBranch = ctx.policy.worker?.baseBranch || ctx.baseBranch || 'main'

  // Check if this is an existing branch (for cards being re-processed)
  // A new branch won't exist locally or remotely yet, so no sync needed
  const localExists = await localBranchExists(workingDir, branchName)
  const remoteExists = await remoteBranchExists(workingDir, branchName)

  if (!localExists && !remoteExists) {
    log('Branch is new, no sync needed')
    return { success: true, hadConflicts: false, conflictsResolved: false }
  }

  log(`Syncing branch ${branchName} with ${mainBranch}`)

  // Fetch latest from remote
  try {
    await fetchOrigin(workingDir, mainBranch)
    log(`Fetched latest ${mainBranch} from origin`)
  } catch (err) {
    log(`Warning: Failed to fetch ${mainBranch}: ${err}`)
    // Continue anyway with local refs
  }

  // Attempt merge
  let mergeSuccess: boolean
  try {
    mergeSuccess = await merge(workingDir, `origin/${mainBranch}`)
  } catch (err) {
    log(`Merge error: ${err}`)
    return {
      success: false,
      hadConflicts: false,
      conflictsResolved: false,
      error: `Failed to merge ${mainBranch}: ${err}`
    }
  }

  if (mergeSuccess) {
    log('Branch is up to date with main')
    return { success: true, hadConflicts: false, conflictsResolved: false }
  }

  // We have conflicts
  log('Merge conflicts detected, attempting AI resolution')

  // Get conflicted files
  const conflictedPaths = await getConflictFiles(workingDir)
  log(`Conflicted files: ${conflictedPaths.join(', ')}`)

  // Read conflict content
  const conflictFilesData: { path: string; content: string }[] = []
  for (const filePath of conflictedPaths) {
    try {
      const fullPath = join(workingDir, filePath)
      const content = readFileSync(fullPath, 'utf-8')
      conflictFilesData.push({ path: filePath, content })
    } catch (err) {
      log(`Warning: Could not read ${filePath}: ${err}`)
    }
  }

  if (conflictFilesData.length === 0) {
    log('No readable conflict files, aborting merge')
    await abortMerge(workingDir)
    return {
      success: false,
      hadConflicts: true,
      conflictsResolved: false,
      unresolvedFiles: conflictedPaths,
      error: 'Could not read conflicted files'
    }
  }

  // Check for AI tool availability - respect toolPreference from policy
  const toolPreference = ctx.policy.worker?.toolPreference || 'auto'
  const hasClaude = await checkCommand('claude')
  const hasCodex = await checkCommand('codex')

  let tool: 'claude' | 'codex' | null = null
  if (toolPreference === 'claude' && hasClaude) tool = 'claude'
  else if (toolPreference === 'codex' && hasCodex) tool = 'codex'
  else if (toolPreference === 'auto') {
    if (hasClaude) tool = 'claude'
    else if (hasCodex) tool = 'codex'
  }

  if (!tool) {
    log('No AI tool available for conflict resolution (claude or codex), aborting merge')
    await abortMerge(workingDir)
    return {
      success: false,
      hadConflicts: true,
      conflictsResolved: false,
      unresolvedFiles: conflictedPaths,
      error: 'No AI tool available for conflict resolution'
    }
  }

  // Build and run conflict resolution prompt
  const prompt = buildConflictResolutionPrompt(
    conflictFilesData,
    ctx.card?.title || 'Unknown',
    mainBranch
  )

  try {
    const timeoutMs = 5 * 60 * 1000 // 5 minute timeout for conflict resolution
    log(`Running ${tool} for conflict resolution`)

    if (tool === 'claude') {
      try {
        await runClaudeCode({
          prompt,
          timeoutMs,
          cwd: workingDir,
          log,
          isCanceled
        })
      } catch (error) {
        // Fallback to Codex if Claude hits rate/usage limit
        if (hasCodex && isClaudeRetryableLimitError(error)) {
          log('Claude failed due to rate/usage limit; falling back to Codex...')
          await runCodex(prompt, timeoutMs, workingDir, log, isCanceled)
        } else {
          throw error
        }
      }
    } else if (tool === 'codex') {
      await runCodex(prompt, timeoutMs, workingDir, log, isCanceled)
    }
  } catch (err) {
    log(`AI conflict resolution failed: ${err}`)
    await abortMerge(workingDir)
    return {
      success: false,
      hadConflicts: true,
      conflictsResolved: false,
      unresolvedFiles: conflictedPaths,
      error: `AI conflict resolution failed: ${err}`
    }
  }

  // Verify all conflicts were resolved
  const stillConflicted: string[] = []
  for (const filePath of conflictedPaths) {
    try {
      const fullPath = join(workingDir, filePath)
      const content = readFileSync(fullPath, 'utf-8')
      if (hasConflictMarkers(content)) {
        stillConflicted.push(filePath)
      } else {
        // Stage the resolved file
        await stageFile(workingDir, filePath)
      }
    } catch (err) {
      stillConflicted.push(filePath)
    }
  }

  if (stillConflicted.length > 0) {
    log(`AI could not resolve all conflicts: ${stillConflicted.join(', ')}`)
    await abortMerge(workingDir)
    return {
      success: false,
      hadConflicts: true,
      conflictsResolved: false,
      unresolvedFiles: stillConflicted,
      error: 'AI could not resolve all merge conflicts'
    }
  }

  // Complete the merge
  try {
    await completeMerge(workingDir, `Merge ${mainBranch} into ${branchName} (auto-resolved)`)
    log('Merge completed successfully with AI-resolved conflicts')
    return { success: true, hadConflicts: true, conflictsResolved: true }
  } catch (err) {
    log(`Failed to complete merge: ${err}`)
    await abortMerge(workingDir)
    return {
      success: false,
      hadConflicts: true,
      conflictsResolved: false,
      unresolvedFiles: conflictedPaths,
      error: `Failed to complete merge: ${err}`
    }
  }
}
