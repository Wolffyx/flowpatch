/**
 * Settings Modal Component
 *
 * Main settings dialog with sidebar navigation and section content.
 * Near full-screen layout with always-expanded sidebar.
 */

import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../../src/components/ui/dialog'
import { Button } from '../../../src/components/ui/button'
import { ScrollArea } from '../../../src/components/ui/scroll-area'
import type { Project } from '@shared/types'

import { SettingsProvider } from './SettingsContext'
import { useSettingsContext } from './hooks/useSettingsContext'
import { SettingsSidebar } from './SettingsSidebar'
import { UnlinkConfirmDialog } from './UnlinkConfirmDialog'
import {
  AppearanceSection,
  FeaturesSection,
  ShortcutsSection,
  AIAgentsSection,
  UsageLimitsSection,
  DangerZoneSection
} from './sections'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
}

function SettingsContent(): React.JSX.Element {
  const { activeSection, isLoading } = useSettingsContext()

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </div>
    )
  }

  switch (activeSection) {
    case 'appearance':
      return <AppearanceSection />
    case 'features':
      return <FeaturesSection />
    case 'shortcuts':
      return <ShortcutsSection />
    case 'ai-agents':
      return <AIAgentsSection />
    case 'usage-limits':
      return <UsageLimitsSection />
    case 'danger-zone':
      return <DangerZoneSection />
    default:
      return <AppearanceSection />
  }
}

function SettingsModalInner({
  onOpenChange
}: {
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { setActiveSection, setShowUnlinkConfirm } = useSettingsContext()

  // Reset to appearance section when dialog opens
  useEffect(() => {
    setActiveSection('appearance')
    setShowUnlinkConfirm(false)
  }, [setActiveSection, setShowUnlinkConfirm])

  return (
    <>
      <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
        <DialogTitle className="text-xl">Settings</DialogTitle>
        <DialogDescription>Configure appearance and project settings.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-1 min-h-0">
        <SettingsSidebar />

        <ScrollArea className="flex-1">
          <div className="p-6">
            <SettingsContent />
          </div>
        </ScrollArea>
      </div>

      <DialogFooter className="px-6 py-4 border-t shrink-0">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogFooter>

      <UnlinkConfirmDialog />
    </>
  )
}

export function SettingsModal({
  open,
  onOpenChange,
  project
}: SettingsModalProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-[calc(100vw-4rem)] max-w-[1400px] h-[calc(100vh-4rem)] flex flex-col p-0 gap-0 overflow-hidden">
        <SettingsProvider project={project} onOpenChange={onOpenChange}>
          <SettingsModalInner onOpenChange={onOpenChange} />
        </SettingsProvider>
      </DialogContent>
    </Dialog>
  )
}
