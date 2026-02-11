/**
 * Provider Session State
 *
 * Manages provider session state for conversation tracking.
 */

import type { ProviderMessage, UsageMessage, ToolCallMessage } from './messages'

// ============================================================================
// Types
// ============================================================================

export interface SessionContext {
  id: string
  provider: string
  startedAt: number
  messages: ProviderMessage[]
  totalTokens: number
  totalCostUsd: number
  correlationId?: string
}

/**
 * Context passed from one provider to another during handoff.
 */
export interface HandoffContext {
  /** Session that was interrupted */
  sessionId: string
  /** Provider that hit the limit */
  fromProvider: string
  /** Limit type that was hit */
  limitType: string
  /** Conversation messages captured so far */
  messages: ProviderMessage[]
  /** Files modified before the limit was hit */
  filesModified: string[]
  /** Git diff summary of changes made */
  diffSummary: string
  /** Summary of work completed */
  progressSummary: string
  /** Timestamp when limit was hit */
  hitAt: number
  /** Original prompt (for continuation) */
  originalPrompt: string
  /** Iteration number (for iterative sessions) */
  iteration?: number
  /** Last tool call that was in progress (if any) */
  pendingToolCall?: ToolCallMessage
}

export interface SessionStats {
  durationMs: number
  messageCount: number
  totalTokens: number
  totalCostUsd: number
}

// ============================================================================
// Provider Session Manager
// ============================================================================

/**
 * Manages provider session state.
 */
export class ProviderSession {
  private sessions = new Map<string, SessionContext>()

  /**
   * Create a new session.
   */
  create(provider: string, correlationId?: string): SessionContext {
    const id = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const session: SessionContext = {
      id,
      provider,
      startedAt: Date.now(),
      messages: [],
      totalTokens: 0,
      totalCostUsd: 0,
      correlationId
    }
    this.sessions.set(id, session)
    return session
  }

  /**
   * Get session by ID.
   */
  get(sessionId: string): SessionContext | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Add a message to session.
   */
  addMessage(sessionId: string, message: ProviderMessage): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.messages.push(message)

      if (message.kind === 'usage') {
        const usage = message as UsageMessage
        session.totalTokens += usage.input + usage.output + (usage.reasoning ?? 0)
      }
    }
  }

  /**
   * Update session cost.
   */
  addCost(sessionId: string, costUsd: number): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.totalCostUsd += costUsd
    }
  }

  /**
   * Get session messages.
   */
  getMessages(sessionId: string): ProviderMessage[] {
    return this.sessions.get(sessionId)?.messages ?? []
  }

  /**
   * Get text content from session.
   */
  getTextContent(sessionId: string): string {
    const messages = this.getMessages(sessionId)
    return messages
      .filter((m) => m.kind === 'text')
      .map((m) => (m as { content: string }).content)
      .join('')
  }

  /**
   * Get messages of a specific kind.
   */
  getMessagesByKind<K extends ProviderMessage['kind']>(
    sessionId: string,
    kind: K
  ): Extract<ProviderMessage, { kind: K }>[] {
    const messages = this.getMessages(sessionId)
    return messages.filter((m) => m.kind === kind) as Extract<ProviderMessage, { kind: K }>[]
  }

  /**
   * Get session statistics.
   */
  getStats(sessionId: string): SessionStats | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    return {
      durationMs: Date.now() - session.startedAt,
      messageCount: session.messages.length,
      totalTokens: session.totalTokens,
      totalCostUsd: session.totalCostUsd
    }
  }

  /**
   * Find sessions by correlation ID.
   */
  findByCorrelation(correlationId: string): SessionContext[] {
    return Array.from(this.sessions.values()).filter((s) => s.correlationId === correlationId)
  }

  /**
   * Find sessions by provider.
   */
  findByProvider(provider: string): SessionContext[] {
    return Array.from(this.sessions.values()).filter((s) => s.provider === provider)
  }

  /**
   * Close and remove session.
   */
  close(sessionId: string): SessionContext | undefined {
    const session = this.sessions.get(sessionId)
    if (session) {
      this.sessions.delete(sessionId)
    }
    return session
  }

  /**
   * Clear old sessions (older than TTL).
   */
  prune(maxAgeMs = 30 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs
    let pruned = 0
    for (const [id, session] of this.sessions) {
      if (session.startedAt < cutoff) {
        this.sessions.delete(id)
        pruned++
      }
    }
    return pruned
  }

  /**
   * Get all active sessions.
   */
  getAll(): SessionContext[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Get active session count.
   */
  get count(): number {
    return this.sessions.size
  }

  /**
   * Clear all sessions.
   */
  clear(): void {
    this.sessions.clear()
  }

  /**
   * Serialize session context for handoff to another provider.
   * Returns null if session not found.
   */
  serializeForHandoff(sessionId: string, limitType = 'unknown'): HandoffContext | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    const toolCalls = this.getMessagesByKind(sessionId, 'tool_call') as ToolCallMessage[]
    const toolOutputs = this.getMessagesByKind(sessionId, 'tool_output')

    // Find any pending tool call (started but no matching output)
    const pendingToolCall = toolCalls.find(
      (tc) => !toolOutputs.some((to) => (to as { callId: string }).callId === tc.id)
    )

    return {
      sessionId,
      fromProvider: session.provider,
      limitType,
      messages: [...session.messages],
      filesModified: [], // Filled by caller from git
      diffSummary: '', // Filled by caller from git
      progressSummary: this.summarizeProgress(session),
      hitAt: Date.now(),
      originalPrompt: '', // Filled by caller
      iteration: undefined,
      pendingToolCall
    }
  }

  /**
   * Build a continuation prompt from handoff context.
   */
  buildContinuationPrompt(handoff: HandoffContext): string {
    const sections: string[] = []

    sections.push(`## Context Continuation

You are continuing work that was started by another AI provider (${handoff.fromProvider}).
The previous provider encountered a ${handoff.limitType} limit.

### Progress So Far
${handoff.progressSummary}

### Files Modified
${handoff.filesModified.length > 0 ? handoff.filesModified.join('\n') : 'None yet'}

### Change Summary
${handoff.diffSummary || 'No changes committed yet'}
`)

    if (handoff.pendingToolCall) {
      sections.push(`### Pending Action
The previous provider was in the middle of this action:
Tool: ${handoff.pendingToolCall.tool}
Arguments: ${JSON.stringify(handoff.pendingToolCall.args, null, 2)}

Please continue from here.
`)
    }

    sections.push(`### Original Task
${handoff.originalPrompt}

Please continue the implementation from where the previous provider left off.`)

    return sections.join('\n')
  }

  /**
   * Summarize progress from a session for handoff context.
   */
  private summarizeProgress(session: SessionContext): string {
    const toolCalls = session.messages.filter((m) => m.kind === 'tool_call')
    const toolOutputs = session.messages.filter((m) => m.kind === 'tool_output')
    const textMessages = session.messages.filter((m) => m.kind === 'text')
    const successfulTools = toolOutputs.filter(
      (m) => (m as { success: boolean }).success
    ).length

    return `- Tool calls made: ${toolCalls.length} (${successfulTools} successful)
- Messages exchanged: ${textMessages.length}
- Tokens used: ${session.totalTokens.toLocaleString()}
- Duration: ${Math.round((Date.now() - session.startedAt) / 1000)}s
- Cost: $${session.totalCostUsd.toFixed(4)}`
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global provider session manager instance.
 */
export const sessions = new ProviderSession()
