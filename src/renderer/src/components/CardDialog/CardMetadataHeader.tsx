import { X, GitBranch } from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { cn } from '../../lib/utils'
import { formatRelativeTime } from '../../lib/utils'
import { KANBAN_COLUMNS, type Card, type Job, type Worktree } from '../../../../shared/types'

interface CardMetadataHeaderProps {
  card: Card
  worktree: Worktree | null
  latestJob: Job | null
  onClose: () => void
}

export function CardMetadataHeader({
  card,
  worktree,
  latestJob,
  onClose
}: CardMetadataHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-start justify-between">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {card.remote_number_or_iid && (
            <span className="text-sm font-mono text-muted-foreground">
              #{card.remote_number_or_iid}
            </span>
          )}
          <Badge
            variant={
              card.sync_state === 'error'
                ? 'destructive'
                : card.sync_state === 'pending'
                  ? 'secondary'
                  : 'default'
            }
          >
            {card.sync_state}
          </Badge>
          <Badge
            className={cn(
              KANBAN_COLUMNS.find((col) => col.id === card.status)?.color || 'bg-gray-500'
            )}
          >
            {KANBAN_COLUMNS.find((col) => col.id === card.status)?.label}
          </Badge>
          {worktree && (
            <Badge variant="outline" className="gap-1">
              <GitBranch className="h-3 w-3" />
              {worktree.status}
            </Badge>
          )}
          {latestJob && (
            <Badge
              variant={
                latestJob.state === 'failed'
                  ? 'destructive'
                  : latestJob.state === 'running'
                    ? 'default'
                    : 'secondary'
              }
            >
              {latestJob.state}
            </Badge>
          )}
        </div>
        <h2 className="text-xl font-bold leading-tight">{card.title}</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Updated {formatRelativeTime(card.updated_local_at)}
        </p>
      </div>
      <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
