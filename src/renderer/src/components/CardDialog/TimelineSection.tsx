import { useMemo, useState } from 'react'
import { Clock, RefreshCw, Play, CheckCircle2, AlertCircle, Search, Filter, XCircle } from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { formatRelativeTime } from '../../lib/utils'
import type { Event } from '../../../../shared/types'

interface TimelineSectionProps {
  events: Event[]
}

export function TimelineSection({ events }: TimelineSectionProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const eventTypes = useMemo(() => {
    const types = new Set(events.map((e) => e.type))
    return Array.from(types).sort()
  }, [events])

  const filteredEvents = useMemo(() => {
    let filtered = events

    if (typeFilter) {
      filtered = filtered.filter((e) => e.type === typeFilter)
    }

    if (search.trim()) {
      const searchLower = search.toLowerCase()
      filtered = filtered.filter(
        (e) =>
          e.type.toLowerCase().includes(searchLower) ||
          (e.payload_json && e.payload_json.toLowerCase().includes(searchLower))
      )
    }

    return showAll ? filtered : filtered.slice(0, 10)
  }, [events, typeFilter, search, showAll])

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
    <div>
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4" />
        Timeline
      </h3>

      {/* Search and Filter */}
      <div className="space-y-3 mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events..."
              className="pl-9"
            />
          </div>
          {(search || typeFilter) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSearch('')
                setTypeFilter(null)
              }}
            >
              <XCircle className="h-4 w-4" />
            </Button>
          )}
        </div>

        {eventTypes.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Filter className="h-3 w-3" />
              Filter:
            </span>
            <Button
              variant={typeFilter === null ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setTypeFilter(null)}
              className="h-7 text-xs"
            >
              All
            </Button>
            {eventTypes.map((type) => (
              <Button
                key={type}
                variant={typeFilter === type ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setTypeFilter(type === typeFilter ? null : type)}
                className="h-7 text-xs"
              >
                {type.replace(/_/g, ' ')}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Events List */}
      {filteredEvents.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {search || typeFilter ? 'No matching events' : 'No events yet'}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredEvents.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 text-sm border-l-2 border-border pl-4 py-2 rounded-r bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="mt-0.5">{getEventIcon(event.type)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium capitalize">{event.type.replace(/_/g, ' ')}</p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(event.created_at)}
                </p>
              </div>
            </div>
          ))}

          {!showAll && events.length > 10 && filteredEvents.length >= 10 && (
            <Button variant="outline" size="sm" onClick={() => setShowAll(true)} className="w-full">
              Show {events.length - 10} more events
            </Button>
          )}
          {showAll && (
            <Button variant="outline" size="sm" onClick={() => setShowAll(false)} className="w-full">
              Show less
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
