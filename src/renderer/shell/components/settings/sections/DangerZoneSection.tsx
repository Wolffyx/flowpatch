/**
 * Danger Zone Section
 *
 * Project unlink and other destructive actions
 */

import { useState, useEffect, useCallback } from 'react'
import { Unlink, Trash2, Database } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../../../src/components/ui/button'
import { SettingsCard } from '../components/SettingsCard'
import { useSettingsContext } from '../hooks/useSettingsContext'

export function DangerZoneSection(): React.JSX.Element {
  const { project, setShowUnlinkConfirm, setShowResetConfirm } = useSettingsContext()
  const [isMigrated, setIsMigrated] = useState(false)
  const [loading, setLoading] = useState(false)

  // Check migration status when project changes
  useEffect(() => {
    if (!project) {
      setIsMigrated(false)
      return
    }

    const checkMigrationStatus = async (): Promise<void> => {
      try {
        const result = await window.electron.ipcRenderer.invoke('getMigrationStatus', {
          projectId: project.id
        })
        setIsMigrated(result.isMigrated)
      } catch (error) {
        console.error('Failed to check migration status:', error)
      }
    }

    void checkMigrationStatus()
  }, [project])

  const handleCleanupCentralData = useCallback(async () => {
    if (!project) return

    const confirmed = confirm(
      'This will permanently delete project data from the central database.\n\n' +
        'Make sure the local migration is working first!\n\n' +
        'Continue?'
    )
    if (!confirmed) return

    setLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('cleanupCentralProjectData', {
        projectId: project.id
      })

      if (result.success) {
        toast.success('Central data cleaned up', {
          description: `Removed ${result.deletedRecords} records from central database`
        })
      } else {
        toast.error(`Cleanup failed: ${result.error}`)
      }
    } catch (error) {
      console.error('Cleanup failed:', error)
      toast.error('Cleanup failed')
    } finally {
      setLoading(false)
    }
  }, [project])

  return (
    <div className="space-y-4">
      {project && (
        <>
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

          {isMigrated && (
            <SettingsCard
              variant="danger"
              title="Remove Migrated Data from Central DB"
              icon={<Database className="h-4 w-4 text-destructive" />}
              description="After migrating to local storage, you can clean up the old data from the central database. This action cannot be undone. Make sure the local database is working correctly first!"
            >
              <Button
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={handleCleanupCentralData}
                disabled={loading}
              >
                <Database className="h-4 w-4 mr-2" />
                {loading ? 'Cleaning up...' : 'Remove Migrated Data from Central DB'}
              </Button>
            </SettingsCard>
          )}
        </>
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
