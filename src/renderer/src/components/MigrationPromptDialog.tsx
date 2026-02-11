/**
 * Migration Prompt Dialog Component
 *
 * Shows a dismissible dialog prompting users to migrate project data
 * from central database to local .flowpatch/project.db storage.
 */

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Database, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'

export interface MigrationProgress {
  phase: 'validating' | 'migrating' | 'verifying' | 'complete'
  currentTable?: string
  tablesCompleted: number
  totalTables: number
  recordsProcessed: number
  totalRecords: number
  message: string
}

export interface MigrationPromptDialogProps {
  open: boolean
  projectId: string
  projectName: string
  centralCounts: Record<string, number>
  onConfirm: () => void
  onDismiss: () => void
  disabled?: boolean
}

export function MigrationPromptDialog({
  open,
  projectId,
  projectName,
  centralCounts,
  onConfirm,
  onDismiss,
  disabled = false
}: MigrationPromptDialogProps) {
  const [isMigrating, setIsMigrating] = useState(false)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)

  const totalRecords = Object.values(centralCounts).reduce((sum, count) => sum + count, 0)

  // Listen for migration progress events
  useEffect(() => {
    if (!open || !isMigrating) return

    const handleProgress = (_event: any, data: { projectId: string; progress: MigrationProgress }) => {
      if (data.projectId === projectId) {
        setProgress(data.progress)
      }
    }

    // @ts-expect-error - IPC event listener
    window.electron?.ipcRenderer?.on('migration-progress', handleProgress)

    return () => {
      // @ts-expect-error - IPC event listener
      window.electron?.ipcRenderer?.removeListener('migration-progress', handleProgress)
    }
  }, [open, isMigrating, projectId])

  const handleConfirm = async () => {
    setIsMigrating(true)
    setProgress({
      phase: 'validating',
      tablesCompleted: 0,
      totalTables: 0,
      recordsProcessed: 0,
      totalRecords: 0,
      message: 'Starting migration...'
    })
    try {
      await onConfirm()
    } finally {
      setIsMigrating(false)
      setProgress(null)
    }
  }

  const progressPercentage = progress
    ? Math.round((progress.tablesCompleted / progress.totalTables) * 100)
    : 0

  // Filter out tables with 0 records for cleaner display
  const nonZeroTables = Object.entries(centralCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]) // Sort by count descending

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !isMigrating && onDismiss()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <DialogTitle>Migrate "{projectName}" to Local Storage?</DialogTitle>
          </div>
          <DialogDescription className="space-y-2">
            <p>
              This project has <strong>{totalRecords} records</strong> in the central database.
              Moving them to local storage (.flowpatch/project.db) makes your project portable and
              improves performance.
            </p>
          </DialogDescription>
        </DialogHeader>

        {isMigrating && progress ? (
          <div className="space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{progress.message}</span>
                <span className="text-muted-foreground">{progressPercentage}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>

            {/* Current Status */}
            <div className="text-sm space-y-1">
              {progress.currentTable && (
                <p className="text-muted-foreground">
                  Table: <span className="font-mono">{progress.currentTable}</span>
                </p>
              )}
              <p className="text-muted-foreground">
                Progress: {progress.tablesCompleted} / {progress.totalTables} tables
              </p>
              {progress.recordsProcessed > 0 && (
                <p className="text-muted-foreground">
                  Records: {progress.recordsProcessed.toLocaleString()}
                </p>
              )}
            </div>

            {/* Phase Indicator */}
            <div className="flex items-center gap-2 text-sm">
              {progress.phase === 'validating' && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  <span>Validating...</span>
                </>
              )}
              {progress.phase === 'migrating' && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>Migrating data...</span>
                </>
              )}
              {progress.phase === 'verifying' && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-green-500" />
                  <span>Verifying migration...</span>
                </>
              )}
              {progress.phase === 'complete' && (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-green-600 dark:text-green-400">Migration complete!</span>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {nonZeroTables.length > 0 && (
              <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
                <h4 className="font-medium text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  Records to migrate:
                </h4>
                <ul className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                  {nonZeroTables.map(([table, count]) => (
                    <li key={table} className="flex items-center justify-between">
                      <span className="capitalize">{table.replace(/_/g, ' ')}</span>
                      <span className="font-mono text-xs font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-sm text-muted-foreground bg-blue-50 dark:bg-blue-950/20 rounded-md p-3 border border-blue-200 dark:border-blue-900">
              <p className="flex items-start gap-2">
                <span className="mt-0.5">💡</span>
                <span>
                  You can also migrate later using the button in project settings or the toolbar.
                </span>
              </p>
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onDismiss}
            disabled={isMigrating || disabled}
          >
            Not Now
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isMigrating || disabled || totalRecords === 0}
          >
            {isMigrating ? (
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
