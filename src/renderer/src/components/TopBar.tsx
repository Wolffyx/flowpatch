import {
  RefreshCw,
  Command,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  Pause,
  Bot,
  Settings,
  Terminal
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { Badge } from './ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'
import { cn } from '../lib/utils'
import { formatRelativeTime } from '../lib/utils'
import { acceleratorToDisplay, detectPlatform } from '@shared/accelerator'
import type { Project, Job, Card } from '../../../shared/types'
import { SettingsDialog, type WorkerToolPreference } from './SettingsDialog'

interface SyncSchedulerStatus {
  running: boolean
  pollIntervalMs: number
  autoSyncOnAction: boolean
  isSyncing: boolean
  nextSyncAt: number | null
  lastSyncAt: number | null
}

interface TopBarProps {
  project: Project | null
  jobs: Job[]
  cards: Card[]
  isLoading: boolean
  onSync: () => void
  onToggleWorker: (enabled: boolean) => void
  onOpenCommandPalette: () => void
  commandPaletteShortcut?: string
  onSetWorkerToolPreference: (toolPreference: WorkerToolPreference) => Promise<void>
  onSetWorkerRollbackOnCancel: (rollbackOnCancel: boolean) => Promise<void>
  onSetShowPullRequestsSection: (showPullRequestsSection: boolean) => Promise<void>
  onOpenWorkerLogs: () => void
}

export function TopBar({
  project,
  jobs,
  cards,
  isLoading,
  onSync,
  onToggleWorker,
  onOpenCommandPalette,
  commandPaletteShortcut,
  onSetWorkerToolPreference,
  onSetWorkerRollbackOnCancel,
  onSetShowPullRequestsSection,
  onOpenWorkerLogs
}: TopBarProps): React.JSX.Element {
  const platform = detectPlatform()
  const commandPaletteLabel = commandPaletteShortcut
    ? acceleratorToDisplay(commandPaletteShortcut, platform)
    : 'Ctrl+K'
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [syncSchedulerStatus, setSyncSchedulerStatus] = useState<SyncSchedulerStatus | null>(null)
  const [timeUntilSync, setTimeUntilSync] = useState<string | null>(null)
  const runningJobs = jobs.filter((j) => j.state === 'running')

  // Fetch sync scheduler status
  const fetchSyncSchedulerStatus = useCallback(async () => {
    if (!project?.id) {
      setSyncSchedulerStatus(null)
      return
    }
    try {
      const status = await window.electron.ipcRenderer.invoke('getSyncSchedulerStatus', {
        projectId: project.id
      })
      setSyncSchedulerStatus(status)
    } catch {
      setSyncSchedulerStatus(null)
    }
  }, [project?.id])

  // Fetch status periodically
  useEffect(() => {
    fetchSyncSchedulerStatus()
    const interval = setInterval(fetchSyncSchedulerStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchSyncSchedulerStatus])

  // Update countdown timer
  useEffect(() => {
    if (!syncSchedulerStatus?.nextSyncAt) {
      setTimeUntilSync(null)
      return
    }

    const updateCountdown = (): void => {
      const now = Date.now()
      const remaining = syncSchedulerStatus.nextSyncAt! - now
      if (remaining <= 0) {
        setTimeUntilSync('syncing...')
        return
      }
      const seconds = Math.floor(remaining / 1000)
      const minutes = Math.floor(seconds / 60)
      const secs = seconds % 60
      if (minutes > 0) {
        setTimeUntilSync(`${minutes}m ${secs}s`)
      } else {
        setTimeUntilSync(`${secs}s`)
      }
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [syncSchedulerStatus?.nextSyncAt])

  const isAutoSyncActive = syncSchedulerStatus?.running && syncSchedulerStatus?.autoSyncOnAction

  const syncJobs = jobs.filter((j) => j.type === 'sync_poll' || j.type === 'sync_push')
  const latestSyncJob =
    syncJobs.length === 0
      ? null
      : syncJobs.reduce((latest, job) => {
          const latestTime = latest.updated_at || latest.created_at
          const jobTime = job.updated_at || job.created_at
          return jobTime > latestTime ? job : latest
        })

  const hasSyncError = latestSyncJob?.state === 'failed'
  const syncJobRunning = syncJobs.some((j) => j.state === 'running' || j.state === 'queued')

  // Worker status
  const workerJobs = jobs.filter((j) => j.type === 'worker_run')
  const activeWorkerJob = workerJobs.find((j) => j.state === 'running' || j.state === 'queued')
  const latestWorkerJob =
    workerJobs.length === 0
      ? null
      : workerJobs.reduce((latest, job) => {
          const latestTime = latest.updated_at || latest.created_at
          const jobTime = job.updated_at || job.created_at
          return jobTime > latestTime ? job : latest
        })

  // Only show error if the failure was recent (within last 5 minutes)
  const isRecentFailure = (): boolean => {
    if (!latestWorkerJob || latestWorkerJob.state !== 'failed') return false
    const failedAt = new Date(latestWorkerJob.updated_at || latestWorkerJob.created_at)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    return failedAt > fiveMinutesAgo
  }
  const hasWorkerError = isRecentFailure()

  const activeCard = activeWorkerJob?.card_id
    ? (cards || []).find((c) => c.id === activeWorkerJob.card_id)
    : null

  // Count ready cards for worker
  const readyCards = (cards || []).filter((c) => c.status === 'ready' && c.provider !== 'local')

  const getSyncStatus = (): {
    icon: React.ReactNode
    text: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  } => {
    if (isLoading || runningJobs.length > 0 || syncJobRunning) {
      return {
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        text: runningJobs.length > 0 ? `${runningJobs.length} running` : 'Syncing...',
        variant: 'secondary'
      }
    }
    if (hasSyncError) {
      return {
        icon: <AlertCircle className="h-3 w-3" />,
        text: 'Sync error',
        variant: 'destructive'
      }
    }
    return {
      icon: <CheckCircle2 className="h-3 w-3" />,
      text: project?.last_sync_at ? formatRelativeTime(project.last_sync_at) : 'Never synced',
      variant: 'default'
    }
  }

  const syncStatus = getSyncStatus()

  if (!project) {
    return (
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div className="text-muted-foreground">Select a project to get started</div>
        <Button variant="outline" size="sm" onClick={onOpenCommandPalette}>
          <Command className="mr-2 h-4 w-4" />
          <span className="text-xs text-muted-foreground">{commandPaletteLabel}</span>
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="font-semibold">{project.name}</h2>
            <p className="text-xs text-muted-foreground truncate max-w-xs">
              {project.remote_repo_key || project.local_path}
            </p>
          </div>

          <Badge
            variant={syncStatus.variant as 'default' | 'secondary' | 'destructive' | 'outline'}
          >
            {syncStatus.icon}
            <span className="ml-1">{syncStatus.text}</span>
          </Badge>
        </div>

        <div className="flex items-center gap-4">
          {/* Worker status and toggle */}
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Worker</span>
            <Switch
              checked={Number(project.worker_enabled) === 1}
              onCheckedChange={onToggleWorker}
              disabled={!project.remote_repo_key}
            />
            {Number(project.worker_enabled) === 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenWorkerLogs}
                disabled={workerJobs.length === 0}
              >
                <Terminal className="mr-2 h-4 w-4" />
                Logs
              </Button>
            )}
            {Number(project.worker_enabled) === 1 && (
              <Badge
                variant={activeWorkerJob ? 'secondary' : hasWorkerError ? 'destructive' : 'default'}
                className="ml-1"
              >
                {activeWorkerJob ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    {activeCard
                      ? `#${activeCard.remote_number_or_iid || activeCard.id.slice(0, 6)}`
                      : 'Processing...'}
                  </>
                ) : hasWorkerError ? (
                  <>
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Error
                  </>
                ) : readyCards.length > 0 ? (
                  <>
                    <Play className="h-3 w-3 mr-1" />
                    {readyCards.length} ready
                  </>
                ) : (
                  <>
                    <Pause className="h-3 w-3 mr-1" />
                    Idle
                  </>
                )}
              </Badge>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onSync}
                disabled={isLoading || !project.remote_repo_key}
                className={cn(
                  isAutoSyncActive &&
                    'border-green-500/50 bg-green-500/10 hover:bg-green-500/20 hover:border-green-500/70'
                )}
              >
                <RefreshCw
                  className={cn(
                    'mr-2 h-4 w-4',
                    isLoading && 'animate-spin',
                    isAutoSyncActive && 'text-green-600'
                  )}
                />
                Sync
                {isAutoSyncActive && (
                  <span className="ml-1.5 text-xs text-green-600">●</span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isAutoSyncActive ? (
                <div className="text-center">
                  <div className="font-medium">Auto-sync active</div>
                  {timeUntilSync && (
                    <div className="text-muted-foreground">Next sync in {timeUntilSync}</div>
                  )}
                </div>
              ) : (
                <span>Click to sync with remote</span>
              )}
            </TooltipContent>
          </Tooltip>

          <Button variant="outline" size="sm" onClick={onOpenCommandPalette}>
            <Command className="mr-2 h-4 w-4" />
            <span className="text-xs text-muted-foreground">{commandPaletteLabel}</span>
          </Button>
        </div>
      </div>

      {/*<SettingsDialog*/}
      {/*  open={settingsOpen}*/}
      {/*  onOpenChange={setSettingsOpen}*/}
      {/*  project={project}*/}
      {/*  onSetWorkerToolPreference={onSetWorkerToolPreference}*/}
      {/*  onSetWorkerRollbackOnCancel={onSetWorkerRollbackOnCancel}*/}
      {/*  onSetShowPullRequestsSection={onSetShowPullRequestsSection}*/}
      {/*/>*/}
    </>
  )
}
