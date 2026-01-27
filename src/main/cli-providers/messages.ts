/**
 * Unified Message Types for Streaming Providers
 *
 * These types provide a unified view of provider output regardless
 * of the underlying provider (Claude, Codex, OpenCode).
 */

// ============================================================================
// Message Types
// ============================================================================

export type MessageKind = 'text' | 'tool_call' | 'tool_output' | 'reasoning' | 'usage' | 'done'

export interface BaseMessage {
  kind: MessageKind
  ts: number
}

export interface TextMessage extends BaseMessage {
  kind: 'text'
  content: string
}

export interface ToolCallMessage extends BaseMessage {
  kind: 'tool_call'
  id: string
  tool: string
  args: Record<string, unknown>
  /** Original command for CLI-based providers */
  raw?: string
}

export interface ToolOutputMessage extends BaseMessage {
  kind: 'tool_output'
  callId: string
  output: string
  success: boolean
}

export interface ReasoningMessage extends BaseMessage {
  kind: 'reasoning'
  content: string
  budget?: number
}

export interface UsageMessage extends BaseMessage {
  kind: 'usage'
  input: number
  output: number
  reasoning?: number
}

export interface DoneMessage extends BaseMessage {
  kind: 'done'
  reason: 'complete' | 'tool_use' | 'limit' | 'error' | 'canceled'
}

export type ProviderMessage =
  | TextMessage
  | ToolCallMessage
  | ToolOutputMessage
  | ReasoningMessage
  | UsageMessage
  | DoneMessage

// ============================================================================
// Message Factory Helpers
// ============================================================================

/**
 * Helper functions to create messages with timestamp.
 */
export const msg = {
  text: (content: string): TextMessage => ({
    kind: 'text',
    content,
    ts: Date.now()
  }),

  toolCall: (
    id: string,
    tool: string,
    args: Record<string, unknown>,
    raw?: string
  ): ToolCallMessage => ({
    kind: 'tool_call',
    id,
    tool,
    args,
    raw,
    ts: Date.now()
  }),

  toolOutput: (callId: string, output: string, success: boolean): ToolOutputMessage => ({
    kind: 'tool_output',
    callId,
    output,
    success,
    ts: Date.now()
  }),

  reasoning: (content: string, budget?: number): ReasoningMessage => ({
    kind: 'reasoning',
    content,
    budget,
    ts: Date.now()
  }),

  usage: (input: number, output: number, reasoning?: number): UsageMessage => ({
    kind: 'usage',
    input,
    output,
    reasoning,
    ts: Date.now()
  }),

  done: (reason: DoneMessage['reason']): DoneMessage => ({
    kind: 'done',
    reason,
    ts: Date.now()
  })
}

// ============================================================================
// Type Guards
// ============================================================================

export function isTextMessage(msg: ProviderMessage): msg is TextMessage {
  return msg.kind === 'text'
}

export function isToolCallMessage(msg: ProviderMessage): msg is ToolCallMessage {
  return msg.kind === 'tool_call'
}

export function isToolOutputMessage(msg: ProviderMessage): msg is ToolOutputMessage {
  return msg.kind === 'tool_output'
}

export function isReasoningMessage(msg: ProviderMessage): msg is ReasoningMessage {
  return msg.kind === 'reasoning'
}

export function isUsageMessage(msg: ProviderMessage): msg is UsageMessage {
  return msg.kind === 'usage'
}

export function isDoneMessage(msg: ProviderMessage): msg is DoneMessage {
  return msg.kind === 'done'
}
