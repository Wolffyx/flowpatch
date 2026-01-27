/**
 * AI Phase
 *
 * Handles AI tool execution using the CLIProviderRegistry.
 * Supports automatic provider switching with handoff when limits are hit mid-execution.
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import {
  CLIProviderRegistry,
  type ICLIProvider,
  type CLIExecutionResult,
  type LogFn as CLILogFn,
  sessions,
  type HandoffContext
} from '../../cli-providers'
import { getWorkingDir, type PipelineContext, type LogFn } from './types'
import { buildContextBundle, buildPromptContext } from '../../services/flowpatch-context'
import { ensureRunDir } from '../../services/flowpatch-runs'
import {
  saveHandoffContext,
  loadHandoffContext,
  clearHandoffContext
} from '../../services/provider-handoff'
import { getModifiedFiles, getDiffStat } from '../git-operations'
import {
  updateWorkerProgress,
  createUsageRecord,
  getHourlyUsage,
  getDailyUsage,
  getMonthlyUsage,
  getToolLimits
} from '../../db'
import type {
  ThinkingMode,
  AIToolType,
  ProviderSwitchConfig
} from '../../../shared/types'
import { DEFAULT_PROVIDER_SWITCH_CONFIG } from '../../../shared/types/interfaces/provider-switch'
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
// Provider Switching with Handoff
// ============================================================================

/**
 * Get provider switch configuration from policy with defaults.
 */
function getProviderSwitchConfig(ctx: PipelineContext): ProviderSwitchConfig {
  const config = ctx.policy.features?.providerSwitch
  return {
    ...DEFAULT_PROVIDER_SWITCH_CONFIG,
    ...config
  }
}

/**
 * Enrich handoff context with git state (modified files and diff).
 */
async function enrichHandoffWithGitState(
  handoff: HandoffContext,
  workingDir: string,
  baseRef: string
): Promise<HandoffContext> {
  try {
    const filesModified = await getModifiedFiles(workingDir, baseRef)
    const diffSummary = await getDiffStat(workingDir, baseRef)
    return {
      ...handoff,
      filesModified,
      diffSummary
    }
  } catch {
    // If git operations fail, return handoff as-is
    return handoff
  }
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Handle the case when all providers are exhausted.
 * Implements pause-and-wait, fail-immediately, or queue-for-later based on config.
 */
async function handleExhaustedProviders(
  ctx: PipelineContext,
  config: ProviderSwitchConfig,
  originalPrompt: string,
  log: LogFn,
  isCanceled: () => boolean
): Promise<boolean> {
  if (config.exhaustedBehavior === 'fail_immediately') {
    log('❌ All providers exhausted, failing immediately (configured behavior)')
    return false
  }

  if (config.exhaustedBehavior === 'queue_for_later') {
    log('📋 All providers exhausted, job will be retried later')
    // Note: The job system will handle requeuing based on the return value
    return false
  }

  // pause_and_wait behavior
  const maxWaitMs = config.maxWaitMinutes * 60 * 1000
  const retryIntervalMs = config.retryIntervalMinutes * 60 * 1000
  const startWait = Date.now()

  log(
    `⏸️ All providers exhausted. Waiting up to ${config.maxWaitMinutes}m for limits to reset...`
  )

  while (Date.now() - startWait < maxWaitMs) {
    if (isCanceled()) {
      throw new WorkerCanceledError('Job canceled while waiting for provider availability')
    }

    // Wait for retry interval
    await sleep(retryIntervalMs)

    const elapsedMinutes = Math.round((Date.now() - startWait) / 60000)
    log(`⏳ Waited ${elapsedMinutes}m, checking provider availability...`)

    // Try to find an available provider
    const { provider } = await CLIProviderRegistry.selectProvider(ctx.policy, checkLimitsExceeded)

    if (provider) {
      log(`✅ ${provider.metadata.displayName} is now available! Resuming...`)
      // Return to main loop which will retry with the available provider
      return runAI(ctx, originalPrompt, log, isCanceled)
    }

    log('⏸️ No providers available yet, continuing to wait...')
  }

  log(`❌ Max wait time (${config.maxWaitMinutes}m) exceeded, all providers still unavailable`)
  return false
}

/**
 * Try to execute with a provider and create handoff context on limit errors.
 * Returns result, whether rate limited, and handoff context if applicable.
 */
async function tryProviderWithHandoff(
  provider: ICLIProvider,
  prompt: string,
  timeoutMs: number,
  workingDir: string,
  log: LogFn,
  isCanceled: () => boolean,
  thinkingMode?: ThinkingMode,
  thinkingBudget?: number
): Promise<{
  result: CLIExecutionResult
  isRateLimited: boolean
  handoffContext: HandoffContext | null
}> {
  // Create session for tracking
  const session = sessions.create(provider.metadata.key)

  try {
    const result = await provider.execute({
      prompt,
      timeoutMs,
      cwd: workingDir,
      log: log as CLILogFn,
      isCanceled,
      thinkingMode: provider.capabilities.supportsThinking ? thinkingMode : undefined,
      thinkingBudget
    })

    const isRateLimited =
      !result.success && result.error ? provider.isRetryableLimitError(result.error) : false

    // Create handoff context if rate limited
    let handoffContext: HandoffContext | null = null
    if (isRateLimited) {
      handoffContext = sessions.serializeForHandoff(session.id, 'rate_limit')
      if (handoffContext) {
        handoffContext.originalPrompt = prompt
      }
    }

    return { result, isRateLimited, handoffContext }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const isRateLimited = provider.isRetryableLimitError(errorMsg)

    // Create handoff context on rate limit exception
    let handoffContext: HandoffContext | null = null
    if (isRateLimited) {
      handoffContext = sessions.serializeForHandoff(session.id, 'rate_limit')
      if (handoffContext) {
        handoffContext.originalPrompt = prompt
      }
    }

    return {
      result: {
        success: false,
        error: errorMsg,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - session.startedAt,
        outputLength: 0
      },
      isRateLimited,
      handoffContext
    }
  } finally {
    sessions.close(session.id)
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
 * Supports mid-execution handoff with context preservation.
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
  const repoRoot = ctx.project.local_path
  const switchConfig = getProviderSwitchConfig(ctx)

  // Check for existing handoff context (resuming from previous provider)
  let activeHandoff: HandoffContext | null = null
  if (ctx.jobId) {
    activeHandoff = loadHandoffContext(repoRoot, ctx.jobId)
    if (activeHandoff) {
      log(`📋 Found handoff context from ${activeHandoff.fromProvider}, continuing work...`)
    }
  }

  // Build the prompt (or use continuation prompt if resuming)
  let currentPrompt: string
  if (activeHandoff) {
    currentPrompt = sessions.buildContinuationPrompt(activeHandoff)
  } else {
    currentPrompt = await buildAIPrompt(ctx, plan)
  }

  // Store original prompt for handoff
  const originalPrompt = await buildAIPrompt(ctx, plan)

  // Get thinking mode configuration from policy
  const thinkingConfig = ctx.policy.features?.thinking
  const thinkingEnabled = thinkingConfig?.enabled !== false
  const thinkingMode = thinkingEnabled ? thinkingConfig?.mode : undefined
  const thinkingBudget = thinkingConfig?.budgetTokens

  // Track which provider keys have been tried (to avoid retrying)
  const triedProviderKeys = new Set<string>()
  // Track which provider keys hit rate limits (for fallback selection)
  const rateLimitedProviderKeys = new Set<string>()

  // If resuming, mark the previous provider as already tried
  if (activeHandoff) {
    triedProviderKeys.add(activeHandoff.fromProvider)
    rateLimitedProviderKeys.add(activeHandoff.fromProvider)
  }

  // Use registry to select initial provider
  const { provider: initialProvider, fallbackUsed, reason } = await CLIProviderRegistry.selectProvider(
    ctx.policy,
    (toolType) => {
      // Skip providers we've already tried in this session
      const provider = CLIProviderRegistry.get(toolType)
      if (provider && triedProviderKeys.has(provider.metadata.key)) {
        return { exceeded: true, reason: 'Already tried' }
      }
      return checkLimitsExceeded(toolType)
    }
  )

  if (!initialProvider) {
    // Check if we should wait for providers
    if (switchConfig.mode !== 'disabled' && switchConfig.exhaustedBehavior === 'pause_and_wait') {
      return handleExhaustedProviders(ctx, switchConfig, originalPrompt, log, isCanceled)
    }
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

      // Use the handoff-aware execution
      const { result, isRateLimited, handoffContext } = await tryProviderWithHandoff(
        currentProvider,
        currentPrompt,
        timeoutMs,
        workingDir,
        log,
        isCanceled,
        thinkingMode,
        thinkingBudget
      )

      if (result.success) {
        // Success! Record usage, clear any handoff, and return
        recordAIUsage(ctx, currentProvider, result, log)
        if (ctx.jobId) {
          clearHandoffContext(repoRoot, ctx.jobId)
        }
        log('✅ AI implementation completed')
        return true
      }

      // Execution failed
      lastError = result.error || 'AI execution failed'

      if (isRateLimited) {
        rateLimitedProviderKeys.add(currentProvider.metadata.key)
        log(`⚠️ ${currentProvider.metadata.displayName} hit limit: ${lastError}`)

        // Check if provider switching is enabled
        if (switchConfig.mode === 'disabled') {
          log('❌ Provider switching is disabled')
          currentProvider = null
          continue
        }

        // Save handoff context for continuation
        if (handoffContext && ctx.jobId) {
          const enrichedHandoff = await enrichHandoffWithGitState(
            { ...handoffContext, originalPrompt },
            workingDir,
            ctx.progress?.baseHeadSha ?? 'HEAD~10'
          )
          saveHandoffContext(repoRoot, ctx.jobId, enrichedHandoff)
          log(`💾 Saved handoff context for continuation`)

          if (switchConfig.notifyOnSwitch) {
            log(`🔔 Provider ${currentProvider.metadata.displayName} hit limit, switching...`)
          }
        }

        // Try to find another provider
        const { provider: nextProvider } = await CLIProviderRegistry.selectProvider(
          { ...ctx.policy, worker: { ...ctx.policy.worker, toolPreference: 'auto' } },
          (toolType) => {
            const provider = CLIProviderRegistry.get(toolType)
            if (
              provider &&
              (triedProviderKeys.has(provider.metadata.key) ||
                rateLimitedProviderKeys.has(provider.metadata.key))
            ) {
              return { exceeded: true, reason: 'Already tried or rate limited' }
            }
            return checkLimitsExceeded(toolType)
          }
        )

        if (nextProvider && !triedProviderKeys.has(nextProvider.metadata.key)) {
          log(`↪️ Switching to ${nextProvider.metadata.displayName}...`)

          // Build continuation prompt from handoff
          if (handoffContext) {
            const enrichedHandoff = await enrichHandoffWithGitState(
              { ...handoffContext, originalPrompt },
              workingDir,
              ctx.progress?.baseHeadSha ?? 'HEAD~10'
            )
            currentPrompt = sessions.buildContinuationPrompt(enrichedHandoff)
          }

          currentProvider = nextProvider
          continue
        }

        // No more providers to try - check exhausted behavior
        log(`⚠️ All available AI providers have been exhausted`)
        if (switchConfig.exhaustedBehavior === 'pause_and_wait') {
          return handleExhaustedProviders(ctx, switchConfig, originalPrompt, log, isCanceled)
        }
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

        // Check if provider switching is enabled
        if (switchConfig.mode === 'disabled') {
          currentProvider = null
          continue
        }

        // Try to find another provider
        const { provider: nextProvider } = await CLIProviderRegistry.selectProvider(
          { ...ctx.policy, worker: { ...ctx.policy.worker, toolPreference: 'auto' } },
          (toolType) => {
            const provider = CLIProviderRegistry.get(toolType)
            if (
              provider &&
              (triedProviderKeys.has(provider.metadata.key) ||
                rateLimitedProviderKeys.has(provider.metadata.key))
            ) {
              return { exceeded: true, reason: 'Already tried or rate limited' }
            }
            return checkLimitsExceeded(toolType)
          }
        )

        if (nextProvider && !triedProviderKeys.has(nextProvider.metadata.key)) {
          log(`↪️ Switching to ${nextProvider.metadata.displayName}...`)
          currentProvider = nextProvider
          continue
        }

        // No more providers - check exhausted behavior
        if (switchConfig.exhaustedBehavior === 'pause_and_wait') {
          return handleExhaustedProviders(ctx, switchConfig, originalPrompt, log, isCanceled)
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
