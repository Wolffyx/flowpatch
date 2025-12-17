import { X, ExternalLink, Play, RefreshCw, Clock, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { ScrollArea } from './ui/scroll-area'
import { cn } from '../lib/utils'
import { formatRelativeTime, parseLabels, parseAssignees } from '../lib/utils'
import { KANBAN_COLUMNS, type Card, type Event, type CardStatus } from '../../../shared/types'

interface CardDrawerProps {
  card: Card | null
  events: Event[]
  onClose: () => void
  onMoveCard: (cardId: string, status: CardStatus) => void
  onRunWorker: (cardId: string) => void
}

export function CardDrawer({
  card,
  events,
  onClose,
  onMoveCard,
  onRunWorker
}: CardDrawerProps): React.JSX.Element | null {
  if (!card) return null

  const labels = parseLabels(card.labels_json)
  const assignees = parseAssignees(card.assignees_json)
  const cardEvents = events.filter((e) => e.card_id === card.id)

  const getEventIcon = (type: string): React.ReactNode => {
    switch (type) {
      case 'status_changed':
        return <RefreshCw className="h-3 w-3" />
      case 'worker_plan':
      case 'worker_run':
        return <Play className="h-3 w-3" />
      case 'pr_created':
        return <CheckCircle2 className="h-3 w-3 text-chart-2" />
      case 'error':
        return <AlertCircle className="h-3 w-3 text-destructive" />
      default:
        return <Clock className="h-3 w-3" />
    }
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="font-semibold truncate">Card Details</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Title and number */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {card.remote_number_or_iid && (
                <span className="text-sm text-muted-foreground">#{card.remote_number_or_iid}</span>
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
            </div>
            <h3 className="text-lg font-medium">{card.title}</h3>
          </div>

          {/* Remote link */}
          {card.remote_url && (
            <div>
              <a
                href={card.remote_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                onClick={(e) => {
                  e.preventDefault()
                  window.electron.ipcRenderer.send('openExternal', card.remote_url)
                }}
              >
                <ExternalLink className="h-3 w-3" />
                Open in {card.provider === 'github' ? 'GitHub' : 'GitLab'}
              </a>
            </div>
          )}

          {/* Body */}
          {card.body && (
            <div>
              <h4 className="text-sm font-medium mb-2">Description</h4>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap rounded-md bg-secondary p-3 max-h-48 overflow-auto">
                {card.body}
              </div>
            </div>
          )}

          {/* Status controls */}
          <div>
            <h4 className="text-sm font-medium mb-2">Status</h4>
            <div className="flex flex-wrap gap-2">
              {KANBAN_COLUMNS.map((col) => (
                <Button
                  key={col.id}
                  variant={card.status === col.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onMoveCard(card.id, col.id)}
                >
                  <div className={cn('h-2 w-2 rounded-full mr-2', col.color)} />
                  {col.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Labels */}
          {labels.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Labels</h4>
              <div className="flex flex-wrap gap-1">
                {labels.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Assignees */}
          {assignees.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Assignees</h4>
              <div className="flex flex-wrap gap-1">
                {assignees.map((assignee) => (
                  <Badge key={assignee} variant="outline">
                    {assignee}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Worker controls */}
          {card.ready_eligible === 1 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Worker</h4>
              <Button
                variant="default"
                size="sm"
                onClick={() => onRunWorker(card.id)}
                disabled={card.provider === 'local'}
              >
                <Play className="h-4 w-4 mr-2" />
                Run Worker Now
              </Button>
            </div>
          )}

          {/* Timeline */}
          <div>
            <h4 className="text-sm font-medium mb-2">Timeline</h4>
            {cardEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet</p>
            ) : (
              <div className="space-y-2">
                {cardEvents.slice(0, 10).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-2 text-sm border-l-2 border-border pl-3 py-1"
                  >
                    {getEventIcon(event.type)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{event.type.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(event.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Local update: {formatRelativeTime(card.updated_local_at)}</p>
            {card.updated_remote_at && (
              <p>Remote update: {formatRelativeTime(card.updated_remote_at)}</p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
