import { useMemo, useState, useEffect } from 'react'
import {
  Clock,
  RefreshCw,
  Play,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  XCircle,
  Terminal,
  ExternalLink,
  Zap
} from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { formatRelativeTime } from '../../lib/utils'
import type { Event, UsageRecord } from '../../../../shared/types'

interface TimelineSectionProps {
  events: Event[]
  cardId: string | null
  onOpenWorkerLogsForJob?: (jobId: string) => void
}

interface ParsedPayload {
  [key: string]: unknown
}

function parsePayload(payloadJson: string | null): ParsedPayload | null {
  if (!payloadJson) return null
  try {
    return JSON.parse(payloadJson) as ParsedPayload
  } catch {
    return null
  }
}

function formatEventDescription(event: Event): string {
  const payload = parsePayload(event.payload_json)
  if (!payload) return event.type.replace(/_/g, ' ')

  switch (event.type) {
    case 'status_changed': {
      const oldStatus = payload.oldStatus as string | undefined
      const newStatus = payload.newStatus as string | undefined
      const trigger = payload.trigger as string | undefined
      if (oldStatus && newStatus) {
        return `Status changed from ${oldStatus} to ${newStatus}${trigger ? ` (${trigger})` : ''}`
      }
      return `Status changed${trigger ? ` (${trigger})` : ''}`
    }
    case 'worker_run': {
      const trigger = payload.trigger as string | undefined
      const jobId = payload.jobId as string | undefined
      return `Worker run${trigger ? ` (${trigger})` : ''}${jobId ? ` • Job ${jobId.slice(0, 8)}` : ''}`
    }
    case 'worker_plan': {
      const plan = payload.plan as string | undefined
      if (plan) {
        const firstLine = plan.split('\n')[0].trim()
        return `Plan: ${firstLine.length > 60 ? firstLine.slice(0, 60) + '...' : firstLine}`
      }
      return 'Plan generated'
    }
    case 'plan_approval_requested':
      return 'Plan approval requested'
    case 'plan_approved': {
      const notes = payload.notes as string | undefined
      return `Plan approved${notes ? `: ${notes.slice(0, 50)}${notes.length > 50 ? '...' : ''}` : ''}`
    }
    case 'plan_rejected': {
      const notes = payload.notes as string | undefined
      return `Plan rejected${notes ? `: ${notes.slice(0, 50)}${notes.length > 50 ? '...' : ''}` : ''}`
    }
    case 'plan_skipped':
      return 'Plan approval skipped'
    case 'follow_up_instruction_added': {
      const instructionType = payload.instructionType as string | undefined
      const content = payload.content as string | undefined
      return `Follow-up instruction added${instructionType ? ` (${instructionType})` : ''}${content ? `: ${content.slice(0, 50)}${content.length > 50 ? '...' : ''}` : ''}`
    }
    case 'follow_up_instruction_applied':
      return 'Follow-up instruction applied'
    case 'follow_up_instruction_rejected':
      return 'Follow-up instruction rejected'
    case 'pr_created': {
      const prNumber = payload.prNumber as number | undefined
      const url = payload.url as string | undefined
      const provider = payload.provider as string | undefined
      if (prNumber) {
        return `${provider === 'gitlab' ? 'MR' : 'PR'} #${prNumber} created`
      }
      return 'PR/MR created'
    }
    case 'card_pushed_to_remote': {
      const issueNumber = payload.issueNumber as number | undefined
      return issueNumber ? `Pushed to remote as issue #${issueNumber}` : 'Pushed to remote'
    }
    case 'task_decomposed': {
      const subtaskCount = payload.subtaskCount as number | undefined
      return subtaskCount ? `Task decomposed into ${subtaskCount} subtasks` : 'Task decomposed'
    }
    case 'e2e_tests_run': {
      const passed = payload.passed as boolean | undefined
      const failed = payload.failed as boolean | undefined
      if (passed !== undefined || failed !== undefined) {
        return `E2E tests ${passed ? 'passed' : failed ? 'failed' : 'run'}`
      }
      return 'E2E tests run'
    }
    case 'synced': {
      const jobId = payload.jobId as string | undefined
      return `Synced with remote${jobId ? ` • Job ${jobId.slice(0, 8)}` : ''}`
    }
    case 'error': {
      const error = payload.error as string | undefined
      const message = payload.message as string | undefined
      return error || message || 'Error occurred'
    }
    case 'card_created':
      return 'Card created'
    case 'card_updated':
      return 'Card updated'
    case 'card_deleted':
      return 'Card deleted'
    case 'card_linked':
      return 'Card linked'
    case 'card_split':
      return 'Card split'
    default:
      return event.type.replace(/_/g, ' ')
  }
}

function getEventSearchableText(event: Event): string {
  const payload = parsePayload(event.payload_json)
  const parts = [event.type]
  if (payload) {
    // Extract common searchable fields
    const searchableFields = [
      payload.plan,
      payload.error,
      payload.message,
      payload.content,
      payload.notes,
      payload.prNumber,
      payload.issueNumber,
      payload.jobId,
      payload.trigger,
      payload.oldStatus,
      payload.newStatus,
      payload.provider,
      payload.instructionType
    ]
    for (const field of searchableFields) {
      if (typeof field === 'string' || typeof field === 'number') {
        parts.push(String(field))
      }
    }
  }
  return parts.join(' ').toLowerCase()
}

export function TimelineSection({
  events,
  cardId,
  onOpenWorkerLogsForJob
}: TimelineSectionProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([])
  const [usageLoading, setUsageLoading] = useState(false)

  // Load usage records when cardId is available
  useEffect(() => {
    if (!cardId) {
      setUsageRecords([])
      return
    }

    const loadUsage = async (): Promise<void> => {
      setUsageLoading(true)
      try {
        const records = await window.projectAPI.getCardUsage(cardId)
        setUsageRecords(records)
      } catch (error) {
        console.error('Failed to load card usage:', error)
        setUsageRecords([])
      } finally {
        setUsageLoading(false)
      }
    }

    void loadUsage()
  }, [cardId])

  const usageSummary = useMemo(() => {
    if (usageRecords.length === 0) return null

    const totalTokens = usageRecords.reduce((sum, r) => sum + r.total_tokens, 0)
    const totalCost = usageRecords.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0)
    const byTool = new Map<string, { count: number; tokens: number; cost: number }>()

    for (const record of usageRecords) {
      const existing = byTool.get(record.tool_type) || { count: 0, tokens: 0, cost: 0 }
      byTool.set(record.tool_type, {
        count: existing.count + 1,
        tokens: existing.tokens + record.total_tokens,
        cost: existing.cost + (record.cost_usd ?? 0)
      })
    }

    return {
      totalTokens,
      totalCost,
      byTool: Array.from(byTool.entries()).map(([tool, stats]) => ({
        tool,
        ...stats
      }))
    }
  }, [usageRecords])

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
      filtered = filtered.filter((e) => {
        const searchableText = getEventSearchableText(e)
        return searchableText.includes(searchLower)
      })
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

      {/* AI Usage Summary */}
      {usageSummary && usageSummary.totalTokens > 0 && (
        <div className="mb-4 rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Zap className="h-3 w-3" />
            AI Usage Summary
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">Total Tokens</div>
              <div className="font-medium">{usageSummary.totalTokens.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Total Cost</div>
              <div className="font-medium">
                ${usageSummary.totalCost.toFixed(4)}
              </div>
            </div>
          </div>
          {usageSummary.byTool.length > 0 && (
            <div className="space-y-1 pt-2 border-t">
              <div className="text-xs text-muted-foreground">By Tool:</div>
              <div className="flex flex-wrap gap-2">
                {usageSummary.byTool.map(({ tool, count, tokens, cost }) => (
                  <Badge key={tool} variant="secondary" className="text-xs">
                    {tool}: {count} calls, {tokens.toLocaleString()} tokens
                    {cost > 0 && `, $${cost.toFixed(4)}`}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
          {filteredEvents.map((event) => {
            const payload = parsePayload(event.payload_json)
            const jobId = payload?.jobId as string | undefined
            const url = payload?.url as string | undefined
            const hasWorkerLogs = (event.type === 'worker_run' || event.type === 'e2e_tests_run') && jobId && onOpenWorkerLogsForJob

            return (
              <div
                key={event.id}
                className="flex items-start gap-3 text-sm border-l-2 border-border pl-4 py-2 rounded-r bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="mt-0.5">{getEventIcon(event.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{formatEventDescription(event)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatRelativeTime(event.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasWorkerLogs && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => onOpenWorkerLogsForJob!(jobId!)}
                        >
                          <Terminal className="h-3 w-3 mr-1" />
                          View logs
                        </Button>
                      )}
                      {url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => window.electron.ipcRenderer.send('openExternal', url)}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {!showAll && events.length > 10 && filteredEvents.length >= 10 && (
            <Button variant="outline" size="sm" onClick={() => setShowAll(true)} className="w-full">
              Show {events.length - 10} more events
            </Button>
          )}
          {showAll && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAll(false)}
              className="w-full"
            >
              Show less
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
