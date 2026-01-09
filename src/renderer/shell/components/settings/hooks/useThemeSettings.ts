/**
 * Theme Settings Hook
 *
 * Manages theme preference state and updates
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { ThemePreference } from '../types'

interface UseThemeSettingsReturn {
  themePreference: ThemePreference
  isLoading: boolean
  loadThemeSettings: () => Promise<void>
  handleThemeChange: (theme: ThemePreference) => Promise<void>
}

export function useThemeSettings(): UseThemeSettingsReturn {
  const [themePreference, setThemePreference] = useState<ThemePreference>('system')
  const [isLoading, setIsLoading] = useState(false)

  const loadThemeSettings = useCallback(async () => {
    setIsLoading(true)
    try {
      const theme = await window.shellAPI.getThemePreference()
      setThemePreference(theme)
    } catch (error) {
      console.error('Failed to load theme:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleThemeChange = useCallback(async (theme: ThemePreference) => {
    try {
      await window.shellAPI.setThemePreference(theme)
      setThemePreference(theme)
      const resolved = theme === 'system' ? await window.shellAPI.getSystemTheme() : theme
      document.documentElement.classList.toggle('dark', resolved === 'dark')
      toast.success('Theme updated', {
        description: `Switched to ${theme} theme`
      })
    } catch (error) {
      console.error('Failed to save theme:', error)
      toast.error('Failed to update theme', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }, [])

  return {
    themePreference,
    isLoading,
    loadThemeSettings,
    handleThemeChange
  }
}
