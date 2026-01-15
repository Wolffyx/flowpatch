/**
 * Log Interfaces
 *
 * Type definitions for log entries
 */

export interface LogEntry {
  id: string
  ts: string
  projectKey: string
  source: string
  stream: 'stdout' | 'stderr' | 'info' | 'error' | 'warn'
  line: string
}
