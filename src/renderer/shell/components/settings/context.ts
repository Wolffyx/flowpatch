/**
 * Settings Context Definition
 *
 * Separate file for the context to satisfy react-refresh
 */

import { createContext } from 'react'
import type { Project } from '@shared/types'
import type { SettingsSection } from './types'

export interface SettingsContextValue {
  // Core shared state
  project: Project | null
  isLoading: boolean
  setIsLoading: (loading: boolean) => void

  // Section navigation
  activeSection: SettingsSection
  setActiveSection: (section: SettingsSection) => void

  // Modal control
  onClose: () => void

  // Unlink confirmation dialog
  showUnlinkConfirm: boolean
  setShowUnlinkConfirm: (show: boolean) => void

  // Reset confirmation dialog
  showResetConfirm: boolean
  setShowResetConfirm: (show: boolean) => void
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)
