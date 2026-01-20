/**
 * OpenCode CLI Provider
 *
 * OpenCode is an open source AI coding agent that supports multiple model providers.
 * https://opencode.ai/docs
 */

import { BaseCLIProvider } from './base'
import type {
  CLIProviderMetadata,
  CLIProviderCapabilities,
  TokenPricing,
  CLIExecutionOptions
} from './types'

export class OpencodeProvider extends BaseCLIProvider {
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
    supportsStdin: false, // Uses command-line argument
    supportsFileInput: false,
    supportsStreaming: true,
    supportsAutoApprove: true, // Non-interactive mode auto-approves
    maxTimeoutMs: 0, // Unlimited
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

  buildArgs(options: CLIExecutionOptions): string[] {
    // opencode run "prompt"
    const args = ['run', options.prompt]

    return args
  }

  protected getStdinInput(_options: CLIExecutionOptions): string | undefined {
    // OpenCode uses command-line argument for prompt, not stdin
    return undefined
  }

  protected getEnvironment(_options: CLIExecutionOptions): NodeJS.ProcessEnv {
    // OpenCode handles authentication internally (via `opencode auth`)
    // Set permission to allow all operations in non-interactive mode
    return {
      OPENCODE_PERMISSION: JSON.stringify({ edit: 'allow', bash: 'allow' })
    }
  }
}
