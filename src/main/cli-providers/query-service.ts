/**
 * Query Service
 *
 * High-level API for AI provider interactions.
 */

import type { ProviderMessage, UsageMessage, ToolCallMessage } from './messages'
import type { StreamingProvider, StreamOptions } from './streaming-provider'
import type { ThinkingMode } from '../../shared/types'
import { ProviderFactory } from './factory'
import { classifyError, ProviderError } from './errors'

// ============================================================================
// Types
// ============================================================================

export interface QueryConfig {
  /** The prompt/instruction to send */
  prompt: string
  /** Explicit model to use */
  model?: string
  /** Explicit provider key to use */
  provider?: string
  /** Timeout in milliseconds */
  timeout?: number
  /** Working directory */
  cwd?: string
  /** Thinking mode */
  thinking?: ThinkingMode
  /** Custom thinking budget */
  thinkingBudget?: number
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Job ID for correlation */
  jobId?: string
  /** Card ID for correlation */
  cardId?: string
}

export interface QueryResult {
  /** Accumulated text content */
  text: string
  /** Tool calls made */
  tools: ToolCallMessage[]
  /** Usage information */
  usage: UsageMessage | null
  /** Query status */
  status: 'complete' | 'tool_use' | 'limit' | 'error'
  /** Error if status is 'error' */
  error?: ProviderError
  /** Provider that was used */
  provider: string
}

export interface StreamCallbacks {
  onText?: (content: string) => void
  onTool?: (call: ToolCallMessage) => void
  onReasoning?: (content: string) => void
  onUsage?: (usage: UsageMessage) => void
  onDone?: (reason: string) => void
}

// ============================================================================
// Query Service
// ============================================================================

/**
 * High-level query service for AI provider interactions.
 */
export class QueryService {
  constructor(private limitCheck?: (tool: string) => { exceeded: boolean }) {}

  /**
   * Execute a simple blocking query.
   */
  async query(config: QueryConfig): Promise<QueryResult> {
    let text = ''
    const tools: ToolCallMessage[] = []
    let usage: UsageMessage | null = null
    let status: QueryResult['status'] = 'complete'
    let error: ProviderError | undefined
    let providerKey = ''

    try {
      const provider = await this.resolveProvider(config)
      providerKey = provider.metadata.key

      for await (const m of this.streamQuery(config)) {
        switch (m.kind) {
          case 'text':
            text += m.content
            break
          case 'tool_call':
            tools.push(m)
            status = 'tool_use'
            break
          case 'usage':
            usage = m
            break
          case 'done':
            if (m.reason !== 'complete') {
              status = m.reason as QueryResult['status']
            }
            break
        }
      }
    } catch (e) {
      error = e instanceof ProviderError ? e : classifyError(e)
      status = 'error'
    }

    return { text, tools, usage, status, error, provider: providerKey }
  }

  /**
   * Execute a streaming query.
   */
  async *streamQuery(config: QueryConfig): AsyncGenerator<ProviderMessage> {
    const provider = await this.resolveProvider(config)

    const options: StreamOptions = {
      prompt: config.prompt,
      timeoutMs: config.timeout ?? 300_000,
      cwd: config.cwd ?? process.cwd(),
      log: () => {},
      isCanceled: () => config.signal?.aborted ?? false,
      thinkingMode: config.thinking,
      thinkingBudget: config.thinkingBudget,
      signal: config.signal,
      jobId: config.jobId,
      cardId: config.cardId
    }

    yield* provider.stream(options)
  }

  /**
   * Execute a streaming query with callbacks.
   */
  async streamWithCallbacks(config: QueryConfig, callbacks: StreamCallbacks): Promise<QueryResult> {
    let text = ''
    const tools: ToolCallMessage[] = []
    let usage: UsageMessage | null = null
    let status: QueryResult['status'] = 'complete'
    let error: ProviderError | undefined
    let providerKey = ''

    try {
      const provider = await this.resolveProvider(config)
      providerKey = provider.metadata.key

      for await (const m of this.streamQuery(config)) {
        switch (m.kind) {
          case 'text':
            text += m.content
            callbacks.onText?.(m.content)
            break
          case 'tool_call':
            tools.push(m)
            callbacks.onTool?.(m)
            status = 'tool_use'
            break
          case 'reasoning':
            callbacks.onReasoning?.(m.content)
            break
          case 'usage':
            usage = m
            callbacks.onUsage?.(m)
            break
          case 'done':
            callbacks.onDone?.(m.reason)
            if (m.reason !== 'complete') {
              status = m.reason as QueryResult['status']
            }
            break
        }
      }
    } catch (e) {
      error = e instanceof ProviderError ? e : classifyError(e)
      status = 'error'
    }

    return { text, tools, usage, status, error, provider: providerKey }
  }

  /**
   * Resolve provider from config.
   */
  private async resolveProvider(config: QueryConfig): Promise<StreamingProvider> {
    // Try explicit provider
    if (config.provider) {
      const p = ProviderFactory.get(config.provider)
      if (p) return p as StreamingProvider
    }

    // Try model-based routing
    if (config.model) {
      const p = ProviderFactory.get(config.model)
      if (p) return p as StreamingProvider
    }

    // Get best available
    const capabilities = config.thinking ? { supportsThinking: true } : undefined
    const p = await ProviderFactory.getBest(capabilities, this.limitCheck)

    if (!p) {
      throw ProviderError.unknown('No provider available')
    }

    return p as StreamingProvider
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

/**
 * Create a query service with optional limit checking.
 */
export function createQueryService(
  limitCheck?: (tool: string) => { exceeded: boolean }
): QueryService {
  return new QueryService(limitCheck)
}
