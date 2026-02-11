/**
 * OpenCode CLI Provider
 *
 * Streaming provider for OpenCode CLI with model cache.
 * OpenCode is an open source AI coding agent that supports multiple model providers.
 * https://opencode.ai/docs
 */

import { exec as execCb } from 'child_process'
import { promisify } from 'util'
import { StreamingProvider, type StreamOptions } from './streaming-provider'
import type { CLIProviderMetadata, CLIProviderCapabilities, TokenPricing } from './types'
import type { ProviderMessage } from './messages'
import { msg } from './messages'

const exec = promisify(execCb)

export class OpencodeProvider extends StreamingProvider {
  readonly metadata: CLIProviderMetadata = {
    key: 'opencode',
    displayName: 'OpenCode',
    description: 'OpenCode CLI - open source AI coding agent',
    command: 'opencode',
    toolType: 'opencode',
    defaultModel: 'anthropic/claude-sonnet-4-5',
    documentationUrl: 'https://opencode.ai/docs'
  }

  readonly capabilities: CLIProviderCapabilities = {
    supportsThinking: true,
    // OpenCode uses: none, minimal, low, medium, high, xhigh
    // Map to project's ThinkingMode: none, medium, deep, ultra
    supportedThinkingModes: ['none', 'medium', 'deep', 'ultra'],
    supportsStdin: false,
    supportsFileInput: false,
    supportsStreaming: true,
    supportsAutoApprove: true,
    maxTimeoutMs: 0,
    features: {
      runMode: true,
      multiProvider: true
    }
  }

  readonly pricing: TokenPricing = {
    // Based on default Claude Sonnet pricing (OpenCode supports multiple providers)
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    thinkingPerMillion: 15.0
  }

  // Cache for available models
  private modelCache: { list: string[]; expires: number } | null = null
  private readonly MODEL_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  buildArgs(options: StreamOptions): string[] {
    return ['run', options.prompt]
  }

  protected getEnv(_options: StreamOptions): NodeJS.ProcessEnv {
    // OpenCode handles authentication internally (via `opencode auth`)
    // Set permission to allow all operations in non-interactive mode
    return {
      OPENCODE_PERMISSION: JSON.stringify({ edit: 'allow', bash: 'allow' })
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

      case 'usage': {
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

  /**
   * Get available models from OpenCode.
   */
  async getModels(): Promise<string[]> {
    // Check cache
    if (this.modelCache && Date.now() < this.modelCache.expires) {
      return this.modelCache.list
    }

    try {
      const { stdout } = await exec('opencode models', { timeout: 10000 })
      const list = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim())
      this.modelCache = { list, expires: Date.now() + this.MODEL_CACHE_TTL }
      return list
    } catch {
      // Return default models on error
      return ['anthropic/claude-sonnet-4-5', 'openai/gpt-4o']
    }
  }

  /**
   * Clear the model cache.
   */
  clearModelCache(): void {
    this.modelCache = null
  }
}
