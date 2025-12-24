import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import { formatRelativeTime, parseLabels, truncate, formatLabel } from '../lib/utils'
import type { Card, CardLink } from '../../../shared/types'

interface KanbanCardProps {
  card: Card
  linkedPRs?: CardLink[]
  isSelected: boolean
  onClick: () => void
}

export function KanbanCard({
  card,
  linkedPRs,
  isSelected,
  onClick
}: KanbanCardProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { card }
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

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
      case 'draft':
        return <FileText className="h-3 w-3 text-muted-foreground" />
      default:
        return <FileText className="h-3 w-3 text-chart-1" />
    }
  }

  const labels = parseLabels(card.labels_json)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'rounded-lg border bg-card p-3 shadow-sm cursor-grab active:cursor-grabbing transition-all',
        isDragging && 'opacity-50 shadow-lg',
        isSelected && 'ring-2 ring-primary',
        card.sync_state === 'error' && 'border-destructive',
        card.sync_state === 'pending' && 'border-chart-4'
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {/* Header with icons */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {getProviderIcon()}
          {getTypeIcon()}
          {card.type !== 'draft' && card.remote_number_or_iid && (
            <span className="text-xs text-muted-foreground">#{card.remote_number_or_iid}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {linkedPRs && linkedPRs.length > 0 && (
            <Badge
              variant="outline"
              className="text-xs py-0 px-1.5 gap-1 text-chart-2 border-chart-2/50"
              title={`${linkedPRs.length} linked PR${linkedPRs.length > 1 ? 's' : ''}`}
            >
              <GitPullRequest className="h-3 w-3" />#{linkedPRs[0].linked_number_or_iid}
              {linkedPRs.length > 1 && <span>+{linkedPRs.length - 1}</span>}
            </Badge>
          )}
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

      {/* Title */}
      <h3 className="text-sm font-medium mb-2 line-clamp-2">{card.title}</h3>

      {/* Labels */}
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {labels.slice(0, 3).map((label) => (
            <Badge key={label} variant="secondary" className="text-xs py-0 px-1.5">
              {truncate(formatLabel(label), 15)}
            </Badge>
          ))}
          {labels.length > 3 && (
            <Badge variant="secondary" className="text-xs py-0 px-1.5">
              +{labels.length - 3}
            </Badge>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatRelativeTime(card.updated_local_at)}</span>
        {card.ready_eligible === 1 && (
          <Badge variant="default" className="text-xs py-0 px-1.5">
            Ready
          </Badge>
        )}
      </div>
    </div>
  )
}
