/**
 * AI Phase
 *
 * Handles AI tool execution (Claude Code or Codex).
 */

import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { runProcessStreaming, WorkerCanceledError } from '../process-runner'
import { getWorkingDir, type PipelineContext, type LogFn } from './types'
import { buildContextBundle, buildPromptContext } from '../../services/patchwork-context'
import { ensureRunDir } from '../../services/patchwork-runs'
import { updateWorkerProgress, createUsageRecord, getHourlyUsage, getDailyUsage, getMonthlyUsage, getToolLimits } from '../../db'
import { hasCommand, getAvailableAITools } from '../cache'
import type { ThinkingMode, AIToolType } from '../../../shared/types'

// ============================================================================
// Usage Tracking
// ============================================================================

/** Pricing per 1M tokens (approximate, may vary by model) */
const PRICING = {
  claude: { input: 3.0, output: 15.0 }, // Claude Sonnet 4 pricing
  codex: { input: 2.5, output: 10.0 } // Codex/GPT-4 approximate pricing
}

/**
 * Estimate token count from text (rough approximation: ~4 chars per token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Calculate estimated cost in USD.
 */
function calculateCost(
  toolType: 'claude' | 'codex',
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PRICING[toolType]
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return inputCost + outputCost
}

/**
 * Check if usage limits are exceeded for a tool.
 * Checks in order: hourly -> daily -> monthly (most restrictive first)
 */
export function checkLimitsExceeded(
  toolType: AIToolType
): { exceeded: boolean; reason?: string; fallbackAllowed?: boolean } {
  const limits = getToolLimits(toolType)
  if (!limits) return { exceeded: false }

  const hourly = getHourlyUsage(toolType)
  const daily = getDailyUsage(toolType)
  const monthly = getMonthlyUsage(toolType)

  // Check hourly token limit (most restrictive first)
  if (limits.hourly_token_limit && hourly.tokens >= limits.hourly_token_limit) {
    return {
      exceeded: true,
      reason: `Hourly token limit reached (${hourly.tokens.toLocaleString()}/${limits.hourly_token_limit.toLocaleString()})`,
      fallbackAllowed: true
    }
  }

  // Check hourly cost limit
  if (limits.hourly_cost_limit_usd && hourly.cost >= limits.hourly_cost_limit_usd) {
    return {
      exceeded: true,
      reason: `Hourly cost limit reached ($${hourly.cost.toFixed(2)}/$${limits.hourly_cost_limit_usd.toFixed(2)})`,
      fallbackAllowed: true
    }
  }

  // Check daily token limit
  if (limits.daily_token_limit && daily.tokens >= limits.daily_token_limit) {
    return {
      exceeded: true,
      reason: `Daily token limit reached (${daily.tokens.toLocaleString()}/${limits.daily_token_limit.toLocaleString()})`,
      fallbackAllowed: true
    }
  }

  // Check daily cost limit
  if (limits.daily_cost_limit_usd && daily.cost >= limits.daily_cost_limit_usd) {
    return {
      exceeded: true,
      reason: `Daily cost limit reached ($${daily.cost.toFixed(2)}/$${limits.daily_cost_limit_usd.toFixed(2)})`,
      fallbackAllowed: true
    }
  }

  // Check monthly token limit
  if (limits.monthly_token_limit && monthly.tokens >= limits.monthly_token_limit) {
    return {
      exceeded: true,
      reason: `Monthly token limit reached (${monthly.tokens.toLocaleString()}/${limits.monthly_token_limit.toLocaleString()})`,
      fallbackAllowed: true
    }
  }

  // Check monthly cost limit
  if (limits.monthly_cost_limit_usd && monthly.cost >= limits.monthly_cost_limit_usd) {
    return {
      exceeded: true,
      reason: `Monthly cost limit reached ($${monthly.cost.toFixed(2)}/$${limits.monthly_cost_limit_usd.toFixed(2)})`,
      fallbackAllowed: true
    }
  }

  return { exceeded: false }
}

/**
 * Check if a command is available on the system (cached).
 * @deprecated Use hasCommand from cache.ts for better performance.
 */
export async function checkCommand(cmd: string): Promise<boolean> {
  return hasCommand(cmd)
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

/** Result from AI tool execution with usage metrics */
export interface AIExecutionResult {
  /** Estimated input tokens */
  inputTokens: number
  /** Estimated output tokens */
  outputTokens: number
  /** Execution duration in milliseconds */
  durationMs: number
  /** Accumulated output length for estimation */
  outputLength: number
}

/**
 * Run Claude Code CLI.
 */
export async function runClaudeCode(options: ClaudeCodeOptions): Promise<AIExecutionResult> {
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

  const startTime = Date.now()
  let outputLength = 0

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
      onLog: (message, meta) => {
        // Track output length for token estimation
        outputLength += message.length
        log(message, meta)
      },
      isCanceled
    })

    const durationMs = Date.now() - startTime
    const inputTokens = estimateTokens(prompt)
    const outputTokens = estimateTokens(outputLength.toString()) || Math.ceil(outputLength / 4)

    return {
      inputTokens,
      outputTokens,
      durationMs,
      outputLength
    }
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
): Promise<AIExecutionResult> {
  log('Invoking Codex CLI...')

  const startTime = Date.now()
  let outputLength = 0

  try {
    await runProcessStreaming({
      command: 'codex',
      args: ['exec', '--full-auto', '-'],
      cwd,
      timeoutMs,
      source: 'codex',
      stdin: prompt,
      onLog: (message, meta) => {
        outputLength += message.length
        log(message, meta)
      },
      isCanceled
    })

    const durationMs = Date.now() - startTime
    const inputTokens = estimateTokens(prompt)
    const outputTokens = Math.ceil(outputLength / 4)

    return {
      inputTokens,
      outputTokens,
      durationMs,
      outputLength
    }
  } finally {
    // Cleanup if needed
  }
}

/**
 * Record usage after AI execution.
 */
function recordAIUsage(
  ctx: PipelineContext,
  tool: 'claude' | 'codex',
  result: AIExecutionResult,
  log: LogFn
): void {
  try {
    const totalTokens = result.inputTokens + result.outputTokens
    const costUsd = calculateCost(tool, result.inputTokens, result.outputTokens)

    createUsageRecord({
      projectId: ctx.project!.id,
      jobId: ctx.jobId ?? undefined,
      cardId: ctx.card?.id,
      toolType: tool,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens,
      costUsd,
      durationMs: result.durationMs,
      model: tool === 'claude' ? 'claude-sonnet-4' : 'codex'
    })

    log(
      `📊 Usage recorded: ${totalTokens.toLocaleString()} tokens (~$${costUsd.toFixed(4)}) in ${Math.round(result.durationMs / 1000)}s`
    )
  } catch (err) {
    // Don't fail the pipeline if usage recording fails
    log(`⚠️ Failed to record usage: ${err}`)
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

  // Detect available tools (cached for efficiency)
  const aiTools = await getAvailableAITools()
  const hasClaude = aiTools.claude
  const hasCodex = aiTools.codex

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

  // Check usage limits before running
  const limitCheck = checkLimitsExceeded(tool)
  if (limitCheck.exceeded) {
    log(`⚠️ ${tool} limit exceeded: ${limitCheck.reason}`)

    // Try fallback tool if allowed
    const fallbackTool = tool === 'claude' ? 'codex' : 'claude'
    const hasFallback = fallbackTool === 'claude' ? hasClaude : hasCodex

    if (limitCheck.fallbackAllowed && hasFallback) {
      const fallbackCheck = checkLimitsExceeded(fallbackTool)
      if (!fallbackCheck.exceeded) {
        log(`↪️ Falling back to ${fallbackTool}...`)
        tool = fallbackTool
      } else {
        log(`⚠️ ${fallbackTool} also exceeded: ${fallbackCheck.reason}`)
        log('❌ All AI tools have exceeded their limits. Cannot proceed.')
        // Create a stub file explaining the limit
        const planPath = join(workingDir, 'IMPLEMENTATION_PLAN.md')
        const fullPlan = `# Implementation Plan (Usage limits exceeded)

## Task
${ctx.card.title}

## Description
${ctx.card.body || 'No description'}

## Plan
${plan}

## Note
This PR was created without AI implementation because usage limits have been exceeded.
- ${limitCheck.reason}
- ${fallbackCheck.reason}

Please implement the changes manually or wait for limits to reset.
`
        writeFileSync(planPath, fullPlan)
        return false
      }
    } else if (!hasFallback) {
      log('❌ No fallback tool available. Cannot proceed.')
      return false
    }
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

    let executionResult: AIExecutionResult | null = null
    let usedTool: 'claude' | 'codex' = tool

    if (tool === 'claude') {
      try {
        executionResult = await runClaudeCode({
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
          executionResult = await runCodex(prompt, timeoutMs, workingDir, log, isCanceled)
          usedTool = 'codex'
        } else {
          throw error
        }
      }
    } else if (tool === 'codex') {
      executionResult = await runCodex(prompt, timeoutMs, workingDir, log, isCanceled)
    }

    // Record usage after successful execution
    if (executionResult) {
      recordAIUsage(ctx, usedTool, executionResult, log)
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
