/**
 * File Logging Setting Hook
 *
 * Global toggle that controls saving all application logs to disk.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

interface UseFileLoggingReturn {
  fileLoggingEnabled: boolean
  loading: boolean
  loadFileLogging: () => Promise<void>
  handleFileLoggingChange: (enabled: boolean) => Promise<void>
}

export function useFileLogging(): UseFileLoggingReturn {
  const [fileLoggingEnabled, setFileLoggingEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadFileLogging = useCallback(async () => {
    setLoading(true)
    try {
      const defaults = await window.shellAPI.getDefaults()
      setFileLoggingEnabled(defaults['logs.persistEnabled'] === 'true')
    } catch (err) {
      console.error('[FileLogging] Failed to load setting', err)
      setFileLoggingEnabled(false)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleFileLoggingChange = useCallback(
    async (enabled: boolean) => {
      const previous = fileLoggingEnabled
      setFileLoggingEnabled(enabled)
      try {
        await window.shellAPI.setDefaults({
          'logs.persistEnabled': enabled ? 'true' : 'false'
        })
        toast.success('File logging updated', {
          description: enabled
            ? 'All logs will be written to disk.'
            : 'File logging disabled.'
        })
      } catch (err) {
        setFileLoggingEnabled(previous)
        console.error('[FileLogging] Failed to update setting', err)
        toast.error('Failed to update file logging', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [fileLoggingEnabled]
  )

  useEffect(() => {
    void loadFileLogging()
  }, [loadFileLogging])

  return {
    fileLoggingEnabled,
    loading,
    loadFileLogging,
    handleFileLoggingChange
  }
}
