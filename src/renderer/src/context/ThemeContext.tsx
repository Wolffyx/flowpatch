import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { ThemePreference, ResolvedTheme, ThemeName, ThemeConfig } from '../../../shared/types'
import { loadTheme, AVAILABLE_THEMES, DEFAULT_THEME, isValidTheme } from '../lib/themes'

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
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

interface ThemeProviderProps {
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

export function ThemeProvider({ children }: ThemeProviderProps): React.JSX.Element {
  const [theme, setThemeState] = useState<ThemePreference>('system')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')
  const [themeName, setThemeNameState] = useState<ThemeName>(DEFAULT_THEME)
  const [isInitialized, setIsInitialized] = useState(false)

  // Resolve the actual theme based on preference and system setting
  const resolveTheme = useCallback(async (preference: ThemePreference): Promise<ResolvedTheme> => {
    if (preference === 'system') {
      const systemTheme = await window.electron.ipcRenderer.invoke('getSystemTheme')
      return systemTheme as ResolvedTheme
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
      // Load settings from localStorage first for fast initial render
      const settings = loadThemeSettings()

      // Then check IPC for authoritative appearance preference
      const savedTheme = await window.electron.ipcRenderer.invoke('getThemePreference')
      const preference = (savedTheme as ThemePreference) || settings.appearance

      // Update settings with IPC value
      settings.appearance = preference
      saveThemeSettings(settings)

      setThemeState(preference)
      setThemeNameState(settings.themeName)

      // Load the color theme CSS
      await loadTheme(settings.themeName)

      // Apply the appearance (light/dark)
      const resolved = await resolveTheme(preference)
      applyTheme(resolved)

      setIsInitialized(true)
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

  // Listen for theme changes broadcast from main process (for project views)
  useEffect(() => {
    if (!isInitialized) return

    const handleThemeChanged = (
      _event: unknown,
      data: { preference: ThemePreference; resolved: ResolvedTheme; themeName?: ThemeName }
    ): void => {
      setThemeState(data.preference)
      applyTheme(data.resolved)

      // Update theme name if provided
      if (data.themeName && isValidTheme(data.themeName)) {
        setThemeNameState(data.themeName)
        loadTheme(data.themeName)
      }

      saveThemeSettings({
        appearance: data.preference,
        themeName: data.themeName || themeName
      })
    }

    // Check if we have access to electron IPC (project views)
    if (window.electron?.ipcRenderer?.on) {
      try {
        window.electron.ipcRenderer.on('themeChanged', handleThemeChanged)
        return () => {
          window.electron.ipcRenderer.removeListener('themeChanged', handleThemeChanged)
        }
      } catch {
        // Channel might not be allowed in this context, that's ok
      }
    }

    return undefined
  }, [isInitialized, applyTheme, themeName])

  // Set theme preference
  const setTheme = useCallback(
    async (newTheme: ThemePreference): Promise<void> => {
      await window.electron.ipcRenderer.invoke('setThemePreference', newTheme)
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

      // Broadcast theme change to other windows via IPC
      try {
        await window.electron.ipcRenderer.invoke('broadcastThemeChange', {
          preference: theme,
          resolved: resolvedTheme,
          themeName: name
        })
      } catch {
        // broadcastThemeChange might not be implemented yet, that's ok
      }
    },
    [theme, resolvedTheme]
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
