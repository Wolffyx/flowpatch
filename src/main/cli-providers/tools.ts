/**
 * Tool System for CLI Providers
 *
 * Provides semantic tool identifiers and command parsing
 * for mapping Codex shell commands to tool types.
 */

import type { ToolCallMessage } from './messages'

// ============================================================================
// Tool Constants
// ============================================================================

/**
 * Semantic tool identifiers used across providers.
 */
export const Tools = {
  EDIT: 'edit',
  READ: 'read',
  WRITE: 'write',
  SEARCH: 'search',
  LIST: 'list',
  DELETE: 'delete',
  SHELL: 'shell'
} as const

export type ToolName = (typeof Tools)[keyof typeof Tools]

// ============================================================================
// Command Parsing
// ============================================================================

interface ParsedCommand {
  tool: ToolName
  params: Record<string, unknown>
}

/**
 * Command patterns for semantic tool detection.
 */
const COMMAND_PATTERNS: Array<{ pattern: RegExp; tool: ToolName }> = [
  // File editing (sed -i, perl -i, patch)
  { pattern: /^(sed\s+-i|perl\s+-i|patch)\s/i, tool: Tools.EDIT },

  // File writing (redirection, tee, touch)
  { pattern: /[^>]>[^>]|>>|^(tee|touch)\s/i, tool: Tools.WRITE },

  // Content search (grep, ripgrep, ag, ack)
  { pattern: /^(rg|grep|ag|ack)\s/i, tool: Tools.SEARCH },

  // File/directory listing (find, fd, ls, tree)
  { pattern: /^(find|fd|ls|dir|tree)\s/i, tool: Tools.LIST },

  // File reading (cat, head, tail, less, more, bat)
  { pattern: /^(cat|head|tail|less|more|bat)\s/i, tool: Tools.READ },

  // File deletion (rm, del, unlink)
  { pattern: /^(rm|del|unlink)\s/i, tool: Tools.DELETE }
]

/**
 * Maps Codex shell commands to semantic tool names.
 * Returns the tool name and extracted parameters.
 */
export function parseShellCommand(cmd: string): ParsedCommand {
  const trimmed = cmd.trim()

  for (const { pattern, tool } of COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tool, params: { command: trimmed } }
    }
  }

  // Default to shell for unrecognized commands
  return { tool: Tools.SHELL, params: { command: trimmed } }
}

/**
 * Extract file paths from a command string.
 */
export function extractFilePaths(cmd: string): string[] {
  const paths: string[] = []

  // Match quoted paths
  const quotedPaths = cmd.match(/["']([^"']+)["']/g)
  if (quotedPaths) {
    for (const quoted of quotedPaths) {
      paths.push(quoted.slice(1, -1))
    }
  }

  // Match unquoted paths (simplified heuristic)
  const words = cmd.split(/\s+/)
  for (const word of words) {
    // Skip flags and commands
    if (word.startsWith('-') || word.includes('=')) continue

    // Check if it looks like a path
    if (word.includes('/') || word.includes('\\') || word.match(/\.\w+$/)) {
      // Skip quoted paths already added
      if (!paths.includes(word)) {
        paths.push(word)
      }
    }
  }

  return paths
}

// ============================================================================
// Tool Call Tracking
// ============================================================================

/**
 * Tracks pending tool calls for linking results.
 * Used to match tool outputs to their corresponding calls.
 */
export class ToolCallTracker {
  private pending = new Map<string, ToolCallMessage>()
  private queue: ToolCallMessage[] = []

  /**
   * Add a tool call to the tracker.
   * If the call has an ID, it's stored by ID.
   * Otherwise, it's added to a FIFO queue.
   */
  add(call: ToolCallMessage): void {
    if (call.id) {
      this.pending.set(call.id, call)
    } else {
      this.queue.push(call)
    }
  }

  /**
   * Pop a tool call by ID or from the queue.
   * Returns undefined if no matching call is found.
   */
  pop(id?: string): ToolCallMessage | undefined {
    if (id && this.pending.has(id)) {
      const call = this.pending.get(id)!
      this.pending.delete(id)
      return call
    }
    return this.queue.shift()
  }

  /**
   * Get a pending tool call without removing it.
   */
  peek(id?: string): ToolCallMessage | undefined {
    if (id) {
      return this.pending.get(id)
    }
    return this.queue[0]
  }

  /**
   * Check if there are any pending tool calls.
   */
  hasPending(): boolean {
    return this.pending.size > 0 || this.queue.length > 0
  }

  /**
   * Get the count of pending tool calls.
   */
  get count(): number {
    return this.pending.size + this.queue.length
  }

  /**
   * Clear all pending tool calls.
   */
  clear(): void {
    this.pending.clear()
    this.queue = []
  }
}

// ============================================================================
// Tool Validation
// ============================================================================

/**
 * Check if a tool name is valid.
 */
export function isValidToolName(name: string): name is ToolName {
  return Object.values(Tools).includes(name as ToolName)
}

/**
 * Get a human-readable description for a tool.
 */
export function getToolDescription(tool: ToolName): string {
  const descriptions: Record<ToolName, string> = {
    edit: 'Edit file contents',
    read: 'Read file contents',
    write: 'Write or create file',
    search: 'Search file contents',
    list: 'List files and directories',
    delete: 'Delete files',
    shell: 'Execute shell command'
  }
  return descriptions[tool]
}
