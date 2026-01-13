/**
 * Danger Zone Section
 *
 * Project unlink and other destructive actions
 */

import { Unlink, Trash2 } from 'lucide-react'
import { Button } from '../../../../src/components/ui/button'
import { SettingsCard } from '../components/SettingsCard'
import { useSettingsContext } from '../hooks/useSettingsContext'

export function DangerZoneSection(): React.JSX.Element {
  const { project, setShowUnlinkConfirm, setShowResetConfirm } = useSettingsContext()

  return (
    <div className="space-y-4">
      {project && (
        <SettingsCard
          variant="danger"
          title="Unlink Project"
          icon={<Unlink className="h-4 w-4 text-destructive" />}
          description="Remove this project from FlowPatch. Your files and repository will not be deleted — only the project entry in FlowPatch will be removed."
        >
          <Button
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => setShowUnlinkConfirm(true)}
          >
            <Unlink className="h-4 w-4 mr-2" />
            Unlink Project
          </Button>
        </SettingsCard>
      )}

      <SettingsCard
        variant="danger"
        title="Reset Everything"
        icon={<Trash2 className="h-4 w-4 text-destructive" />}
        description="Return FlowPatch to a fresh install state. This will delete all projects, cards, settings, and API keys. Your project files and repositories will NOT be affected."
      >
        <Button
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => setShowResetConfirm(true)}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Reset Everything
        </Button>
      </SettingsCard>
    </div>
  )
}
