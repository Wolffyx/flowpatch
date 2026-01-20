export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export type ThemeName =
  | 'neutral'
  | 'slate'
  | 'stone'
  | 'zinc'
  | 'rose'
  | 'orange'
  | 'green'
  | 'blue'
  | 'violet'
  | 'yellow'
  | 'red'
  | 'cyan'
  | 'gray'
  | (string & {})

export interface ThemeConfig {
  name: ThemeName
  label: string
  colors: {
    primary: string
    secondary: string
  }
}
