/**
 * BaseCLIProvider - Abstract base class for all CLI providers.
 *
 * Contains shared logic for execution, token estimation, cost calculation,
 * and error handling.
 */

import type {
  ICLIProvider,
  CLIProviderMetadata,
  CLIProviderCapabilities,
  TokenPricing,
  CLIExecutionOptions,
  CLIExecutionResult
} from './types'
import type { ThinkingMode } from '../../shared/types'
import { hasCommand } from '../worker/cache'
import { runProcessStreaming } from '../worker/process-runner'

/**
 * Abstract base class for CLI providers.
 * Implements shared functionality with hooks for provider-specific behavior.
 */
export abstract class BaseCLIProvider implements ICLIProvider {
  // ============================================================================
  // Abstract Properties (must be implemented by subclasses)
  // ============================================================================

  abstract readonly metadata: CLIProviderMetadata
  abstract readonly capabilities: CLIProviderCapabilities
  abstract readonly pricing: TokenPricing

  // ============================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ============================================================================

  /**
   * Build CLI arguments specific to this provider.
   */
  abstract buildArgs(options: CLIExecutionOptions): string[]

  /**
   * Get the stdin input if this provider uses stdin for prompts.
   * Return undefined if the provider uses args/file input instead.
   */
  protected abstract getStdinInput(options: CLIExecutionOptions): string | undefined

  /**
   * Get additional environment variables for this provider.
   */
  protected abstract getEnvironment(options: CLIExecutionOptions): NodeJS.ProcessEnv

  // ============================================================================
  // Availability (shared implementation)
  // ============================================================================

  async isAvailable(): Promise<boolean> {
    return hasCommand(this.metadata.command)
  }

  async checkEnvironment(): Promise<{ configured: boolean; missing: string[] }> {
    const required = this.capabilities.requiredEnvVars || []
    const missing = required.filter((varName) => !process.env[varName])
    return { configured: missing.length === 0, missing }
  }

  // ============================================================================
  // Execution (shared implementation with hooks)
  // ============================================================================

  async execute(options: CLIExecutionOptions): Promise<CLIExecutionResult> {
    const { prompt, timeoutMs, cwd, log, isCanceled } = options

    const args = this.buildArgs(options)
    const stdin = this.getStdinInput(options)
    const env = { ...process.env, ...this.getEnvironment(options), ...options.env }

    const startTime = Date.now()
    let outputLength = 0

    try {
      log(`Invoking ${this.metadata.displayName} CLI...`)

      // Log thinking mode if applicable
      if (options.thinkingMode && this.capabilities.supportsThinking) {
        const budget = options.thinkingBudget || this.getDefaultThinkingBudget(options.thinkingMode)
        if (budget) {
          log(`Extended thinking enabled: ${options.thinkingMode} mode (${budget} tokens)`)
        }
      }

      await runProcessStreaming({
        command: this.metadata.command,
        args,
        cwd,
        timeoutMs,
        source: this.metadata.key,
        env,
        stdin,
        onLog: (message, meta) => {
          outputLength += message.length
          log(message, meta)
        },
        isCanceled,
        // AI tools are validated through the provider registry, skip security checks
        // to avoid false positives from prompt content (which may contain code examples
        // with shell operators, backticks, etc.)
        skipSecurityCheck: true
      })

      const durationMs = Date.now() - startTime
      const inputTokens = this.estimateTokens(prompt)
      const outputTokens = Math.ceil(outputLength / 4)

      return {
        success: true,
        inputTokens,
        outputTokens,
        durationMs,
        outputLength
      }
    } catch (error) {
      const durationMs = Date.now() - startTime
      const inputTokens = this.estimateTokens(prompt)
      const outputTokens = Math.ceil(outputLength / 4)
      const errorMessage = error instanceof Error ? error.message : String(error)

      return {
        success: false,
        inputTokens,
        outputTokens,
        durationMs,
        outputLength,
        error: errorMessage
      }
    }
  }

  // ============================================================================
  // Token Estimation & Cost (shared implementation)
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
  // Error Handling (shared implementation, can be overridden)
  // ============================================================================

  isRetryableLimitError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error)
    const s = msg.toLowerCase()

    // Rate limit patterns
    const rateLimitPatterns = [
      'rate limit',
      'ratelimit',
      'rate_limit',
      'too many requests',
      'http 429',
      'status 429',
      '429'
    ]

    // Usage/quota limit patterns
    const usageLimitPatterns = [
      "you've hit your limit",
      'you\u2019ve hit your limit', // Unicode apostrophe
      'limit reached',
      'usage limit',
      'token limit',
      'context limit',
      'max tokens',
      'maximum tokens',
      'quota',
      'insufficient_quota',
      'credit',
      'billing'
    ]

    // Capacity/availability patterns
    const capacityPatterns = [
      'overloaded',
      'capacity',
      'temporarily unavailable',
      'service unavailable',
      'try again later',
      'exceeded'
    ]

    // Claude Code specific patterns
    const claudePatterns = ['anthropic', 'claude', 'api error', 'api_error']

    // Check all patterns
    for (const pattern of [...rateLimitPatterns, ...usageLimitPatterns, ...capacityPatterns]) {
      if (s.includes(pattern)) {
        return true
      }
    }

    // For Claude-specific errors, also check if it mentions limits
    for (const claudePattern of claudePatterns) {
      if (
        s.includes(claudePattern) &&
        (s.includes('limit') || s.includes('error') || s.includes('fail'))
      ) {
        return true
      }
    }

    return false
  }

  parseError(output: string, exitCode?: number): { message: string; isRetryable: boolean } {
    return {
      message: output || `Process exited with code ${exitCode}`,
      isRetryable: this.isRetryableLimitError(output)
    }
  }

  // ============================================================================
  // Protected Helpers
  // ============================================================================

  protected getDefaultThinkingBudget(mode: ThinkingMode): number | undefined {
    if (mode === 'none') return undefined

    const budgets: Record<Exclude<ThinkingMode, 'none'>, number> = {
      medium: 1024,
      deep: 4096,
      ultra: 16384
    }

    return budgets[mode]
  }
}
