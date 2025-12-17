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
import { useState } from 'react'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'
import { formatRelativeTime } from '../lib/utils'
import type { Project, Job, Card } from '../../../shared/types'
import { SettingsDialog, type WorkerToolPreference } from './SettingsDialog'

interface TopBarProps {
  project: Project | null
  jobs: Job[]
  cards: Card[]
  isLoading: boolean
  onSync: () => void
  onToggleWorker: (enabled: boolean) => void
  onOpenCommandPalette: () => void
  onSetWorkerToolPreference: (toolPreference: WorkerToolPreference) => Promise<void>
  onSetWorkerRollbackOnCancel: (rollbackOnCancel: boolean) => Promise<void>
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
  onSetWorkerToolPreference,
  onSetWorkerRollbackOnCancel,
  onOpenWorkerLogs
}: TopBarProps): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const runningJobs = jobs.filter((j) => j.state === 'running')

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
          <span className="text-xs text-muted-foreground">Ctrl+K</span>
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

          <Badge variant={syncStatus.variant as 'default' | 'secondary' | 'destructive' | 'outline'}>
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
                variant={
                  activeWorkerJob
                    ? 'secondary'
                    : hasWorkerError
                      ? 'destructive'
                      : 'default'
                }
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

          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={isLoading || !project.remote_repo_key}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
            Sync
          </Button>

          <Button variant="outline" size="sm" onClick={onOpenCommandPalette}>
            <Command className="mr-2 h-4 w-4" />
            <span className="text-xs text-muted-foreground">Ctrl+K</span>
          </Button>
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        project={project}
        onSetWorkerToolPreference={onSetWorkerToolPreference}
        onSetWorkerRollbackOnCancel={onSetWorkerRollbackOnCancel}
      />
    </>
  )
}
