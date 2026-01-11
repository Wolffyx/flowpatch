/**
 * Appearance Section
 *
 * Theme selection settings including:
 * - Appearance mode (light/dark/system)
 * - Color theme selection
 */

import { useEffect } from 'react'
import { Check } from 'lucide-react'
import { useThemeSettings } from '../hooks/useThemeSettings'
import { RadioOptionGroup } from '../components/RadioOptionGroup'
import { THEME_OPTIONS } from '../constants'
import { cn } from '../../../../src/lib/utils'
import type { ThemeName } from '@shared/types'

export function AppearanceSection(): React.JSX.Element {
  const {
    themePreference,
    themeName,
    availableThemes,
    loadThemeSettings,
    handleThemeChange,
    handleThemeNameChange
  } = useThemeSettings()

  useEffect(() => {
    loadThemeSettings()
  }, [loadThemeSettings])

  return (
    <div className="space-y-8">
      {/* Appearance Mode Section */}
      <div>
        <h3 className="text-sm font-medium mb-1">Appearance</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Choose light or dark mode, or follow your system preference.
        </p>
        <RadioOptionGroup
          options={THEME_OPTIONS}
          value={themePreference}
          onChange={handleThemeChange}
        />
      </div>

      {/* Color Theme Section */}
      <div>
        <h3 className="text-sm font-medium mb-1">Color Theme</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Choose your preferred color palette.
        </p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {availableThemes.map((theme) => (
            <ThemeSwatch
              key={theme.name}
              name={theme.name}
              label={theme.label}
              primaryColor={theme.colors.primary}
              secondaryColor={theme.colors.secondary}
              isSelected={themeName === theme.name}
              onClick={() => handleThemeNameChange(theme.name)}
            />
          ))}
        </div>
        {availableThemes.length === 1 && (
          <p className="text-xs text-muted-foreground mt-3 italic">
            More themes coming soon. Add themes by creating CSS files in assets/themes/.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Theme Swatch Component
 *
 * Displays a color preview swatch for a theme
 */
interface ThemeSwatchProps {
  name: ThemeName
  label: string
  primaryColor: string
  secondaryColor: string
  isSelected: boolean
  onClick: () => void
}

function ThemeSwatch({
  label,
  primaryColor,
  secondaryColor,
  isSelected,
  onClick
}: ThemeSwatchProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-center gap-2 rounded-lg border p-3 transition-all',
        'hover:shadow-sm hover:border-primary/50',
        isSelected ? 'border-primary bg-primary/5 ring-2 ring-primary ring-offset-2' : 'border-border'
      )}
      title={label}
    >
      {/* Color preview */}
      <div className="flex h-10 w-full rounded-md overflow-hidden shadow-sm">
        <div className="flex-1" style={{ backgroundColor: primaryColor }} />
        <div className="flex-1" style={{ backgroundColor: secondaryColor }} />
      </div>

      {/* Theme name */}
      <span className="text-xs font-medium text-center truncate w-full">{label}</span>

      {/* Selected indicator */}
      {isSelected && (
        <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Check className="h-3 w-3" />
        </div>
      )}
    </button>
  )
}
