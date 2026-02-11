/**
 * AI Debug Logging Setting Hook
 *
 * Global toggle that controls saving full AI agent logs to disk.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

interface UseAIDebugLoggingReturn {
  aiDebugLoggingEnabled: boolean
  loading: boolean
  loadAIDebugLogging: () => Promise<void>
  handleAIDebugLoggingChange: (enabled: boolean) => Promise<void>
}

export function useAIDebugLogging(): UseAIDebugLoggingReturn {
  const [aiDebugLoggingEnabled, setAiDebugLoggingEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadAIDebugLogging = useCallback(async () => {
    setLoading(true)
    try {
      const defaults = await window.shellAPI.getDefaults()
      setAiDebugLoggingEnabled(defaults['logs.aiDebugEnabled'] === 'true')
    } catch (err) {
      console.error('[AIDebugLogging] Failed to load setting', err)
      setAiDebugLoggingEnabled(false)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleAIDebugLoggingChange = useCallback(
    async (enabled: boolean) => {
      const previous = aiDebugLoggingEnabled
      setAiDebugLoggingEnabled(enabled)
      try {
        await window.shellAPI.setDefaults({
          'logs.aiDebugEnabled': enabled ? 'true' : 'false'
        })
        toast.success('AI debug logging updated', {
          description: enabled
            ? 'Full AI logs will be written to the local debug log file.'
            : 'AI debug logging disabled.'
        })
      } catch (err) {
        setAiDebugLoggingEnabled(previous)
        console.error('[AIDebugLogging] Failed to update setting', err)
        toast.error('Failed to update AI debug logging', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [aiDebugLoggingEnabled]
  )

  useEffect(() => {
    void loadAIDebugLogging()
  }, [loadAIDebugLogging])

  return {
    aiDebugLoggingEnabled,
    loading,
    loadAIDebugLogging,
    handleAIDebugLoggingChange
  }
}
