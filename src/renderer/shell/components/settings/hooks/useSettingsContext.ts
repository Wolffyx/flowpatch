/**
 * Settings Context Hook
 *
 * Hook for accessing settings context (must be used within SettingsProvider)
 */

import { useContext } from 'react'
import { SettingsContext, type SettingsContextValue } from '../context'

export function useSettingsContext(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettingsContext must be used within SettingsProvider')
  }
  return context
}
