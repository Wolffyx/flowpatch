import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Switch } from './ui/switch'
import { ScrollArea } from './ui/scroll-area'
import { Badge } from './ui/badge'
import type { PolicyConfig, Project, RepoLabel } from '../../../shared/types'
import { DEFAULT_POLICY, KANBAN_COLUMNS } from '../../../shared/types'

type StatusLabelMapping = NonNullable<NonNullable<PolicyConfig['sync']>['statusLabels']>

function parsePolicy(project: Project): PolicyConfig {
  if (!project.policy_json) return DEFAULT_POLICY
  try {
    return JSON.parse(project.policy_json) as PolicyConfig
  } catch {
    return DEFAULT_POLICY
  }
}

function readInitialMapping(project: Project): { readyLabel: string; statusLabels: StatusLabelMapping } {
  const policy = parsePolicy(project)
  const readyLabel = policy.sync?.readyLabel || DEFAULT_POLICY.sync?.readyLabel || 'ready'
  const statusLabels: StatusLabelMapping = {
    draft: policy.sync?.statusLabels?.draft || DEFAULT_POLICY.sync!.statusLabels!.draft!,
    ready: policy.sync?.statusLabels?.ready || DEFAULT_POLICY.sync!.statusLabels!.ready!,
    inProgress: policy.sync?.statusLabels?.inProgress || DEFAULT_POLICY.sync!.statusLabels!.inProgress!,
    inReview: policy.sync?.statusLabels?.inReview || DEFAULT_POLICY.sync!.statusLabels!.inReview!,
    testing: policy.sync?.statusLabels?.testing || DEFAULT_POLICY.sync!.statusLabels!.testing!,
    done: policy.sync?.statusLabels?.done || DEFAULT_POLICY.sync!.statusLabels!.done!
  }
  return { readyLabel, statusLabels }
}

export interface LabelSetupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  onApplied?: () => void
}

export function LabelSetupDialog({
  open,
  onOpenChange,
  project,
  onApplied
}: LabelSetupDialogProps): React.JSX.Element {
  const [isLoading, setIsLoading] = useState(false)
  const [labels, setLabels] = useState<RepoLabel[]>([])
  const [createMissingLabels, setCreateMissingLabels] = useState(true)
  const [{ readyLabel, statusLabels }, setMapping] = useState(() => readInitialMapping(project))

  useEffect(() => {
    if (!open) return
    setMapping(readInitialMapping(project))
  }, [open, project])

  useEffect(() => {
    if (!open) return
    let canceled = false
    setIsLoading(true)
    window.electron.ipcRenderer
      .invoke('listRepoLabels', { projectId: project.id })
      .then((res: { labels?: RepoLabel[]; error?: string }) => {
        if (canceled) return
        if (res?.error) {
          toast.error('Failed to load labels', { description: res.error })
          setLabels([])
          return
        }
        setLabels(res?.labels || [])
      })
      .catch((err) => {
        if (canceled) return
        toast.error('Failed to load labels', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        setLabels([])
      })
      .finally(() => {
        if (!canceled) setIsLoading(false)
      })
    return () => {
      canceled = true
    }
  }, [open, project.id])

  const labelNames = useMemo(() => labels.map((l) => l.name).filter(Boolean), [labels])

  const apply = useCallback(
    async (opts?: { forceDefaults?: boolean; forceCreateMissing?: boolean }) => {
      const mapping = opts?.forceDefaults
        ? readInitialMapping({ ...project, policy_json: JSON.stringify(DEFAULT_POLICY) })
        : { readyLabel, statusLabels }
      const shouldCreateMissing = opts?.forceCreateMissing ?? createMissingLabels

      const ready = mapping.readyLabel.trim()
      const s = mapping.statusLabels
      if (!ready || !s.draft || !s.ready || !s.inProgress || !s.inReview || !s.testing || !s.done) {
        toast.error('Please fill all label mappings')
        return
      }

      try {
        const res = await window.electron.ipcRenderer.invoke('applyLabelConfig', {
          projectId: project.id,
          readyLabel: ready,
          statusLabels: s,
          createMissingLabels: shouldCreateMissing
        })
        if (res?.error) {
          toast.error('Failed to apply labels', { description: res.error })
          return
        }
        toast.success('Labels configured', { description: 'Patchwork will use these labels for status.' })
        onApplied?.()
        onOpenChange(false)
      } catch (err) {
        toast.error('Failed to apply labels', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [createMissingLabels, onApplied, onOpenChange, project, readyLabel, statusLabels]
  )

  const dismiss = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('dismissLabelWizard', { projectId: project.id })
    } catch {
      // ignore
    } finally {
      onOpenChange(false)
    }
  }, [onOpenChange, project.id])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[720px] max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Set up issue labels</DialogTitle>
          <DialogDescription>
            Patchwork uses issue labels to map remote issues into Kanban columns and to push status changes back.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 pr-4 -mr-4">
          <div className="grid gap-4 py-2">
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Create missing labels</div>
                  <div className="text-xs text-muted-foreground">
                    If the chosen labels don&apos;t exist yet, Patchwork will create them in your repo.
                  </div>
                </div>
                <Switch checked={createMissingLabels} onCheckedChange={setCreateMissingLabels} className="shrink-0" />
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Existing labels</div>
                <div className="text-xs text-muted-foreground">{isLoading ? 'Loading…' : `${labels.length} found`}</div>
              </div>
              <div className="max-h-20 overflow-auto rounded-md border p-2">
                <div className="flex flex-wrap gap-2">
                  {labelNames.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No labels found.</div>
                  ) : (
                    labelNames.map((name) => (
                      <Badge key={name} variant="secondary">
                        {name}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setMapping(readInitialMapping({ ...project, policy_json: JSON.stringify(DEFAULT_POLICY) }))}>
                Use Patchwork defaults
              </Button>
              <Button type="button" size="sm" onClick={() => apply({ forceDefaults: true, forceCreateMissing: true })}>
                Create defaults and apply
              </Button>
            </div>

            <div className="grid gap-3 rounded-lg border p-3">
              <div className="text-sm font-medium">Label mapping</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-xs font-medium text-muted-foreground">Ready eligibility label</label>
                  <Input
                    value={readyLabel}
                    onChange={(e) => setMapping((prev) => ({ ...prev, readyLabel: e.target.value }))}
                    list="repo-label-options"
                    placeholder="ready"
                  />
                </div>

                {KANBAN_COLUMNS.map((col) => {
                  const key =
                    col.id === 'in_progress'
                      ? 'inProgress'
                      : col.id === 'in_review'
                        ? 'inReview'
                        : col.id
                  const value =
                    key === 'draft'
                      ? statusLabels.draft
                      : key === 'ready'
                        ? statusLabels.ready
                        : key === 'inProgress'
                          ? statusLabels.inProgress
                          : key === 'inReview'
                            ? statusLabels.inReview
                            : key === 'testing'
                              ? statusLabels.testing
                              : statusLabels.done

                  return (
                    <div key={col.id} className="grid gap-2">
                      <label className="text-xs font-medium text-muted-foreground">{col.label} label</label>
                      <Input
                        value={value}
                        onChange={(e) =>
                          setMapping((prev) => ({
                            ...prev,
                            statusLabels: { ...prev.statusLabels, [key]: e.target.value }
                          }))
                        }
                        list="repo-label-options"
                        placeholder={value}
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            <datalist id="repo-label-options">
              {labelNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 pt-4">
          <Button type="button" variant="outline" onClick={dismiss}>
            Skip
          </Button>
          <Button type="button" onClick={() => apply()} disabled={isLoading}>
            Apply mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
