/**
 * Shell Logs Hook
 *
 * Manages logs state and operations
 */

import { useState, useEffect, useCallback } from 'react'
import type { LogEntry } from '../interfaces'

interface UseShellLogsReturn {
  /** Current log entries */
  logs: LogEntry[]
  /** Load logs from the shell API */
  loadLogs: () => Promise<void>
  /** Export logs to a file */
  handleExportLogs: () => Promise<void>
  /** Clear all logs from state */
  clearLogs: () => void
}

export function useShellLogs(): UseShellLogsReturn {
  const [logs, setLogs] = useState<LogEntry[]>([])

  const loadLogs = useCallback(async (): Promise<void> => {
    try {
      const logEntries = await window.shellAPI.getLogs()
      setLogs(logEntries.slice(-500))
    } catch (error) {
      console.error('Failed to load logs:', error)
    }
  }, [])

  const handleExportLogs = useCallback(async (): Promise<void> => {
    try {
      const filepath = await window.shellAPI.exportLogs()
      console.log('Logs exported to:', filepath)
    } catch (error) {
      console.error('Failed to export logs:', error)
    }
  }, [])

  const clearLogs = useCallback((): void => {
    setLogs([])
  }, [])

  // Subscribe to log entries
  useEffect(() => {
    const unsubscribe = window.shellAPI.onLogEntry((entry) => {
      setLogs((prev) => [...prev.slice(-499), entry])
    })
    return unsubscribe
  }, [])

  return {
    logs,
    loadLogs,
    handleExportLogs,
    clearLogs
  }
}
