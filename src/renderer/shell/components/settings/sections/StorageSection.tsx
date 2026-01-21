/**
 * Storage Section
 *
 * Project storage migration and management (Central DB → Local .flowpatch/project.db)
 */

import { useEffect, useState, useCallback } from 'react'
import { Database, HardDrive, Loader2, CheckCircle2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../../../src/components/ui/button'
import { Badge } from '../../../../src/components/ui/badge'
import { SettingsCard } from '../components/SettingsCard'
import { SettingRow } from '../components/SettingRow'
import { useSettingsContext } from '../hooks/useSettingsContext'

interface MigrationStatus {
  isMigrated: boolean
  projectDbExists: boolean
  hasCentralData: boolean
}

export function StorageSection(): React.JSX.Element {
  const { project } = useSettingsContext()

  const [status, setStatus] = useState<MigrationStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [centralCounts, setCentralCounts] = useState<Record<string, number>>({})

  const loadStorageStatus = useCallback(async () => {
    if (!project) return

    setLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('getMigrationStatus', {
        projectId: project.id
      })
      setStatus(result)

      // If not migrated, get counts
      if (!result.isMigrated && result.hasCentralData) {
        const countsResult = await window.electron.ipcRenderer.invoke('getCentralDataCounts', {
          projectId: project.id
        })
        setCentralCounts(countsResult.counts || {})
      }
    } catch (error) {
      console.error('Failed to load storage status:', error)
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    if (project) {
      void loadStorageStatus()
    }
  }, [project, loadStorageStatus])

  const handleMigrate = useCallback(async () => {
    if (!project) return

    setMigrating(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('migrateProjectToLocal', {
        projectId: project.id
      })

      if (result.success) {
        toast.success('Project migrated to local storage', {
          description: `${result.recordsMigrated} records migrated successfully`
        })
        await loadStorageStatus()
      } else {
        toast.error(`Migration failed: ${result.error}`)
      }
    } catch (error) {
      console.error('Migration failed:', error)
      toast.error('Migration failed')
    } finally {
      setMigrating(false)
    }
  }, [project, loadStorageStatus])

  const handleOpenWorkspace = useCallback(() => {
    if (!project) return
    window.electron.ipcRenderer.send('openWorkspaceFolder', { projectId: project.id })
  }, [project])

  if (!project) {
    return (
      <div className="text-sm text-muted-foreground">
        Select a project to manage its storage settings.
      </div>
    )
  }

  const totalRecords = Object.values(centralCounts).reduce((sum, count) => sum + count, 0)

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Project Storage"
        icon={<Database className="h-4 w-4 text-foreground/70" />}
        description="Manage where your project data is stored. Local storage makes projects portable and improves performance."
      >
        <div className="space-y-4">
          <SettingRow title="Current Storage Location" description="Where project data is stored">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : status?.isMigrated ? (
              <Badge variant="default" className="flex items-center gap-1.5">
                <HardDrive className="h-3 w-3" />
                Local Storage
              </Badge>
            ) : (
              <Badge variant="secondary" className="flex items-center gap-1.5">
                <Database className="h-3 w-3" />
                Central Database
              </Badge>
            )}
          </SettingRow>

          {status?.isMigrated && (
            <div className="rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/20 p-3">
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                <CheckCircle2 className="h-4 w-4" />
                <span className="font-medium">Project successfully migrated to local storage</span>
              </div>
              <p className="text-xs text-green-600 dark:text-green-400 mt-1 ml-6">
                Your project data is now stored in{' '}
                <code className="font-mono">.flowpatch/project.db</code>
              </p>
            </div>
          )}

          {!status?.isMigrated && status?.hasCentralData && (
            <>
              <div className="rounded-lg border p-4 bg-muted/30">
                <h4 className="font-medium text-sm mb-2">Migration Available</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  This project has <strong>{totalRecords} records</strong> in the central database.
                  Migrate to local storage to make your project portable.
                </p>

                {totalRecords > 0 && (
                  <div className="text-xs text-muted-foreground space-y-1 mb-3">
                    {Object.entries(centralCounts)
                      .filter(([, count]) => count > 0)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([table, count]) => (
                        <div key={table} className="flex items-center justify-between">
                          <span className="capitalize">{table.replace(/_/g, ' ')}</span>
                          <span className="font-mono font-medium">{count}</span>
                        </div>
                      ))}
                  </div>
                )}

                <Button onClick={handleMigrate} disabled={migrating || totalRecords === 0} size="sm">
                  {migrating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Migrating...
                    </>
                  ) : (
                    <>
                      <Database className="mr-2 h-4 w-4" />
                      Migrate to Local Storage
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </SettingsCard>

      {status?.projectDbExists && (
        <SettingsCard
          title="Workspace Files"
          icon={<HardDrive className="h-4 w-4 text-foreground/70" />}
          description="Open the .flowpatch folder to view your local project database and configuration."
        >
          <Button variant="outline" size="sm" onClick={handleOpenWorkspace}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open .flowpatch Folder
          </Button>
        </SettingsCard>
      )}
    </div>
  )
}
