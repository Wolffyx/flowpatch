import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { ScrollArea } from './ui/scroll-area'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Input } from './ui/input'
import { Switch } from './ui/switch'
import { cn } from '../lib/utils'
import type { Card, Job } from '../../../shared/types'

function parseJobResultLogs(job: Job | null): string[] {
  if (!job?.result_json) return []
  try {
    const parsed = JSON.parse(job.result_json) as { logs?: string[] }
    return Array.isArray(parsed.logs) ? parsed.logs : []
  } catch {
    return []
  }
}

type LogStream = 'stdout' | 'stderr'
type ParsedLogLine = {
  raw: string
  ts?: string
  time?: string
  source?: string
  stream?: LogStream
  message: string
  isError: boolean
}

function formatTime(ts: string): string | undefined {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return undefined
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function parseLogLine(raw: string): ParsedLogLine {
  const tsMatch = raw.match(/^\[([0-9]{4}-[0-9]{2}-[0-9]{2}T[^\]]+)\]\s*(.*)$/)
  if (!tsMatch) {
    const message = raw
    const isError = /\b(error|failed|exception|traceback)\b/i.test(message)
    return { raw, message, isError }
  }

  const ts = tsMatch[1]
  let rest = tsMatch[2] ?? ''
  let source: string | undefined
  let stream: LogStream | undefined

  const sourceMatch = rest.match(/^\[([^\]:\]]+)(?::(stdout|stderr))?\]\s*(.*)$/)
  if (sourceMatch) {
    source = sourceMatch[1]
    stream = (sourceMatch[2] as LogStream | undefined) ?? undefined
    rest = sourceMatch[3] ?? ''
  }

  const message = rest
  const isError = stream === 'stderr' || /\b(error|failed|exception|traceback)\b/i.test(message)
  return { raw, ts, time: formatTime(ts), source, stream, message, isError }
}

interface WorkerLogDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: Job | null
  card: Card | null
  liveLogs: string[]
  onClearLogs: (jobId: string) => void
}

export function WorkerLogDialog({
  open,
  onOpenChange,
  job,
  card,
  liveLogs,
  onClearLogs
}: WorkerLogDialogProps): React.JSX.Element {
  const persistedLogs = useMemo(() => parseJobResultLogs(job), [job])
  const logs = liveLogs.length > 0 ? liveLogs : persistedLogs

  const [query, setQuery] = useState('')
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [follow, setFollow] = useState(true)
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)

  const parsed = useMemo(() => logs.map(parseLogLine), [logs])
  const sources = useMemo(() => {
    const set = new Set<string>()
    for (const entry of parsed) {
      if (entry.source) set.add(entry.source)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [parsed])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return parsed.filter((entry) => {
      if (sourceFilter && entry.source !== sourceFilter) return false
      if (onlyErrors && !entry.isError) return false
      if (!q) return true
      const haystack = `${entry.message}\n${entry.source ?? ''}\n${entry.raw}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [parsed, query, onlyErrors, sourceFilter])

  const copyText = useMemo(() => filtered.map((l) => l.raw).join('\n'), [filtered])

  const endRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open || !follow) return
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [open, follow, filtered.length])

  const title = card
    ? `Worker logs • ${card.remote_number_or_iid ? `#${card.remote_number_or_iid}` : card.id.slice(0, 6)}`
    : 'Worker logs'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[90rem] sm:max-w-[90rem] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {job && (
              <Badge variant={job.state === 'failed' ? 'destructive' : 'secondary'}>{job.state}</Badge>
            )}
            {card && <div className="text-sm text-muted-foreground truncate">{card.title}</div>}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(copyText)
              }}
              disabled={filtered.length === 0}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => job?.id && onClearLogs(job.id)}
              disabled={!job?.id}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter logs (text/source)…"
                className="h-8"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Errors</span>
              <Switch checked={onlyErrors} onCheckedChange={setOnlyErrors} />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Wrap</span>
              <Switch checked={wrap} onCheckedChange={setWrap} />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Follow</span>
              <Switch checked={follow} onCheckedChange={setFollow} />
            </div>

            <div className="text-xs text-muted-foreground tabular-nums">
              {filtered.length}/{parsed.length}
            </div>
          </div>

          {sources.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Source</span>
              <Button
                type="button"
                variant={sourceFilter === null ? 'secondary' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setSourceFilter(null)}
              >
                All
              </Button>
              {sources.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={sourceFilter === s ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSourceFilter((prev) => (prev === s ? null : s))}
                >
                  {s}
                </Button>
              ))}
            </div>
          )}

          <ScrollArea className="h-[60vh] rounded-md border bg-muted/20">
            <div className={cn('p-3 font-mono text-xs max-w-full', !wrap && 'overflow-x-auto')}>
              {filtered.length === 0 ? (
                <div className="text-muted-foreground">
                  {parsed.length === 0 ? 'No logs yet.' : 'No matching logs.'}
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((entry, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'grid grid-cols-[72px_128px_1fr] gap-2 items-start rounded-sm px-1 py-0.5 w-full max-w-full',
                        entry.stream === 'stderr' ? 'bg-destructive/10' : 'hover:bg-muted/40'
                      )}
                    >
                      <div
                        className="text-[10px] text-muted-foreground tabular-nums leading-5"
                        title={entry.ts ?? undefined}
                      >
                        {entry.time ?? ''}
                      </div>

                      <div className="flex flex-wrap items-center gap-1 leading-5 min-w-0">
                        {entry.source && (
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                            {entry.source}
                          </Badge>
                        )}
                        {entry.stream && (
                          <Badge
                            variant={entry.stream === 'stderr' ? 'destructive' : 'outline'}
                            className="h-5 px-1.5 text-[10px]"
                          >
                            {entry.stream}
                          </Badge>
                        )}
                      </div>

                      <div
                        className={cn(
                          'leading-5 min-w-0 max-w-full',
                          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'
                        )}
                      >
                        {entry.message || entry.raw}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div ref={endRef} />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
