/**
 * Theme System Utilities
 *
 * Provides utilities for managing and loading color themes.
 * The default 'neutral' theme is embedded in main.css.
 * Additional themes can be added as CSS files in assets/themes/.
 */

import type { ThemeName, ThemeConfig } from '@shared/types'

/**
 * Registry of available themes with their display metadata.
 * The 'neutral' theme is the default and is embedded in main.css.
 * Add new themes here when creating additional theme CSS files.
 */
export const AVAILABLE_THEMES: ThemeConfig[] = [
  {
    name: 'neutral',
    label: 'Neutral',
    colors: {
      primary: 'oklch(0.6716 0.1368 48.513)',
      secondary: 'oklch(0.536 0.0398 196.028)'
    }
  }
  // Add more themes here as they are created:
  // {
  //   name: 'rose',
  //   label: 'Rose',
  //   colors: {
  //     primary: 'oklch(0.645 0.2 12)',
  //     secondary: 'oklch(0.6 0.15 350)'
  //   }
  // },
  // {
  //   name: 'blue',
  //   label: 'Blue',
  //   colors: {
  //     primary: 'oklch(0.6 0.2 250)',
  //     secondary: 'oklch(0.55 0.15 220)'
  //   }
  // },
]

/**
 * Default theme to use if none is specified
 */
export const DEFAULT_THEME: ThemeName = 'neutral'

/**
 * Get theme configuration by name
 */
export function getThemeConfig(name: ThemeName): ThemeConfig | undefined {
  return AVAILABLE_THEMES.find((t) => t.name === name)
}

/**
 * Check if a theme name is valid
 */
export function isValidTheme(name: string): name is ThemeName {
  return AVAILABLE_THEMES.some((t) => t.name === name)
}

/**
 * Theme CSS module imports - dynamically import theme CSS files
 * Using Vite's glob import for dynamic loading
 */
const themeModules = import.meta.glob('../assets/themes/*.css', { query: '?inline', eager: false })

/**
 * Cache for loaded theme styles
 */
const loadedThemes = new Map<ThemeName, string>()

/**
 * Currently active theme style element
 */
let activeStyleElement: HTMLStyleElement | null = null

/**
 * Current theme name
 */
let currentThemeName: ThemeName = DEFAULT_THEME

/**
 * Load and apply a theme by name
 *
 * The 'neutral' theme is the default embedded in main.css, so we don't need
 * to inject any CSS for it. For other themes, we dynamically load and inject
 * their CSS to override the defaults.
 *
 * @param themeName - The theme to load
 * @returns Promise that resolves when the theme is applied
 */
export async function loadTheme(themeName: ThemeName): Promise<void> {
  // Validate theme exists
  if (!isValidTheme(themeName)) {
    console.warn(`Theme "${themeName}" not found, falling back to "${DEFAULT_THEME}"`)
    themeName = DEFAULT_THEME
  }

  currentThemeName = themeName

  // For the default theme, just remove any injected theme CSS
  // The neutral theme is already in main.css
  if (themeName === DEFAULT_THEME) {
    if (activeStyleElement) {
      activeStyleElement.remove()
      activeStyleElement = null
    }
    return
  }

  // Check cache first
  let css = loadedThemes.get(themeName)

  if (!css) {
    // Build the module path
    const modulePath = `../assets/themes/${themeName}.css`

    // Check if module exists
    if (!themeModules[modulePath]) {
      console.error(`Theme CSS file not found: ${modulePath}`)
      return
    }

    try {
      // Dynamically import the CSS
      const module = (await themeModules[modulePath]()) as { default: string }
      css = module.default
      loadedThemes.set(themeName, css)
    } catch (error) {
      console.error(`Failed to load theme "${themeName}":`, error)
      return
    }
  }

  // Remove existing theme style element
  if (activeStyleElement) {
    activeStyleElement.remove()
  }

  // Create new style element with theme CSS
  activeStyleElement = document.createElement('style')
  activeStyleElement.id = 'flowpatch-theme'
  activeStyleElement.setAttribute('data-theme', themeName)
  activeStyleElement.textContent = css

  // Insert after the main CSS to properly override defaults
  document.head.appendChild(activeStyleElement)
}

/**
 * Get the currently active theme name
 */
export function getActiveTheme(): ThemeName {
  return currentThemeName
}
