import type { MouseEvent } from 'react'
import { useMemo } from 'react'
import { defaultAnimateLayoutChanges, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Github,
  GitlabIcon,
  FileText,
  GitPullRequest,
  GitMerge,
  AlertCircle,
  Link2,
  Clock,
  GitBranch,
  CheckCircle2,
  Server
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
  onContextMenu?: (event: MouseEvent, card: Card) => void
  devServerStatus?: {
    isRunning: boolean
    port?: number
    status?: 'starting' | 'running' | 'stopped' | 'error'
  }
}

interface KanbanCardBaseProps extends KanbanCardProps {
  containerProps?: React.HTMLAttributes<HTMLDivElement>
  containerRef?: (node: HTMLDivElement | null) => void
  style?: React.CSSProperties
  isDragging?: boolean
  isDragOverlay?: boolean
}

/**
 * Get priority color from labels
 * Returns a color class for the priority indicator stripe
 */
function getPriorityColor(labelsJson: string | null): string | null {
  const labels = parseLabels(labelsJson)
  const priorityLabels = labels.map((l) => l.toLowerCase())

  if (priorityLabels.some((l) => l.includes('critical') || l.includes('urgent') || l.includes('p0'))) {
    return 'bg-red-500'
  }
  if (priorityLabels.some((l) => l.includes('high') || l.includes('p1'))) {
    return 'bg-orange-500'
  }
  if (priorityLabels.some((l) => l.includes('medium') || l.includes('p2'))) {
    return 'bg-yellow-500'
  }
  if (priorityLabels.some((l) => l.includes('low') || l.includes('p3'))) {
    return 'bg-blue-500'
  }
  return null
}

function KanbanCardBase({
  card,
  linkedPRs,
  isSelected,
  onClick,
  onContextMenu,
  containerProps,
  containerRef,
  style,
  isDragging = false,
  isDragOverlay = false,
  devServerStatus
}: KanbanCardBaseProps): React.JSX.Element {

  const getProviderIcon = (): React.ReactNode => {
    switch (card.provider) {
      case 'github':
        return <Github className="h-3.5 w-3.5" />
      case 'gitlab':
        return <GitlabIcon className="h-3.5 w-3.5" />
      default:
        return <FileText className="h-3.5 w-3.5" />
    }
  }

  const getTypeIcon = (): React.ReactNode => {
    switch (card.type) {
      case 'pr':
        return <GitPullRequest className="h-3.5 w-3.5 text-chart-2" />
      case 'mr':
        return <GitMerge className="h-3.5 w-3.5 text-chart-5" />
      case 'draft':
        return <FileText className="h-3.5 w-3.5 text-muted-foreground" />
      default:
        return <FileText className="h-3.5 w-3.5 text-chart-1" />
    }
  }

  const labels = useMemo(() => parseLabels(card.labels_json), [card.labels_json])
  const hasConflicts = card.has_conflicts === 1
  const priorityColor = useMemo(() => getPriorityColor(card.labels_json), [card.labels_json])
  const linkedPRsSafe = linkedPRs ?? []
  const hasLinkedPRs = linkedPRsSafe.length > 0

  return (
    <div
      ref={containerRef}
      style={style}
      {...containerProps}
      className={cn(
        'group relative rounded-xl border bg-card shadow-sm cursor-grab active:cursor-grabbing',
        !isDragging ? 'transition-all duration-200 ease-out' : 'transition-none',
        // Hover effect - subtle lift
        !isDragging && 'hover:shadow-md hover:-translate-y-0.5',
        // Dragging state
        isDragging && 'shadow-lg scale-[1.02] rotate-1',
        isDragOverlay && 'pointer-events-none',
        // Selected state
        isSelected && 'ring-2 ring-primary shadow-md',
        // Dev server running - subtle green border highlight
        devServerStatus?.isRunning && 'border-green-500/50 border-2',
        // Error states
        hasConflicts && 'border-orange-500/70 border-2',
        card.sync_state === 'error' && !hasConflicts && 'border-destructive/70',
        card.sync_state === 'pending' && 'border-chart-4/50'
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onContextMenu={(e) => {
        if (!onContextMenu) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e, card)
      }}
    >
      {/* Priority indicator stripe */}
      {priorityColor && (
        <div
          className={cn('absolute left-0 top-3 bottom-3 w-1 rounded-full', priorityColor)}
          aria-hidden="true"
        />
      )}

      <div className={cn('p-3', priorityColor && 'pl-4')}>
        {/* Header with icons and number */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              {getProviderIcon()}
              {getTypeIcon()}
            </div>
            {card.type !== 'draft' && card.remote_number_or_iid && (
              <span className="text-xs font-medium text-muted-foreground">
                #{card.remote_number_or_iid}
              </span>
            )}
          </div>

          {/* Status indicators */}
          <div className="flex items-center gap-1.5">
            {devServerStatus?.isRunning && (
              <span
                title={
                  devServerStatus.status === 'starting'
                    ? 'Dev server starting...'
                    : devServerStatus.port
                      ? `Dev server running on port ${devServerStatus.port}`
                      : 'Dev server running'
                }
                className={cn(
                  'flex items-center justify-center h-5 w-5 rounded-full',
                  devServerStatus.status === 'starting'
                    ? 'bg-blue-500/10 animate-pulse'
                    : 'bg-green-500/10'
                )}
              >
                <Server
                  className={cn(
                    'h-3 w-3',
                    devServerStatus.status === 'starting' ? 'text-blue-500' : 'text-green-500'
                  )}
                />
              </span>
            )}
            {hasConflicts && (
              <span
                title="Merge conflicts - needs resolution"
                className="flex items-center justify-center h-5 w-5 rounded-full bg-orange-500/10"
              >
                <GitBranch className="h-3 w-3 text-orange-500" />
              </span>
            )}
            {card.sync_state === 'error' && !hasConflicts && (
              <span
                title={card.last_error || 'Error'}
                className="flex items-center justify-center h-5 w-5 rounded-full bg-destructive/10"
              >
                <AlertCircle className="h-3 w-3 text-destructive" />
              </span>
            )}
            {card.sync_state === 'pending' && (
              <span
                title="Pending sync"
                className="flex items-center justify-center h-5 w-5 rounded-full bg-chart-4/10"
              >
                <Clock className="h-3 w-3 text-chart-4" />
              </span>
            )}
            {card.remote_url && (
              <Link2 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>
        </div>

        {/* Title */}
        <h3 className="text-sm font-medium mb-2 line-clamp-2 leading-snug">{card.title}</h3>

        {/* Linked PRs indicator */}
        {hasLinkedPRs && (
          <div className="flex items-center gap-1.5 mb-2">
            <Badge
              variant="outline"
              className="text-xs py-0.5 px-2 gap-1.5 text-chart-2 border-chart-2/30 bg-chart-2/5"
              title={`${linkedPRsSafe.length} linked PR${linkedPRsSafe.length > 1 ? 's' : ''}`}
            >
              <GitPullRequest className="h-3 w-3" />
              <span className="font-medium">#{linkedPRsSafe[0].linked_number_or_iid}</span>
              {linkedPRsSafe.length > 1 && (
                <span className="text-chart-2/70">+{linkedPRsSafe.length - 1}</span>
              )}
            </Badge>
          </div>
        )}

        {/* Labels */}
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {labels.slice(0, 3).map((label) => (
              <Badge
                key={label}
                variant="secondary"
                className="text-xs py-0.5 px-1.5 font-normal"
              >
                {truncate(formatLabel(label), 15)}
              </Badge>
            ))}
            {labels.length > 3 && (
              <Badge variant="secondary" className="text-xs py-0.5 px-1.5 font-normal">
                +{labels.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span className="opacity-70">{formatRelativeTime(card.updated_local_at)}</span>
          {card.ready_eligible === 1 && (
            <Badge
              variant="default"
              className="text-xs py-0.5 px-2 gap-1 bg-green-500/90 hover:bg-green-500"
            >
              <CheckCircle2 className="h-3 w-3" />
              Ready
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}

export function KanbanCard({
  card,
  linkedPRs,
  isSelected,
  onClick,
  onContextMenu,
  devServerStatus
}: KanbanCardProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { card },
    animateLayoutChanges: (args) =>
      args.isSorting ? false : defaultAnimateLayoutChanges(args)
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  return (
    <KanbanCardBase
      card={card}
      linkedPRs={linkedPRs}
      isSelected={isSelected}
      onClick={onClick}
      onContextMenu={onContextMenu}
      containerProps={{ ...attributes, ...listeners }}
      containerRef={setNodeRef}
      style={style}
      isDragging={isDragging}
      devServerStatus={devServerStatus}
    />
  )
}

export function KanbanCardPreview({
  card,
  linkedPRs,
  onClick
}: Omit<KanbanCardProps, 'isSelected'> & { isSelected?: boolean }): React.JSX.Element {
  return (
    <KanbanCardBase
      card={card}
      linkedPRs={linkedPRs}
      isSelected={false}
      onClick={onClick}
      isDragging
      isDragOverlay
    />
  )
}
