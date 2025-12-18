import {
  Github,
  GitlabIcon,
  FileText,
  GitPullRequest,
  GitMerge,
  AlertCircle,
  Link2,
  Clock
} from 'lucide-react'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'
import { formatRelativeTime, parseLabels, truncate } from '../lib/utils'
import type { Card } from '../../../shared/types'

interface PullRequestCardProps {
  card: Card
  isSelected: boolean
  onClick: () => void
}

export function PullRequestCard({ card, isSelected, onClick }: PullRequestCardProps): React.JSX.Element {
  const getProviderIcon = (): React.ReactNode => {
    switch (card.provider) {
      case 'github':
        return <Github className="h-3 w-3" />
      case 'gitlab':
        return <GitlabIcon className="h-3 w-3" />
      default:
        return <FileText className="h-3 w-3" />
    }
  }

  const getTypeIcon = (): React.ReactNode => {
    switch (card.type) {
      case 'pr':
        return <GitPullRequest className="h-3 w-3 text-chart-2" />
      case 'mr':
        return <GitMerge className="h-3 w-3 text-chart-5" />
      default:
        return <FileText className="h-3 w-3 text-muted-foreground" />
    }
  }

  const labels = parseLabels(card.labels_json)

  return (
    <button
      type="button"
      className={cn(
        'w-full rounded-lg border bg-card p-3 text-left shadow-sm cursor-pointer transition-all hover:bg-muted/50',
        isSelected && 'ring-2 ring-primary',
        card.sync_state === 'error' && 'border-destructive',
        card.sync_state === 'pending' && 'border-chart-4'
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {getProviderIcon()}
          {getTypeIcon()}
          {card.remote_number_or_iid && (
            <span className="text-xs text-muted-foreground">#{card.remote_number_or_iid}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {card.sync_state === 'error' && (
            <span title={card.last_error || 'Error'}>
              <AlertCircle className="h-3 w-3 text-destructive" />
            </span>
          )}
          {card.sync_state === 'pending' && (
            <span title="Pending sync">
              <Clock className="h-3 w-3 text-chart-4" />
            </span>
          )}
          {card.remote_url && <Link2 className="h-3 w-3 text-muted-foreground" />}
        </div>
      </div>

      <h3 className="text-sm font-medium mb-2 line-clamp-2">{card.title}</h3>

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {labels.slice(0, 3).map((label) => (
            <Badge key={label} variant="secondary" className="text-xs py-0 px-1.5">
              {truncate(label, 15)}
            </Badge>
          ))}
          {labels.length > 3 && (
            <Badge variant="secondary" className="text-xs py-0 px-1.5">
              +{labels.length - 3}
            </Badge>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatRelativeTime(card.updated_local_at)}</span>
        {card.ready_eligible === 1 && (
          <Badge variant="default" className="text-xs py-0 px-1.5">
            Ready
          </Badge>
        )}
      </div>
    </button>
  )
}

