import { RefreshCw, Command, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'
import { formatRelativeTime } from '../lib/utils'
import type { Project, Job } from '../../../shared/types'

interface TopBarProps {
  project: Project | null
  jobs: Job[]
  isLoading: boolean
  onSync: () => void
  onToggleWorker: (enabled: boolean) => void
  onOpenCommandPalette: () => void
}

export function TopBar({
  project,
  jobs,
  isLoading,
  onSync,
  onToggleWorker,
  onOpenCommandPalette
}: TopBarProps): React.JSX.Element {
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
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Worker</span>
          <Switch
            checked={project.worker_enabled === 1}
            onCheckedChange={onToggleWorker}
            disabled={!project.remote_repo_key}
          />
        </div>

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
  )
}
