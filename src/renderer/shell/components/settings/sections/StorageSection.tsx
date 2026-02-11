/**
 * Storage Section
 *
 * Project storage migration and management (Central DB → Local .flowpatch/project.db)
 */

import { useEffect, useState, useCallback } from 'react'
import { Database, HardDrive, Loader2, CheckCircle2, ExternalLink, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../../../src/components/ui/button'
import { Badge } from '../../../../src/components/ui/badge'
import { SettingsCard } from '../components/SettingsCard'
import { SettingRow } from '../components/SettingRow'
import { RadioOptionGroup } from '../components/RadioOptionGroup'
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
  const [storagePreference, setStoragePreference] = useState<'local' | 'central'>('local')
  const [loadingPreference, setLoadingPreference] = useState(false)

  const loadStorageStatus = useCallback(async () => {
    if (!project) return

    setLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('getMigrationStatus', {
        projectId: project.id
      })
      // Map the response to match the expected interface
      const mappedStatus = {
        isMigrated: result.status === 'migrated' || result.hasLocalDb || false,
        projectDbExists: result.hasLocalDb || result.projectDbExists || false,
        hasCentralData: result.hasCentralData || false
      }
      setStatus(mappedStatus)

      // Always get counts if there's central data (allows re-migration)
      // Also try to get counts even if hasCentralData is false, in case the check missed something
      try {
        const countsResult = await window.electron.ipcRenderer.invoke('getCentralDataCounts', {
          projectId: project.id
        })
        const counts = countsResult.counts || {}
        setCentralCounts(counts)
        
        // If we got counts but hasCentralData was false, update the status
        const totalCounts = Object.values(counts).reduce((sum: number, count: unknown) => sum + (typeof count === 'number' ? count : 0), 0)
        if (totalCounts > 0 && !mappedStatus.hasCentralData) {
          setStatus({
            ...mappedStatus,
            hasCentralData: true
          })
        }
      } catch (error) {
        console.error('Failed to get central data counts:', error)
        setCentralCounts({})
      }
    } catch (error) {
      console.error('Failed to load storage status:', error)
    } finally {
      setLoading(false)
    }
  }, [project])

  const loadStoragePreference = useCallback(async () => {
    if (!project) return

    setLoadingPreference(true)
    try {
      // Check if method exists (for development/hot reload scenarios)
      if (!window.shellAPI?.getStoragePreference) {
        console.warn('getStoragePreference not available, using default (local)')
        setStoragePreference('local')
        return
      }
      const result = await window.shellAPI.getStoragePreference(project.id)
      setStoragePreference(result.useLocalDb ? 'local' : 'central')
    } catch (error) {
      console.error('Failed to load storage preference:', error)
      // Default to local on error
      setStoragePreference('local')
    } finally {
      setLoadingPreference(false)
    }
  }, [project])

  const handleStoragePreferenceChange = useCallback(
    async (value: 'local' | 'central') => {
      if (!project) return

      // Check if method exists
      if (!window.shellAPI?.setStoragePreference) {
        toast.error('Storage preference API not available. Please restart the app.')
        return
      }

      const previousValue = storagePreference
      setStoragePreference(value)
      try {
        await window.shellAPI.setStoragePreference(project.id, value === 'local')
        toast.success('Storage preference updated')
        
        // If switching to local and DB doesn't exist, it will be created automatically on next card operation
        // Reload status to reflect the change
        if (value === 'local' && !status?.projectDbExists) {
          // The DB will be auto-created when resolveProjectDb is called
          // Just reload the status to show updated state
          await loadStorageStatus()
        }
      } catch (error) {
        console.error('Failed to update storage preference:', error)
        // Revert on error
        setStoragePreference(previousValue)
        toast.error('Failed to update storage preference', {
          description: error instanceof Error ? error.message : 'Unknown error'
        })
        // Reload preference on error
        await loadStoragePreference()
      }
    },
    [project, loadStoragePreference, storagePreference, status?.projectDbExists, loadStorageStatus]
  )

  useEffect(() => {
    if (project) {
      void loadStorageStatus()
      void loadStoragePreference()
    }
  }, [project, loadStorageStatus, loadStoragePreference])

  const handleMigrate = useCallback(async () => {
    if (!project) return

    setMigrating(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('migrateProjectToLocal', {
        projectId: project.id
      })

      if (result.success) {
        const recordsCount = result.result?.recordsCopied 
          ? Object.values(result.result.recordsCopied).reduce((sum: number, count: unknown) => sum + (typeof count === 'number' ? count : 0), 0)
          : 0
        toast.success(result.isReMigration ? 'Project re-migrated to local storage' : 'Project migrated to local storage', {
          description: recordsCount > 0 
            ? `${recordsCount} records migrated successfully`
            : 'Migration completed successfully'
        })
        await loadStorageStatus()
        await loadStoragePreference()
      } else {
        toast.error(`Migration failed: ${result.error || result.message || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Migration failed:', error)
      toast.error('Migration failed', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setMigrating(false)
    }
  }, [project, loadStorageStatus, loadStoragePreference])

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

  const totalRecords = Object.values(centralCounts).reduce((sum: number, count: unknown) => sum + (typeof count === 'number' ? count : 0), 0)

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Project Storage"
        icon={<Database className="h-4 w-4 text-foreground/70" />}
        description="Manage where your project data is stored. Local storage makes projects portable and improves performance."
      >
        <div className="space-y-4">
          <SettingRow
            title="Default Storage Location"
            description="Choose where new cards are saved. Local storage makes projects portable."
          >
            {loadingPreference ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <RadioOptionGroup
                options={[
                  {
                    id: 'local',
                    title: 'Local Database',
                    description: 'Cards saved in .flowpatch/project.db (recommended)',
                    icon: <HardDrive className="h-4 w-4 text-foreground/70" />
                  },
                  {
                    id: 'central',
                    title: 'Central Database',
                    description: 'Cards saved in app\'s central database',
                    icon: <Database className="h-4 w-4 text-foreground/70" />
                  }
                ]}
                value={storagePreference}
                onChange={handleStoragePreferenceChange}
              />
            )}
          </SettingRow>

          <SettingRow title="Current Storage Location" description="Where project data is currently stored">
            {loading || loadingPreference ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : storagePreference === 'local' ? (
              <Badge variant="default" className="flex items-center gap-1.5">
                <HardDrive className="h-3 w-3" />
                Local Storage
                {!status?.projectDbExists && (
                  <span className="text-xs ml-1">(will be created on first use)</span>
                )}
              </Badge>
            ) : (
              <Badge variant="secondary" className="flex items-center gap-1.5">
                <Database className="h-3 w-3" />
                Central Database
              </Badge>
            )}
          </SettingRow>

          {status?.isMigrated && !status?.hasCentralData && (
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

          {/* Migration section - always show if there's data to migrate or if project is migrated */}
          {(status?.hasCentralData || totalRecords > 0 || status?.isMigrated) && (
            <div className="rounded-lg border p-4 bg-muted/30">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="font-medium text-sm mb-1">
                    {status?.isMigrated ? 'Data Migration' : 'Migration Available'}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {status?.isMigrated
                      ? 'This project has data in local storage. You can re-migrate from central database to refresh data.'
                      : totalRecords > 0
                        ? `This project has ${totalRecords} records in the central database that can be migrated to local storage.`
                        : 'Migrate project data between storage locations.'}
                  </p>
                </div>
              </div>

              {totalRecords > 0 && (
                <div className="text-xs text-muted-foreground space-y-1 mb-3 p-2 bg-background/50 rounded border">
                  <div className="font-medium mb-1">Records in central database:</div>
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
                  {Object.values(centralCounts).filter(c => c > 0).length > 5 && (
                    <div className="text-xs text-muted-foreground/70 mt-1">
                      +{Object.values(centralCounts).filter(c => c > 0).length - 5} more tables
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                {(status?.hasCentralData || totalRecords > 0) && (
                  <Button 
                    onClick={handleMigrate} 
                    disabled={migrating || totalRecords === 0} 
                    size="sm"
                    title={totalRecords === 0 ? 'No data to migrate' : 'Migrate project data from central to local storage'}
                  >
                    {migrating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Migrating...
                      </>
                    ) : (
                      <>
                        <HardDrive className="mr-2 h-4 w-4" />
                        {status?.isMigrated ? 'Re-migrate to Local' : 'Migrate to Local'}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
          
          {/* Debug info in development */}
          {process.env.NODE_ENV === 'development' && status && (
            <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded border">
              <div>isMigrated: {String(status.isMigrated)}</div>
              <div>hasCentralData: {String(status.hasCentralData)}</div>
              <div>totalRecords: {totalRecords}</div>
              <div>projectDbExists: {String(status.projectDbExists)}</div>
            </div>
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

      <SettingsCard
        title="About Database Files"
        icon={<Info className="h-4 w-4 text-foreground/70" />}
        description="Information about SQLite database files in your project."
      >
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-muted-foreground mb-2">
              When using local storage, SQLite creates additional files alongside <code className="font-mono text-xs">project.db</code>:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
              <li>
                <code className="font-mono text-xs">project.db-shm</code> - Shared memory file for coordination
              </li>
              <li>
                <code className="font-mono text-xs">project.db-wal</code> - Write-Ahead Log for better performance
              </li>
            </ul>
          </div>
          <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 p-3">
            <div className="flex items-start gap-2 text-sm text-blue-700 dark:text-blue-300">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium mb-1">These files are normal and safe</p>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  SQLite automatically creates and manages these files when using WAL (Write-Ahead Logging) mode,
                  which provides better performance and concurrency. You can safely ignore them - they're part of
                  normal database operation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
