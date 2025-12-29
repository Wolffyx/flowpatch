/**
 * AI Phase
 *
 * Handles AI tool execution (Claude Code or Codex).
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { runProcessStreaming, WorkerCanceledError } from '../process-runner'
import { getWorkingDir, type PipelineContext, type LogFn } from './types'
import { buildContextBundle, buildPromptContext } from '../../services/patchwork-context'
import { ensureRunDir } from '../../services/patchwork-runs'
import { updateWorkerProgress } from '../../db'
import type { ThinkingMode } from '../../../shared/types'

const execFileAsync = promisify(execFile)

/**
 * Check if a command is available on the system.
 */
export async function checkCommand(cmd: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync('where', [cmd])
    } else {
      await execFileAsync('which', [cmd])
    }
    return true
  } catch {
    return false
  }
}

/**
 * Check if an error is a retryable Claude rate/usage limit.
 */
export function isClaudeRetryableLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  const s = msg.toLowerCase()
  return (
    s.includes('rate limit') ||
    s.includes('ratelimit') ||
    s.includes('rate_limit') ||
    s.includes("you've hit your limit") ||
    s.includes('you\u2019ve hit your limit') ||
    s.includes('limit reached') ||
    s.includes('quota') ||
    s.includes('insufficient_quota') ||
    s.includes('too many requests') ||
    s.includes('http 429') ||
    s.includes('status 429') ||
    s.includes(' usage limit') ||
    s.includes('usage limit') ||
    s.includes('overloaded') ||
    s.includes('exceeded') ||
    s.includes('429')
  )
}

/**
 * Get the thinking budget tokens for a given thinking mode.
 * Returns undefined for 'none' mode (no extended thinking).
 */
export function getThinkingBudgetTokens(
  mode: ThinkingMode,
  customBudget?: number
): number | undefined {
  if (mode === 'none') return undefined

  // Use custom budget if provided and mode allows it
  if (customBudget && customBudget > 0) {
    return customBudget
  }

  // Default token budgets for each mode
  const budgets: Record<Exclude<ThinkingMode, 'none'>, number> = {
    medium: 1024,
    deep: 4096,
    ultra: 16384
  }

  return budgets[mode]
}

/**
 * Build the prompt for the AI tool.
 */
export async function buildAIPrompt(ctx: PipelineContext, plan: string): Promise<string> {
  const allowedCommands = ctx.policy.worker?.allowedCommands || []
  const forbidPaths = ctx.policy.worker?.forbidPaths || []
  const workingDir = getWorkingDir(ctx)
  const repoRoot = ctx.project!.local_path

  let repoContext = 'Project memory unavailable.'
  try {
    const bundle = await buildContextBundle(repoRoot, `${ctx.card!.title}\n${ctx.card!.body || ''}`)

    // Persist per-run context for audit and crash recovery
    if (ctx.jobId) {
      try {
        const runDir = ensureRunDir(repoRoot, ctx.jobId)
        const runContextPath = join(runDir, 'last_context.json')
        writeFileSync(runContextPath, JSON.stringify(bundle, null, 2), { encoding: 'utf-8' })
        if (ctx.progress) {
          updateWorkerProgress(ctx.progress.id, { progressFilePath: runContextPath })
        }
      } catch {
        // ignore
      }
    }

    repoContext = buildPromptContext(repoRoot, bundle)
  } catch {
    // ignore
  }

  return `# Task: Implement the following issue

## Issue Title
${ctx.card!.title}

## Issue Description
${ctx.card!.body || 'No description provided'}

## Implementation Plan
${plan}

## Important Constraints
- Only use these commands: ${allowedCommands.join(', ') || 'none specified'}
- Do NOT modify these paths: ${forbidPaths.join(', ') || 'none'}
- Working directory: ${workingDir}
- Repo root: ${repoRoot}
- After implementation, run the verification commands if they exist

## Verification Commands
${ctx.policy.worker?.lintCommand ? `- Lint: ${ctx.policy.worker.lintCommand}` : ''}
${ctx.policy.worker?.testCommand ? `- Test: ${ctx.policy.worker.testCommand}` : ''}
${ctx.policy.worker?.buildCommand ? `- Build: ${ctx.policy.worker.buildCommand}` : ''}

## Project Memory (from .patchwork)
${repoContext}

Please implement the changes now.`
}

export interface ClaudeCodeOptions {
  /** Prompt to send to Claude */
  prompt: string
  /** Timeout in milliseconds */
  timeoutMs: number
  /** Working directory */
  cwd: string
  /** Logging function */
  log: LogFn
  /** Cancellation check function */
  isCanceled: () => boolean
  /** Thinking mode (optional) */
  thinkingMode?: ThinkingMode
  /** Custom thinking budget tokens (optional) */
  thinkingBudget?: number
}

/**
 * Run Claude Code CLI.
 */
export async function runClaudeCode(options: ClaudeCodeOptions): Promise<void> {
  const { prompt, timeoutMs, cwd, log, isCanceled, thinkingMode, thinkingBudget } = options

  // Build CLI arguments
  const args = ['--print', '--dangerously-skip-permissions', '-p', prompt]

  // Add extended thinking arguments if enabled
  const budgetTokens = thinkingMode ? getThinkingBudgetTokens(thinkingMode, thinkingBudget) : undefined
  if (budgetTokens) {
    args.push('--thinking-budget', budgetTokens.toString())
    log(`Extended thinking enabled: ${thinkingMode} mode (${budgetTokens} tokens)`)
  }

  log('Invoking Claude Code CLI...')

  // Write prompt to a temp file for Claude to read
  const promptPath = join(cwd, '.patchwork-prompt.md')
  writeFileSync(promptPath, prompt)

  try {
    await runProcessStreaming({
      command: 'claude',
      args,
      cwd,
      timeoutMs,
      source: 'claude',
      env: {
        ...process.env,
        CLAUDE_CODE_ENTRYPOINT: 'cli'
      },
      onLog: (message, meta) => log(message, meta),
      isCanceled
    })
  } finally {
    try {
      unlinkSync(promptPath)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run Codex CLI.
 */
export async function runCodex(
  prompt: string,
  timeoutMs: number,
  cwd: string,
  log: LogFn,
  isCanceled: () => boolean
): Promise<void> {
  log('Invoking Codex CLI...')

  // Write prompt to a temp file
  const promptPath = join(cwd, '.patchwork-prompt.md')
  writeFileSync(promptPath, prompt)

  try {
    await runProcessStreaming({
      command: 'codex',
      args: ['exec', '--full-auto', prompt],
      cwd,
      timeoutMs,
      source: 'codex',
      onLog: (message, meta) => log(message, meta),
      isCanceled
    })
  } finally {
    try {
      unlinkSync(promptPath)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run AI implementation (Claude or Codex).
 */
export async function runAI(
  ctx: PipelineContext,
  plan: string,
  log: LogFn,
  isCanceled: () => boolean
): Promise<boolean> {
  if (!ctx.project || !ctx.card) return false

  const toolPreference = ctx.policy.worker?.toolPreference || 'auto'
  const maxMinutes = ctx.policy.worker?.maxMinutes || 25
  const timeoutMs = maxMinutes * 60 * 1000

  // Detect available tools
  const hasClaude = await checkCommand('claude')
  const hasCodex = await checkCommand('codex')

  let tool: 'claude' | 'codex' | null = null
  if (toolPreference === 'claude' && hasClaude) tool = 'claude'
  else if (toolPreference === 'codex' && hasCodex) tool = 'codex'
  else if (toolPreference === 'auto') {
    if (hasClaude) tool = 'claude'
    else if (hasCodex) tool = 'codex'
  }

  const workingDir = getWorkingDir(ctx)

  if (!tool) {
    log('No AI tool available (claude or codex)')
    // Create a stub file with the plan
    const planPath = join(workingDir, 'IMPLEMENTATION_PLAN.md')
    const fullPlan = `# Implementation Plan (AI tool not available)

## Task
${ctx.card.title}

## Description
${ctx.card.body || 'No description'}

## Plan
${plan}

## Note
This PR was created without AI implementation because no AI tool (Claude Code or Codex) was detected.
Please implement the changes manually following the plan above.

## Commands
Allowed: ${(ctx.policy.worker?.allowedCommands || []).join(', ')}
Forbidden paths: ${(ctx.policy.worker?.forbidPaths || []).join(', ')}
`
    writeFileSync(planPath, fullPlan)
    return true // Return true to continue with stub PR
  }

  try {
    log(`Running ${tool} with ${maxMinutes} minute timeout`)

    // Build the prompt for the AI tool
    const prompt = await buildAIPrompt(ctx, plan)

    // Get thinking mode configuration from policy
    const thinkingConfig = ctx.policy.features?.thinking
    const thinkingEnabled = thinkingConfig?.enabled !== false
    const thinkingMode = thinkingEnabled ? thinkingConfig?.mode : undefined
    const thinkingBudget = thinkingConfig?.budgetTokens

    if (tool === 'claude') {
      try {
        await runClaudeCode({
          prompt,
          timeoutMs,
          cwd: workingDir,
          log,
          isCanceled,
          thinkingMode,
          thinkingBudget
        })
      } catch (error) {
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

    log('AI implementation completed')
    return true
  } catch (error) {
    if (error instanceof WorkerCanceledError) {
      throw error
    }

    log(`AI error: ${error}`)
    // On AI failure, still create the plan file so PR can be created as WIP
    const planPath = join(workingDir, 'IMPLEMENTATION_PLAN.md')
    const fullPlan = `# Implementation Plan (AI execution failed)

## Task
${ctx.card.title}

## Description
${ctx.card.body || 'No description'}

## Plan
${plan}

## Error
AI execution failed: ${error instanceof Error ? error.message : String(error)}

Please implement the changes manually following the plan above.
`
    writeFileSync(planPath, fullPlan)
    return false
  }
}
