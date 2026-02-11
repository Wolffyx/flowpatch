/**
 * Main Process Logger
 *
 * Wraps the shared logAction to also write to the file logger.
 * Use this in the main process instead of the shared logAction.
 */

import { logAction as sharedLogAction } from '@shared/utils'
import { logToFile } from './file-logger'

/**
 * Safely stringify an object, handling circular references.
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }
    // Handle Error objects specially
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      }
    }
    return value
  })
}

/**
 * Log an action with optional payload.
 * Writes to console and to file (if file logging is enabled).
 */
export const logAction = (action: string, payload?: unknown): void => {
  // Call the original shared logAction (writes to console)
  sharedLogAction(action, payload)

  // Also write to file logger
  let message: string
  try {
    message = payload !== undefined ? `${action} ${safeStringify(payload)}` : action
  } catch (err) {
    // If even safeStringify fails, log the error itself
    message = `${action} [Failed to stringify payload: ${err instanceof Error ? err.message : String(err)}]`
  }

  logToFile({
    id: `main_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    projectKey: 'global',
    source: 'main',
    stream: 'info',
    line: message
  })
}
