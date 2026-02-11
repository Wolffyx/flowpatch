/**
 * OpenAI Codex CLI Provider
 *
 * Streaming provider for OpenAI Codex CLI with tool mapping.
 */

import { StreamingProvider, type StreamOptions } from './streaming-provider'
import type { CLIProviderMetadata, CLIProviderCapabilities, TokenPricing } from './types'
import type { ProviderMessage } from './messages'
import { msg } from './messages'
import { parseShellCommand, ToolCallTracker } from './tools'

export class CodexProvider extends StreamingProvider {
  readonly metadata: CLIProviderMetadata = {
    key: 'codex',
    displayName: 'Codex',
    description: 'OpenAI Codex CLI for AI-powered development',
    command: 'codex',
    toolType: 'codex',
    defaultModel: 'codex',
    documentationUrl: 'https://openai.com/codex'
  }

  readonly capabilities: CLIProviderCapabilities = {
    supportsThinking: false,
    supportsStdin: true,
    supportsFileInput: false,
    supportsStreaming: true,
    supportsAutoApprove: true,
    maxTimeoutMs: 0,
    features: {
      fullAuto: true,
      execMode: true
    }
  }

  readonly pricing: TokenPricing = {
    inputPerMillion: 2.5,
    outputPerMillion: 10.0
  }

  private tracker = new ToolCallTracker()
  private callCounter = 0

  buildArgs(options: StreamOptions): string[] {
    // Codex uses stdin for input with '-' argument.
    // On Windows, avoid --cd (path escaping can break workspace detection).
    // Also force a non-read-only sandbox mode to allow edits.
    const isWindows = process.platform === 'win32'
    const sandbox = isWindows ? 'danger-full-access' : 'workspace-write'
    const args = ['exec', '--sandbox', sandbox, '--full-auto']

    if (!isWindows) {
      args.push('--cd', options.cwd)
    }

    args.push('-')
    return args
  }

  protected getStdin(options: StreamOptions): string {
    return options.prompt
  }

  parseOutput(data: unknown): ProviderMessage | null {
    if (!data || typeof data !== 'object') return null
    const d = data as Record<string, unknown>

    switch (d.type) {
      case 'message':
        return msg.text(String(d.content || ''))

      case 'function_call': {
        const cmd = String(d.command || d.name || '')
        const parsed = parseShellCommand(cmd)
        const id = String(d.call_id || this.generateCallId())
        const call = msg.toolCall(id, parsed.tool, parsed.params, cmd)
        this.tracker.add(call)
        return call
      }

      case 'function_call_output': {
        const pending = this.tracker.pop(String(d.call_id || ''))
        return msg.toolOutput(
          pending?.id || String(d.call_id || ''),
          String(d.output || d.stdout || ''),
          d.exit_code === 0
        )
      }

      case 'usage': {
        const tokens = d.tokens as Record<string, number> | undefined
        if (tokens) {
          return msg.usage(tokens.input ?? 0, tokens.output ?? 0)
        }
        return null
      }

      default:
        return null
    }
  }

  private generateCallId(): string {
    return `codex-${Date.now()}-${++this.callCounter}`
  }
}
