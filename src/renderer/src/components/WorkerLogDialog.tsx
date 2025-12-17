import { useEffect, useMemo, useRef } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { ScrollArea } from './ui/scroll-area'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
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

  const endRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [open, logs.length])

  const title = card
    ? `Worker logs • ${card.remote_number_or_iid ? `#${card.remote_number_or_iid}` : card.id.slice(0, 6)}`
    : 'Worker logs'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {job && (
              <Badge variant={job.state === 'failed' ? 'destructive' : 'secondary'}>
                {job.state}
              </Badge>
            )}
            {card && <div className="text-sm text-muted-foreground truncate">{card.title}</div>}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(logs.join('\n'))
              }}
              disabled={logs.length === 0}
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

        <ScrollArea className="h-[60vh] rounded-md border bg-muted/20">
          <div className="p-3 font-mono text-xs whitespace-pre-wrap break-words">
            {logs.length === 0 ? (
              <div className="text-muted-foreground">No logs yet.</div>
            ) : (
              logs.map((line, idx) => <div key={idx}>{line}</div>)
            )}
            <div ref={endRef} />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

