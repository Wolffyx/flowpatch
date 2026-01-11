/**
 * Theme Settings Hook
 *
 * Manages theme preference state (appearance & color theme) and updates
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { ThemePreference, ThemeName, ThemeConfig } from '@shared/types'
import { AVAILABLE_THEMES, DEFAULT_THEME, isValidTheme, loadTheme } from '../../../../src/lib/themes'

/** LocalStorage key for theme settings */
const THEME_STORAGE_KEY = 'patchwork-theme-settings'

interface ThemeSettings {
  appearance: ThemePreference
  themeName: ThemeName
}

function getStoredThemeSettings(): ThemeSettings {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ThemeSettings>
      return {
        appearance: parsed.appearance || 'system',
        themeName: isValidTheme(parsed.themeName || '') ? parsed.themeName! : DEFAULT_THEME
      }
    }
  } catch {
    // Ignore parse errors
  }
  return {
    appearance: 'system',
    themeName: DEFAULT_THEME
  }
}

function saveThemeSettings(settings: ThemeSettings): void {
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(settings))
  localStorage.setItem('theme-preference', settings.appearance)
}

interface UseThemeSettingsReturn {
  /** Current appearance preference (light/dark/system) */
  themePreference: ThemePreference
  /** Current color theme name */
  themeName: ThemeName
  /** List of available color themes */
  availableThemes: ThemeConfig[]
  /** Loading state */
  isLoading: boolean
  /** Load initial settings */
  loadThemeSettings: () => Promise<void>
  /** Change appearance (light/dark/system) */
  handleThemeChange: (theme: ThemePreference) => Promise<void>
  /** Change color theme */
  handleThemeNameChange: (name: ThemeName) => Promise<void>
}

export function useThemeSettings(): UseThemeSettingsReturn {
  const [themePreference, setThemePreference] = useState<ThemePreference>('system')
  const [themeName, setThemeName] = useState<ThemeName>(DEFAULT_THEME)
  const [isLoading, setIsLoading] = useState(false)

  const loadSettings = useCallback(async () => {
    setIsLoading(true)
    try {
      // Load appearance preference from API
      const theme = await window.shellAPI.getThemePreference()
      setThemePreference(theme)

      // Load color theme from localStorage
      const settings = getStoredThemeSettings()
      setThemeName(settings.themeName)

      // Ensure the theme CSS is loaded
      await loadTheme(settings.themeName)
    } catch (error) {
      console.error('Failed to load theme:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleThemeChange = useCallback(
    async (theme: ThemePreference) => {
      try {
        await window.shellAPI.setThemePreference(theme)
        setThemePreference(theme)
        const resolved = theme === 'system' ? await window.shellAPI.getSystemTheme() : theme
        document.documentElement.classList.toggle('dark', resolved === 'dark')

        saveThemeSettings({ appearance: theme, themeName })

        toast.success('Appearance updated', {
          description: `Switched to ${theme} mode`
        })
      } catch (error) {
        console.error('Failed to save theme:', error)
        toast.error('Failed to update appearance', {
          description: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    },
    [themeName]
  )

  const handleThemeNameChange = useCallback(
    async (name: ThemeName) => {
      if (!isValidTheme(name)) {
        toast.error('Invalid theme', { description: `Theme "${name}" is not available` })
        return
      }

      try {
        await loadTheme(name)
        setThemeName(name)

        saveThemeSettings({ appearance: themePreference, themeName: name })

        const themeConfig = AVAILABLE_THEMES.find((t) => t.name === name)
        toast.success('Color theme updated', {
          description: `Switched to ${themeConfig?.label || name}`
        })
      } catch (error) {
        console.error('Failed to load theme:', error)
        toast.error('Failed to update color theme', {
          description: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    },
    [themePreference]
  )

  return {
    themePreference,
    themeName,
    availableThemes: AVAILABLE_THEMES,
    isLoading,
    loadThemeSettings: loadSettings,
    handleThemeChange,
    handleThemeNameChange
  }
}
