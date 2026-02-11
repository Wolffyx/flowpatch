/**
 * Claude Code CLI Provider
 *
 * Streaming provider for Anthropic Claude Code CLI.
 */

import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { StreamingProvider, type StreamOptions } from './streaming-provider'
import type {
  CLIProviderMetadata,
  CLIProviderCapabilities,
  TokenPricing,
  CLIExecutionOptions,
  CLIExecutionResult
} from './types'
import type { ProviderMessage } from './messages'
import { msg } from './messages'

export class ClaudeProvider extends StreamingProvider {
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
    maxTimeoutMs: 0,
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

  buildArgs(options: StreamOptions): string[] {
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

  protected getEnv(_options: StreamOptions): NodeJS.ProcessEnv {
    return {
      CLAUDE_CODE_ENTRYPOINT: 'cli'
    }
  }

  parseOutput(data: unknown): ProviderMessage | null {
    if (!data || typeof data !== 'object') return null
    const d = data as Record<string, unknown>

    switch (d.type) {
      case 'text':
      case 'assistant':
        return msg.text(String(d.content || d.message || ''))

      case 'tool_use':
        return msg.toolCall(
          String(d.id || ''),
          String(d.name || ''),
          (d.input as Record<string, unknown>) || {}
        )

      case 'tool_result':
        return msg.toolOutput(String(d.tool_use_id || ''), String(d.content || ''), !d.is_error)

      case 'thinking':
        return msg.reasoning(String(d.thinking || d.content || ''))

      case 'usage':
      case 'result': {
        const u = d.usage as Record<string, number> | undefined
        if (u) {
          return msg.usage(u.input_tokens ?? 0, u.output_tokens ?? 0, u.thinking_tokens)
        }
        return null
      }

      default:
        return null
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
