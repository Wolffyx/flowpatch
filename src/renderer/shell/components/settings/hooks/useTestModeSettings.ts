/**
 * Test Mode Settings Hook
 *
 * Manages the worker test mode setting (global setting, not project-specific)
 */

import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'

interface UseTestModeSettingsReturn {
  testModeEnabled: boolean
  loading: boolean
  loadTestModeSettings: () => Promise<void>
  handleTestModeChange: (enabled: boolean) => Promise<void>
}

export function useTestModeSettings(): UseTestModeSettingsReturn {
  const [testModeEnabled, setTestModeEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadTestModeSettings = useCallback(async () => {
    setLoading(true)
    try {
      const defaults = await window.shellAPI.getDefaults()
      const value = defaults['worker.enableTestMode']
      const enabled = value === 'true'
      console.log('[TestModeSettings] Loaded setting:', { value, enabled })
      setTestModeEnabled(enabled)
    } catch (err) {
      console.error('[TestModeSettings] Failed to load test mode settings:', err)
      setTestModeEnabled(false)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleTestModeChange = useCallback(
    async (enabled: boolean) => {
      const previousValue = testModeEnabled
      setTestModeEnabled(enabled)
      try {
        await window.shellAPI.setDefaults({
          'worker.enableTestMode': enabled ? 'true' : 'false'
        })
        toast.success('Test mode setting updated', {
          description: enabled
            ? 'Test Modifications button will appear on cards with branches'
            : 'Test Modifications feature is disabled'
        })
      } catch (err) {
        setTestModeEnabled(previousValue)
        console.error('Failed to update test mode setting:', err)
        toast.error('Failed to update test mode setting', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [testModeEnabled]
  )

  useEffect(() => {
    void loadTestModeSettings()
  }, [loadTestModeSettings])

  return {
    testModeEnabled,
    loading,
    loadTestModeSettings,
    handleTestModeChange
  }
}
