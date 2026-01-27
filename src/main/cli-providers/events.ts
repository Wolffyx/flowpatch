/**
 * Provider Event System
 *
 * Standalone event emitter for provider execution with optional IPC integration.
 */

import type { ProviderMessage, UsageMessage } from './messages'
import type { ProviderError } from './errors'

// ============================================================================
// Event Types
// ============================================================================

export type EventType =
  | 'execution:start'
  | 'execution:message'
  | 'execution:complete'
  | 'execution:error'
  | 'execution:fallback'

export interface ExecutionEvent {
  type: EventType
  provider: string
  jobId?: string
  cardId?: string
  timestamp: number
  data?: unknown
}

export type EventHandler = (event: ExecutionEvent) => void

// ============================================================================
// Provider Event Bus
// ============================================================================

/**
 * Standalone event emitter for provider execution.
 * Can optionally forward events to IPC broadcast.
 */
export class ProviderEventBus {
  private handlers = new Map<EventType, Set<EventHandler>>()
  private globalHandlers = new Set<EventHandler>()
  private ipcForwarder?: (channel: string, ...args: unknown[]) => void

  /**
   * Enable forwarding events to IPC (for UI updates).
   */
  enableIPC(forwarder: (channel: string, ...args: unknown[]) => void): void {
    this.ipcForwarder = forwarder
  }

  /**
   * Disable IPC forwarding.
   */
  disableIPC(): void {
    this.ipcForwarder = undefined
  }

  /**
   * Register a handler for a specific event type.
   * Returns a function to unsubscribe.
   */
  on(type: EventType, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  /**
   * Register a handler for all events.
   * Returns a function to unsubscribe.
   */
  onAny(handler: EventHandler): () => void {
    this.globalHandlers.add(handler)
    return () => this.globalHandlers.delete(handler)
  }

  /**
   * Emit an event to all registered handlers.
   */
  emit(event: ExecutionEvent): void {
    // Type-specific handlers
    this.handlers.get(event.type)?.forEach((h) => {
      try {
        h(event)
      } catch (error) {
        console.error('[ProviderEventBus] Handler error:', error)
      }
    })

    // Global handlers
    this.globalHandlers.forEach((h) => {
      try {
        h(event)
      } catch (error) {
        console.error('[ProviderEventBus] Global handler error:', error)
      }
    })

    // IPC forwarding (if enabled)
    this.ipcForwarder?.('provider:event', event)
  }

  /**
   * Remove all handlers for a specific event type.
   */
  off(type: EventType): void {
    this.handlers.delete(type)
  }

  /**
   * Remove all handlers.
   */
  clear(): void {
    this.handlers.clear()
    this.globalHandlers.clear()
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /**
   * Emit an execution start event.
   */
  start(provider: string, jobId?: string, cardId?: string): void {
    this.emit({
      type: 'execution:start',
      provider,
      jobId,
      cardId,
      timestamp: Date.now()
    })
  }

  /**
   * Emit a message event.
   */
  message(provider: string, message: ProviderMessage, jobId?: string): void {
    this.emit({
      type: 'execution:message',
      provider,
      jobId,
      timestamp: Date.now(),
      data: message
    })
  }

  /**
   * Emit an execution complete event.
   */
  complete(
    provider: string,
    usage: UsageMessage | null,
    jobId?: string,
    durationMs?: number
  ): void {
    this.emit({
      type: 'execution:complete',
      provider,
      jobId,
      timestamp: Date.now(),
      data: { usage, durationMs }
    })
  }

  /**
   * Emit an error event.
   */
  error(provider: string, error: ProviderError, jobId?: string): void {
    this.emit({
      type: 'execution:error',
      provider,
      jobId,
      timestamp: Date.now(),
      data: {
        kind: error.kind,
        message: error.message,
        retryable: error.retryable
      }
    })
  }

  /**
   * Emit a fallback event.
   */
  fallback(from: string, to: string, reason: string, jobId?: string): void {
    this.emit({
      type: 'execution:fallback',
      provider: to,
      jobId,
      timestamp: Date.now(),
      data: { from, reason }
    })
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global provider event bus instance.
 */
export const events = new ProviderEventBus()
