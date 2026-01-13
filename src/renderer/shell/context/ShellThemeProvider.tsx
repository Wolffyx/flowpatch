/**
 * Shell Theme Provider
 *
 * Theme context provider for the shell renderer that uses shellAPI
 * instead of the electron bridge. Supports both appearance mode
 * (light/dark/system) and color themes.
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { ThemePreference, ResolvedTheme, ThemeName, ThemeConfig } from '@shared/types'
import { loadTheme, AVAILABLE_THEMES, DEFAULT_THEME, isValidTheme } from '../../src/lib/themes'

interface ThemeContextValue {
  /** Current theme appearance preference (light/dark/system) */
  theme: ThemePreference
  /** Resolved theme (light or dark) after applying system preference */
  resolvedTheme: ResolvedTheme
  /** Current color theme name */
  themeName: ThemeName
  /** List of available themes for the theme selector */
  availableThemes: ThemeConfig[]
  /** Set the appearance preference (light/dark/system) */
  setTheme: (theme: ThemePreference) => Promise<void>
  /** Set the color theme by name */
  setThemeName: (name: ThemeName) => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ShellThemeProvider')
  }
  return context
}

interface ShellThemeProviderProps {
  children: ReactNode
}

/** LocalStorage key for theme settings */
const THEME_STORAGE_KEY = 'flowpatch-theme-settings'

interface ThemeSettings {
  appearance: ThemePreference
  themeName: ThemeName
}

function loadThemeSettings(): ThemeSettings {
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
  // Also check legacy key for backwards compatibility
  const legacyTheme = localStorage.getItem('theme-preference') as ThemePreference | null
  return {
    appearance: legacyTheme || 'system',
    themeName: DEFAULT_THEME
  }
}

function saveThemeSettings(settings: ThemeSettings): void {
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(settings))
  // Also update legacy key for backwards compatibility
  localStorage.setItem('theme-preference', settings.appearance)
}

export function ShellThemeProvider({ children }: ShellThemeProviderProps): React.JSX.Element {
  const [theme, setThemeState] = useState<ThemePreference>('system')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')
  const [themeName, setThemeNameState] = useState<ThemeName>(DEFAULT_THEME)
  const [isInitialized, setIsInitialized] = useState(false)

  // Resolve the actual theme based on preference and system setting
  const resolveTheme = useCallback(async (preference: ThemePreference): Promise<ResolvedTheme> => {
    if (preference === 'system') {
      const systemTheme = await window.shellAPI.getSystemTheme()
      return systemTheme
    }
    return preference
  }, [])

  // Apply theme class to document
  const applyTheme = useCallback((resolved: ResolvedTheme) => {
    const root = document.documentElement
    if (resolved === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    setResolvedTheme(resolved)
  }, [])

  // Initialize theme from stored preference
  useEffect(() => {
    async function init(): Promise<void> {
      try {
        // Load settings from localStorage first for fast initial render
        const settings = loadThemeSettings()

        // Then check shell API for authoritative appearance preference
        const savedTheme = await window.shellAPI.getThemePreference()
        const preference = savedTheme || settings.appearance

        // Update settings with API value
        settings.appearance = preference
        saveThemeSettings(settings)

        setThemeState(preference)
        setThemeNameState(settings.themeName)

        // Load the color theme CSS (no-op for default neutral theme)
        await loadTheme(settings.themeName)

        // Apply the appearance (light/dark)
        const resolved = await resolveTheme(preference)
        applyTheme(resolved)

        setIsInitialized(true)
      } catch (error) {
        console.error('Failed to initialize theme:', error)
        // Default to system theme
        setIsInitialized(true)
      }
    }
    init()
  }, [resolveTheme, applyTheme])

  // Listen for system theme changes (when preference is 'system')
  useEffect(() => {
    if (!isInitialized || theme !== 'system') return

    // Use matchMedia to detect OS theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = (e: MediaQueryListEvent): void => {
      applyTheme(e.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [isInitialized, theme, applyTheme])

  // Set theme preference
  const setTheme = useCallback(
    async (newTheme: ThemePreference): Promise<void> => {
      await window.shellAPI.setThemePreference(newTheme)
      setThemeState(newTheme)
      const resolved = await resolveTheme(newTheme)
      applyTheme(resolved)

      saveThemeSettings({
        appearance: newTheme,
        themeName
      })
    },
    [resolveTheme, applyTheme, themeName]
  )

  // Set color theme name
  const setThemeNameFn = useCallback(
    async (name: ThemeName): Promise<void> => {
      if (!isValidTheme(name)) {
        console.warn(`Invalid theme name: ${name}`)
        return
      }

      await loadTheme(name)
      setThemeNameState(name)

      saveThemeSettings({
        appearance: theme,
        themeName: name
      })
    },
    [theme]
  )

  const value: ThemeContextValue = {
    theme,
    resolvedTheme,
    themeName,
    availableThemes: AVAILABLE_THEMES,
    setTheme,
    setThemeName: setThemeNameFn
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
