/**
 * OpenAI Codex CLI Provider
 */

import { BaseCLIProvider } from './base'
import type {
  CLIProviderMetadata,
  CLIProviderCapabilities,
  TokenPricing,
  CLIExecutionOptions
} from './types'

export class CodexProvider extends BaseCLIProvider {
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

  buildArgs(_options: CLIExecutionOptions): string[] {
    // Codex uses stdin for input with '-' argument
    return ['exec', '--full-auto', '-']
  }

  protected getStdinInput(options: CLIExecutionOptions): string {
    return options.prompt
  }

  protected getEnvironment(_options: CLIExecutionOptions): NodeJS.ProcessEnv {
    return {}
  }
}
