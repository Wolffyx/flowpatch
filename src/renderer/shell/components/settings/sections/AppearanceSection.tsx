/**
 * Appearance Section
 *
 * Theme selection settings
 */

import { useEffect } from 'react'
import { useThemeSettings } from '../hooks/useThemeSettings'
import { RadioOptionGroup } from '../components/RadioOptionGroup'
import { THEME_OPTIONS } from '../constants'

export function AppearanceSection(): React.JSX.Element {
  const { themePreference, loadThemeSettings, handleThemeChange } = useThemeSettings()

  useEffect(() => {
    loadThemeSettings()
  }, [loadThemeSettings])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Theme</h3>
        <p className="text-xs text-muted-foreground mb-4">Choose how Patchwork looks to you.</p>
      </div>
      <RadioOptionGroup
        options={THEME_OPTIONS}
        value={themePreference}
        onChange={handleThemeChange}
      />
    </div>
  )
}
