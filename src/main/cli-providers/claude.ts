/**
 * Claude Code CLI Provider
 */

import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { BaseCLIProvider } from './base'
import type {
  CLIProviderMetadata,
  CLIProviderCapabilities,
  TokenPricing,
  CLIExecutionOptions,
  CLIExecutionResult
} from './types'

export class ClaudeProvider extends BaseCLIProvider {
  readonly metadata: CLIProviderMetadata = {
    key: 'claude',
    displayName: 'Claude Code',
    description: 'Anthropic Claude Code CLI for AI-powered development',
    command: 'claude',
    toolType: 'claude',
    defaultModel: 'claude-sonnet-4',
    documentationUrl: 'https://docs.anthropic.com/claude-code'
  }

  readonly capabilities: CLIProviderCapabilities = {
    supportsThinking: true,
    supportedThinkingModes: ['none', 'medium', 'deep', 'ultra'],
    supportsStdin: false,
    supportsFileInput: true,
    supportsStreaming: true,
    supportsAutoApprove: true,
    maxTimeoutMs: 0, // Unlimited
    features: {
      dangerouslySkipPermissions: true,
      printMode: true
    }
  }

  readonly pricing: TokenPricing = {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    thinkingPerMillion: 15.0
  }

  private promptFilePath: string | null = null

  buildArgs(options: CLIExecutionOptions): string[] {
    const args = ['--print', '--dangerously-skip-permissions', '-p', options.prompt]

    // Add extended thinking arguments if enabled
    if (options.thinkingMode && options.thinkingMode !== 'none') {
      const budget = options.thinkingBudget || this.getDefaultThinkingBudget(options.thinkingMode)
      if (budget) {
        args.push('--thinking-budget', budget.toString())
      }
    }

    return args
  }

  protected getStdinInput(_options: CLIExecutionOptions): string | undefined {
    // Claude uses -p argument, not stdin
    return undefined
  }

  protected getEnvironment(_options: CLIExecutionOptions): NodeJS.ProcessEnv {
    return {
      CLAUDE_CODE_ENTRYPOINT: 'cli'
    }
  }

  // Override to handle prompt file for audit/debugging
  async execute(options: CLIExecutionOptions): Promise<CLIExecutionResult> {
    // Write prompt to temp file for reference/audit
    this.promptFilePath = join(options.cwd, '.flowpatch-prompt.md')
    writeFileSync(this.promptFilePath, options.prompt)

    try {
      return await super.execute(options)
    } finally {
      // Cleanup prompt file
      if (this.promptFilePath) {
        try {
          unlinkSync(this.promptFilePath)
        } catch {
          // Ignore cleanup errors
        }
        this.promptFilePath = null
      }
    }
  }
}
