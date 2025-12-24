import { useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../src/components/ui/dialog'
import { Badge } from '../../src/components/ui/badge'
import { ScrollArea } from '../../src/components/ui/scroll-area'
import { cn } from '../../src/lib/utils'
import type { Job, JobResultEnvelope } from '@shared/types'

interface ActivityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobs: Job[]
  projectNameById: Record<string, string>
}

function parseResult(job: Job): JobResultEnvelope | null {
  if (!job.result_json) return null
  try {
    return JSON.parse(job.result_json) as JobResultEnvelope
  } catch {
    return null
  }
}

function stateVariant(state: Job['state']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'running' || state === 'queued') return 'secondary'
  if (state === 'failed' || state === 'blocked') return 'destructive'
  if (state === 'succeeded') return 'default'
  return 'outline'
}

export function ActivityDialog({
  open,
  onOpenChange,
  jobs,
  projectNameById
}: ActivityDialogProps): React.JSX.Element {
  const activeCount = useMemo(
    () => jobs.filter((j) => j.state === 'queued' || j.state === 'running').length,
    [jobs]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Activity <span className="text-muted-foreground text-sm">({activeCount} active)</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[560px] pr-4">
          <div className="space-y-2">
            {jobs.length === 0 && <div className="text-sm text-muted-foreground">No jobs yet.</div>}
            {jobs.map((job) => {
              const result = parseResult(job)
              const summary = result?.summary || job.last_error || ''
              const projectName = projectNameById[job.project_id] ?? job.project_id
              const isActive = job.state === 'queued' || job.state === 'running'
              return (
                <div
                  key={job.id}
                  className={cn(
                    'flex items-start justify-between gap-3 rounded-lg border p-3',
                    isActive && 'bg-muted/30'
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={stateVariant(job.state)} className="shrink-0">
                        {job.state}
                      </Badge>
                      <span className="font-medium">{job.type}</span>
                      <span className="text-xs text-muted-foreground truncate">{projectName}</span>
                    </div>
                    {summary && <div className="text-sm text-muted-foreground mt-1">{summary}</div>}
                    <div className="text-xs text-muted-foreground mt-1">
                      {job.updated_at || job.created_at}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
