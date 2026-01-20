/**
 * AI Phase
 *
 * Handles AI tool execution using the CLIProviderRegistry.
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import {
  CLIProviderRegistry,
  type ICLIProvider,
  type CLIExecutionResult,
  type LogFn as CLILogFn
} from '../../cli-providers'
import { getWorkingDir, type PipelineContext, type LogFn } from './types'
import { buildContextBundle, buildPromptContext } from '../../services/flowpatch-context'
import { ensureRunDir } from '../../services/flowpatch-runs'
import {
  updateWorkerProgress,
  createUsageRecord,
  getHourlyUsage,
  getDailyUsage,
  getMonthlyUsage,
  getToolLimits
} from '../../db'
import type { ThinkingMode, AIToolType } from '../../../shared/types'
import { WorkerCanceledError } from '../process-runner'

// ============================================================================
// Usage Tracking
// ============================================================================

/**
 * Check if usage limits are exceeded for a tool.
 * Checks in order: hourly -> daily -> monthly (most restrictive first)
 */
export function checkLimitsExceeded(toolType: AIToolType): {
  exceeded: boolean
  reason?: string
  fallbackAllowed?: boolean
} {
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

## Project Memory (from .flowpatch)
${repoContext}

Please implement the changes now.`
}

// ============================================================================
// Deprecated Types (backward compatibility)
// ============================================================================

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

// ============================================================================
// Deprecated Functions (backward compatibility)
// ============================================================================

/**
 * Run Claude Code CLI.
 * @deprecated Use CLIProviderRegistry.get('claude').execute() instead
 */
export async function runClaudeCode(options: ClaudeCodeOptions): Promise<AIExecutionResult> {
  const provider = CLIProviderRegistry.get('claude')
  if (!provider) throw new Error('Claude provider not registered')

  const result = await provider.execute({
    prompt: options.prompt,
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
    log: options.log as CLILogFn,
    isCanceled: options.isCanceled,
    thinkingMode: options.thinkingMode,
    thinkingBudget: options.thinkingBudget
  })

  if (!result.success && result.error) {
    throw new Error(result.error)
  }

  return {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: result.durationMs,
    outputLength: result.outputLength
  }
}

/**
 * Run Codex CLI.
 * @deprecated Use CLIProviderRegistry.get('codex').execute() instead
 */
export async function runCodex(
  prompt: string,
  timeoutMs: number,
  cwd: string,
  log: LogFn,
  isCanceled: () => boolean
): Promise<AIExecutionResult> {
  const provider = CLIProviderRegistry.get('codex')
  if (!provider) throw new Error('Codex provider not registered')

  const result = await provider.execute({
    prompt,
    timeoutMs,
    cwd,
    log: log as CLILogFn,
    isCanceled
  })

  if (!result.success && result.error) {
    throw new Error(result.error)
  }

  return {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: result.durationMs,
    outputLength: result.outputLength
  }
}

// ============================================================================
// Usage Recording
// ============================================================================

/**
 * Record usage after AI execution.
 */
function recordAIUsage(
  ctx: PipelineContext,
  provider: ICLIProvider,
  result: CLIExecutionResult,
  log: LogFn
): void {
  try {
    const totalTokens = result.inputTokens + result.outputTokens
    const costUsd = provider.calculateCost(
      result.inputTokens,
      result.outputTokens,
      result.thinkingTokens
    )

    createUsageRecord({
      projectId: ctx.project!.id,
      jobId: ctx.jobId ?? undefined,
      cardId: ctx.card?.id,
      toolType: provider.metadata.toolType,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens,
      costUsd,
      durationMs: result.durationMs,
      model: provider.metadata.defaultModel
    })

    log(
      `📊 Usage recorded: ${totalTokens.toLocaleString()} tokens (~$${costUsd.toFixed(4)}) in ${Math.round(result.durationMs / 1000)}s`
    )
  } catch (err) {
    // Don't fail the pipeline if usage recording fails
    log(`⚠️ Failed to record usage: ${err}`)
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Try to execute with a single provider.
 * Returns the result and whether a rate limit error was detected.
 */
async function tryProvider(
  provider: ICLIProvider,
  prompt: string,
  timeoutMs: number,
  workingDir: string,
  log: LogFn,
  isCanceled: () => boolean,
  thinkingMode?: ThinkingMode,
  thinkingBudget?: number
): Promise<{ result: CLIExecutionResult; isRateLimited: boolean }> {
  const result = await provider.execute({
    prompt,
    timeoutMs,
    cwd: workingDir,
    log: log as CLILogFn,
    isCanceled,
    thinkingMode: provider.capabilities.supportsThinking ? thinkingMode : undefined,
    thinkingBudget
  })

  const isRateLimited = !result.success && result.error
    ? provider.isRetryableLimitError(result.error)
    : false

  return { result, isRateLimited }
}

/**
 * Run AI implementation using the provider registry.
 * Automatically tries fallback providers when rate limits are hit.
 */
export async function runAI(
  ctx: PipelineContext,
  plan: string,
  log: LogFn,
  isCanceled: () => boolean
): Promise<boolean> {
  if (!ctx.project || !ctx.card) return false

  const maxMinutes = ctx.policy.worker?.maxMinutes || 25
  const timeoutMs = maxMinutes * 60 * 1000
  const workingDir = getWorkingDir(ctx)

  // Build the prompt once (reused across providers)
  const prompt = await buildAIPrompt(ctx, plan)

  // Get thinking mode configuration from policy
  const thinkingConfig = ctx.policy.features?.thinking
  const thinkingEnabled = thinkingConfig?.enabled !== false
  const thinkingMode = thinkingEnabled ? thinkingConfig?.mode : undefined
  const thinkingBudget = thinkingConfig?.budgetTokens

  // Track which provider keys have been tried (to avoid retrying)
  const triedProviderKeys = new Set<string>()
  // Track which provider keys hit rate limits (for fallback selection)
  const rateLimitedProviderKeys = new Set<string>()

  // Use registry to select initial provider
  const { provider: initialProvider, fallbackUsed, reason } = await CLIProviderRegistry.selectProvider(
    ctx.policy,
    checkLimitsExceeded
  )

  if (!initialProvider) {
    log(`❌ No AI tool available: ${reason}`)
    await createStubPlan(ctx, plan, workingDir, reason || 'No AI tool available')
    return false
  }

  if (fallbackUsed) {
    log(`↪️ Note: ${reason}`)
  }

  let currentProvider: ICLIProvider | null = initialProvider
  let lastError: string | undefined

  // Try providers until one succeeds or all fail
  while (currentProvider) {
    // Check for cancellation
    if (isCanceled()) {
      throw new WorkerCanceledError('Job canceled')
    }

    triedProviderKeys.add(currentProvider.metadata.key)

    try {
      log(`🤖 Running ${currentProvider.metadata.displayName} with ${maxMinutes} minute timeout`)

      const { result, isRateLimited } = await tryProvider(
        currentProvider,
        prompt,
        timeoutMs,
        workingDir,
        log,
        isCanceled,
        thinkingMode,
        thinkingBudget
      )

      if (result.success) {
        // Success! Record usage and return
        recordAIUsage(ctx, currentProvider, result, log)
        log('✅ AI implementation completed')
        return true
      }

      // Execution failed
      lastError = result.error || 'AI execution failed'

      if (isRateLimited) {
        rateLimitedProviderKeys.add(currentProvider.metadata.key)
        log(`⚠️ ${currentProvider.metadata.displayName} rate limited: ${lastError}`)

        // Try to find another provider
        const { provider: nextProvider } = await CLIProviderRegistry.selectProvider(
          { ...ctx.policy, worker: { ...ctx.policy.worker, toolPreference: 'auto' } },
          (toolType) => {
            // Check if this toolType's provider was already tried or rate limited
            const provider = CLIProviderRegistry.get(toolType)
            if (provider && (triedProviderKeys.has(provider.metadata.key) || rateLimitedProviderKeys.has(provider.metadata.key))) {
              return { exceeded: true, reason: 'Already tried or rate limited' }
            }
            return checkLimitsExceeded(toolType)
          }
        )

        if (nextProvider && !triedProviderKeys.has(nextProvider.metadata.key)) {
          log(`↪️ Falling back to ${nextProvider.metadata.displayName}...`)
          currentProvider = nextProvider
          continue
        }

        // No more providers to try
        log(`❌ All available AI providers have been exhausted`)
        currentProvider = null
      } else {
        // Non-rate-limit error - don't try other providers for this type of failure
        log(`❌ ${currentProvider.metadata.displayName} failed: ${lastError}`)
        currentProvider = null
      }
    } catch (error) {
      if (error instanceof WorkerCanceledError) {
        throw error
      }

      lastError = error instanceof Error ? error.message : String(error)
      const providerName = currentProvider?.metadata.displayName ?? 'Unknown provider'
      const providerKey = currentProvider?.metadata.key
      log(`❌ ${providerName} error: ${lastError}`)

      // Check if this is a rate limit error from exception
      if (currentProvider && currentProvider.isRetryableLimitError(lastError)) {
        if (providerKey) rateLimitedProviderKeys.add(providerKey)

        // Try to find another provider
        const { provider: nextProvider } = await CLIProviderRegistry.selectProvider(
          { ...ctx.policy, worker: { ...ctx.policy.worker, toolPreference: 'auto' } },
          (toolType) => {
            const provider = CLIProviderRegistry.get(toolType)
            if (provider && (triedProviderKeys.has(provider.metadata.key) || rateLimitedProviderKeys.has(provider.metadata.key))) {
              return { exceeded: true, reason: 'Already tried or rate limited' }
            }
            return checkLimitsExceeded(toolType)
          }
        )

        if (nextProvider && !triedProviderKeys.has(nextProvider.metadata.key)) {
          log(`↪️ Falling back to ${nextProvider.metadata.displayName}...`)
          currentProvider = nextProvider
          continue
        }
      }

      currentProvider = null
    }
  }

  // All providers failed
  const triedList = Array.from(triedProviderKeys).join(', ')
  const finalReason = `All AI providers failed. Tried: ${triedList}. Last error: ${lastError || 'Unknown error'}`
  log(`❌ ${finalReason}`)
  await createStubPlan(ctx, plan, workingDir, finalReason)
  return false
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a stub plan file when AI execution cannot proceed.
 */
async function createStubPlan(
  ctx: PipelineContext,
  plan: string,
  workingDir: string,
  reason: string
): Promise<void> {
  const planPath = join(workingDir, 'IMPLEMENTATION_PLAN.md')
  const fullPlan = `# Implementation Plan (AI execution unavailable)

## Task
${ctx.card!.title}

## Description
${ctx.card!.body || 'No description'}

## Plan
${plan}

## Note
${reason}

Please implement the changes manually following the plan above.
`
  writeFileSync(planPath, fullPlan)
}
