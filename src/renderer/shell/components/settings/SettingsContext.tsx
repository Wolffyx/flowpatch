/**
 * Settings Provider Component
 *
 * Provides shared state for settings modal components
 */

import { useState, useCallback, type ReactNode } from 'react'
import type { Project } from '@shared/types'
import type { SettingsSection } from './types'
import { SettingsContext } from './context'

interface SettingsProviderProps {
  project: Project | null
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

export function SettingsProvider({
  project,
  onOpenChange,
  children
}: SettingsProviderProps): React.JSX.Element {
  const [isLoading, setIsLoading] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)

  const onClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <SettingsContext.Provider
      value={{
        project,
        isLoading,
        setIsLoading,
        activeSection,
        setActiveSection,
        onClose,
        showUnlinkConfirm,
        setShowUnlinkConfirm
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}
