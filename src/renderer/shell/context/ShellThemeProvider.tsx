/**
 * Shell Theme Provider
 *
 * Theme context provider for the shell renderer that uses shellAPI
 * instead of the electron bridge.
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

type ThemePreference = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

interface ThemeContextValue {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemePreference) => Promise<void>
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

export function ShellThemeProvider({ children }: ShellThemeProviderProps): React.JSX.Element {
  const [theme, setThemeState] = useState<ThemePreference>('system')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')
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
        const savedTheme = await window.shellAPI.getThemePreference()
        const preference = savedTheme || 'system'

        // Sync localStorage for flash prevention on next load
        localStorage.setItem('theme-preference', preference)

        setThemeState(preference)
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
      // Update localStorage for flash prevention on next load
      localStorage.setItem('theme-preference', newTheme)

      await window.shellAPI.setThemePreference(newTheme)
      setThemeState(newTheme)
      const resolved = await resolveTheme(newTheme)
      applyTheme(resolved)
    },
    [resolveTheme, applyTheme]
  )

  const value: ThemeContextValue = {
    theme,
    resolvedTheme,
    setTheme
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
