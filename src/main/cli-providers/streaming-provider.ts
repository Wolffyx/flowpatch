/**
 * Streaming Provider Base Class
 *
 * Base class for CLI providers that support streaming execution
 * via async generators.
 */

import type {
  ICLIProvider,
  CLIProviderMetadata,
  CLIProviderCapabilities,
  TokenPricing,
  CLIExecutionOptions,
  CLIExecutionResult,
  LogFn
} from './types'
import type { ProviderMessage, UsageMessage } from './messages'
import type { ThinkingMode } from '../../shared/types'
import type { Installation } from './detection'
import { detectCLI } from './detection'
import { classifyError, ProviderError } from './errors'
import { events } from './events'
import { msg } from './messages'
import { runProcessStreaming } from '../worker/process-runner'

// ============================================================================
// Types
// ============================================================================

export interface StreamOptions extends CLIExecutionOptions {
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Job ID for event correlation */
  jobId?: string
  /** Card ID for event correlation */
  cardId?: string
}

// ============================================================================
// Streaming Provider Base Class
// ============================================================================

/**
 * Base class for streaming CLI providers.
 * Implements shared functionality with hooks for provider-specific behavior.
 */
export abstract class StreamingProvider implements ICLIProvider {
  // ============================================================================
  // Abstract Properties (must be implemented by subclasses)
  // ============================================================================

  abstract readonly metadata: CLIProviderMetadata
  abstract readonly capabilities: CLIProviderCapabilities
  abstract readonly pricing: TokenPricing

  // ============================================================================
  // Protected State
  // ============================================================================

  protected installation: Installation | null = null

  // ============================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ============================================================================

  /**
   * Build CLI arguments for execution.
   */
  abstract buildArgs(options: StreamOptions): string[]

  /**
   * Transform a raw event/line into a ProviderMessage.
   * Return null to skip the event.
   */
  abstract parseOutput(data: unknown): ProviderMessage | null

  // ============================================================================
  // Protected Overridable Methods
  // ============================================================================

  /**
   * Get stdin input if provider uses stdin for prompts.
   * Return undefined if the provider uses args/file input instead.
   */
  protected getStdin(_options: StreamOptions): string | undefined {
    return undefined
  }

  /**
   * Get additional environment variables for this provider.
   */
  protected getEnv(_options: StreamOptions): NodeJS.ProcessEnv {
    return {}
  }

  /**
   * Get default thinking budget for a thinking mode.
   */
  protected getDefaultThinkingBudget(mode: ThinkingMode): number | undefined {
    if (mode === 'none') return undefined

    const budgets: Record<Exclude<ThinkingMode, 'none'>, number> = {
      medium: 1024,
      deep: 4096,
      ultra: 16384
    }

    return budgets[mode]
  }

  // ============================================================================
  // Detection & Availability
  // ============================================================================

  async isAvailable(): Promise<boolean> {
    this.installation = await detectCLI(this.metadata.command)
    return this.installation.found
  }

  async checkEnvironment(): Promise<{ configured: boolean; missing: string[] }> {
    const required = this.capabilities.requiredEnvVars || []
    const missing = required.filter((varName) => !process.env[varName])
    return { configured: missing.length === 0, missing }
  }

  /**
   * Get installation details.
   */
  getInstallation(): Installation | null {
    return this.installation
  }

  // ============================================================================
  // Streaming Execution
  // ============================================================================

  /**
   * Execute with streaming output via async generator.
   */
  async *stream(options: StreamOptions): AsyncGenerator<ProviderMessage> {
    const args = this.buildArgs(options)
    const stdin = this.getStdin(options)
    const env = { ...process.env, ...this.getEnv(options), ...options.env }

    events.start(this.metadata.key, options.jobId, options.cardId)

    const startTime = Date.now()

    try {
      yield* this.runProcess({
        command: this.metadata.command,
        args,
        cwd: options.cwd,
        env,
        stdin,
        timeoutMs: options.timeoutMs,
        isCanceled: options.isCanceled,
        log: options.log
      })
    } catch (error) {
      const classified = classifyError(error)
      events.error(this.metadata.key, classified, options.jobId)
      throw classified
    }

    const durationMs = Date.now() - startTime
    events.complete(this.metadata.key, null, options.jobId, durationMs)
  }

  /**
   * Run the CLI process and yield parsed messages.
   */
  protected async *runProcess(config: {
    command: string
    args: string[]
    cwd: string
    env: NodeJS.ProcessEnv
    stdin?: string
    timeoutMs: number
    isCanceled: () => boolean
    log: LogFn
  }): AsyncGenerator<ProviderMessage> {
    // Collect output lines for later parsing
    const outputLines: string[] = []

    await runProcessStreaming({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      stdin: config.stdin,
      timeoutMs: config.timeoutMs,
      source: this.metadata.key,
      skipSecurityCheck: true, // AI providers are pre-validated
      isCanceled: config.isCanceled,
      onLog: (message, meta) => {
        outputLines.push(message)
        config.log(message, meta)
      }
    })

    // Parse collected output
    for (const line of outputLines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const parsed = this.parseLine(trimmed)
      if (parsed) {
        events.message(this.metadata.key, parsed)
        yield parsed
      }
    }

    // Emit completion
    yield msg.done('complete')
  }

  /**
   * Parse a single line of output.
   */
  protected parseLine(line: string): ProviderMessage | null {
    // Try JSON first
    try {
      const data = JSON.parse(line)
      return this.parseOutput(data)
    } catch {
      // Not JSON - treat as text
      return msg.text(line)
    }
  }

  // ============================================================================
  // Legacy Execute (delegates to streaming)
  // ============================================================================

  async execute(options: CLIExecutionOptions): Promise<CLIExecutionResult> {
    const start = Date.now()
    let outputLen = 0
    let usage: UsageMessage | null = null
    let error: ProviderError | undefined

    try {
      for await (const m of this.stream(options)) {
        if (m.kind === 'text') {
          outputLen += m.content.length
        }
        if (m.kind === 'usage') {
          usage = m
        }
      }

      return {
        success: true,
        inputTokens: usage?.input ?? this.estimateTokens(options.prompt),
        outputTokens: usage?.output ?? Math.ceil(outputLen / 4),
        thinkingTokens: usage?.reasoning,
        durationMs: Date.now() - start,
        outputLength: outputLen
      }
    } catch (e) {
      error = e instanceof ProviderError ? e : classifyError(e)
      return {
        success: false,
        inputTokens: this.estimateTokens(options.prompt),
        outputTokens: Math.ceil(outputLen / 4),
        durationMs: Date.now() - start,
        outputLength: outputLen,
        error: error.message
      }
    }
  }

  // ============================================================================
  // Token Estimation & Cost
  // ============================================================================

  estimateTokens(text: string): number {
    // Default: ~4 characters per token
    return Math.ceil(text.length / 4)
  }

  calculateCost(inputTokens: number, outputTokens: number, thinkingTokens = 0): number {
    const inputCost = (inputTokens / 1_000_000) * this.pricing.inputPerMillion
    const outputCost = (outputTokens / 1_000_000) * this.pricing.outputPerMillion
    const thinkingCost =
      thinkingTokens > 0 && this.pricing.thinkingPerMillion
        ? (thinkingTokens / 1_000_000) * this.pricing.thinkingPerMillion
        : 0

    return inputCost + outputCost + thinkingCost
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  isRetryableLimitError(error: unknown): boolean {
    return classifyError(error).retryable
  }

  parseError(output: string, _exitCode?: number): { message: string; isRetryable: boolean } {
    const err = classifyError(output)
    return { message: err.message, isRetryable: err.retryable }
  }
}
