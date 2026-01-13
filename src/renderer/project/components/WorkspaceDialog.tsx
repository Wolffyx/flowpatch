import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../src/components/ui/dialog'
import { Button } from '../../src/components/ui/button'
import { Badge } from '../../src/components/ui/badge'
import { Input } from '../../src/components/ui/input'
import { ScrollArea } from '../../src/components/ui/scroll-area'
import { Switch } from '../../src/components/ui/switch'
import { Loader2, RefreshCw, Wrench, ArrowUpRight, ShieldCheck, Eye } from 'lucide-react'
import type { Job, FlowPatchWorkspaceStatus, JobResultEnvelope } from '@shared/types'

interface WorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: FlowPatchWorkspaceStatus | null
  jobs: Job[]
  onRefreshStatus: () => Promise<void>
}

function latestJobOfType(jobs: Job[], type: Job['type']): Job | null {
  const matches = jobs.filter((j) => j.type === type)
  if (matches.length === 0) return null
  return matches.reduce((latest, job) => {
    const latestTime = latest.updated_at || latest.created_at
    const jobTime = job.updated_at || job.created_at
    return jobTime > latestTime ? job : latest
  })
}

function jobIsActive(job: Job | null): boolean {
  return job?.state === 'queued' || job?.state === 'running'
}

function parseJobResult(job: Job | null): JobResultEnvelope | null {
  if (!job?.result_json) return null
  try {
    return JSON.parse(job.result_json) as JobResultEnvelope
  } catch {
    return null
  }
}

export function WorkspaceDialog({
  open,
  onOpenChange,
  status,
  jobs,
  onRefreshStatus
}: WorkspaceDialogProps): React.JSX.Element {
  const [previewTask, setPreviewTask] = useState('Find the entrypoints for auth and routing.')
  const [confirm, setConfirm] = useState<null | {
    title: string
    body: string
    onConfirm: () => void
  }>(null)
  const [approval, setApproval] = useState<{
    confirmIndexBuild: boolean
    confirmIndexRefresh: boolean
    confirmWatchToggle: boolean
    confirmDocsRefresh: boolean
    confirmContextPreview: boolean
    confirmRepair: boolean
    confirmMigrate: boolean
  } | null>(null)

  const ensureJob = useMemo(() => latestJobOfType(jobs, 'workspace_ensure'), [jobs])
  const indexBuildJob = useMemo(() => latestJobOfType(jobs, 'index_build'), [jobs])
  const indexRefreshJob = useMemo(() => latestJobOfType(jobs, 'index_refresh'), [jobs])
  const watchStartJob = useMemo(() => latestJobOfType(jobs, 'index_watch_start'), [jobs])
  const watchStopJob = useMemo(() => latestJobOfType(jobs, 'index_watch_stop'), [jobs])
  const docsJob = useMemo(() => latestJobOfType(jobs, 'docs_refresh'), [jobs])
  const validateJob = useMemo(() => latestJobOfType(jobs, 'config_validate'), [jobs])
  const previewJob = useMemo(() => latestJobOfType(jobs, 'context_preview'), [jobs])
  const repairJob = useMemo(() => latestJobOfType(jobs, 'repair'), [jobs])
  const migrateJob = useMemo(() => latestJobOfType(jobs, 'migrate'), [jobs])

  const validateResult = parseJobResult(validateJob)
  const diagnostics = (validateResult?.artifacts as any)?.diagnostics as
    | { level: 'error' | 'warning'; message: string }[]
    | undefined

  const previewResult = parseJobResult(previewJob)
  const previewPath = (previewResult?.artifacts as any)?.previewPath as string | undefined
  const previewIncluded = (previewResult?.artifacts as any)?.included as
    | { path: string; score: number; reasons: string[] }[]
    | undefined

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    await fn()
    await onRefreshStatus()
  }

  const requireConfirm = (title: string, body: string, onConfirm: () => void): void => {
    setConfirm({ title, body, onConfirm })
  }

  const maybeConfirm = (
    enabled: boolean | undefined,
    title: string,
    body: string,
    onConfirm: () => void
  ): void => {
    if (enabled === false) {
      onConfirm()
      return
    }
    requireConfirm(title, body, onConfirm)
  }

  const anyBusy =
    jobIsActive(ensureJob) ||
    jobIsActive(indexBuildJob) ||
    jobIsActive(indexRefreshJob) ||
    jobIsActive(watchStartJob) ||
    jobIsActive(watchStopJob) ||
    jobIsActive(docsJob) ||
    jobIsActive(validateJob) ||
    jobIsActive(previewJob) ||
    jobIsActive(repairJob) ||
    jobIsActive(migrateJob)

  const loadApproval = async (): Promise<void> => {
    try {
      const res = (await window.projectAPI.getFlowPatchConfig()) as any
      const a = res?.config?.approval
      if (a && typeof a === 'object') {
        setApproval({
          confirmIndexBuild: a.confirmIndexBuild !== false,
          confirmIndexRefresh: a.confirmIndexRefresh !== false,
          confirmWatchToggle: a.confirmWatchToggle !== false,
          confirmDocsRefresh: a.confirmDocsRefresh !== false,
          confirmContextPreview: a.confirmContextPreview !== false,
          confirmRepair: a.confirmRepair !== false,
          confirmMigrate: a.confirmMigrate !== false
        })
      } else {
        setApproval({
          confirmIndexBuild: true,
          confirmIndexRefresh: true,
          confirmWatchToggle: true,
          confirmDocsRefresh: true,
          confirmContextPreview: true,
          confirmRepair: true,
          confirmMigrate: true
        })
      }
    } catch {
      setApproval({
        confirmIndexBuild: true,
        confirmIndexRefresh: true,
        confirmWatchToggle: true,
        confirmDocsRefresh: true,
        confirmContextPreview: true,
        confirmRepair: true,
        confirmMigrate: true
      })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) void loadApproval()
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Workspace</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant={status?.exists ? 'default' : 'secondary'}>
              .flowpatch {status?.exists ? 'present' : 'missing'}
            </Badge>
            <Badge variant={status?.writable ? 'default' : 'destructive'}>
              {status?.writable ? 'writable' : 'read-only'}
            </Badge>
            <Badge variant={status?.gitignoreHasStateIgnore ? 'default' : 'secondary'}>
              gitignore {status?.gitignoreHasStateIgnore ? 'ok' : 'needs update'}
            </Badge>
            <Badge
              variant={
                status?.index.state === 'ready'
                  ? 'default'
                  : status?.index.state === 'stale'
                    ? 'secondary'
                    : status?.index.state === 'blocked'
                      ? 'destructive'
                      : 'outline'
              }
            >
              index {status?.index.state ?? 'missing'}
            </Badge>
            {status?.autoIndexingEnabled && <Badge variant="secondary">auto indexing</Badge>}
            {status?.watchEnabled && <Badge variant="secondary">watch</Badge>}
          </div>

          <Button variant="outline" size="sm" onClick={() => onRefreshStatus()} disabled={anyBusy}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <ScrollArea className="h-[520px] pr-4">
          <div className="space-y-6 py-2">
            {/* Workspace health */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Workspace</h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => run(() => window.projectAPI.ensureWorkspace())}
                  disabled={jobIsActive(ensureJob)}
                >
                  {jobIsActive(ensureJob) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="mr-2 h-4 w-4" />
                  )}
                  Initialize / Ensure
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.projectAPI.openWorkspaceFolder()}
                >
                  <ArrowUpRight className="mr-2 h-4 w-4" />
                  Open .flowpatch
                </Button>
              </div>
            </section>

            {/* Index */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Index</h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    maybeConfirm(
                      approval?.confirmIndexBuild,
                      'Run index build?',
                      'This scans the repo and writes to .flowpatch/state/. Continue?',
                      () => void run(() => window.projectAPI.indexBuild())
                    )
                  }
                  disabled={jobIsActive(indexBuildJob)}
                >
                  {jobIsActive(indexBuildJob) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Run index
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    maybeConfirm(
                      approval?.confirmIndexRefresh,
                      'Refresh index?',
                      'This rescans the repo and rewrites .flowpatch/state/index/. Continue?',
                      () => void run(() => window.projectAPI.indexRefresh())
                    )
                  }
                  disabled={jobIsActive(indexRefreshJob)}
                >
                  {jobIsActive(indexRefreshJob) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh index
                </Button>

                <div className="flex items-center gap-2 ml-2">
                  <span className="text-sm text-muted-foreground">Auto indexing</span>
                  <Switch
                    checked={status?.autoIndexingEnabled ?? false}
                    disabled={jobIsActive(watchStartJob) || jobIsActive(watchStopJob)}
                    onCheckedChange={(next) =>
                      maybeConfirm(
                        approval?.confirmWatchToggle,
                        next ? 'Enable auto indexing?' : 'Disable auto indexing?',
                        next
                          ? 'This will start background indexing (watch + periodic). Continue?'
                          : 'This will stop background indexing and cancel any in-progress auto index run. Continue?',
                        () =>
                          void run(() =>
                            next
                              ? window.projectAPI.indexWatchStart()
                              : window.projectAPI.indexWatchStop()
                          )
                      )
                    }
                  />
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Head: {status?.index.headSha ?? '—'} · Indexed:{' '}
                {status?.index.lastIndexedSha ?? '—'} · Last: {status?.index.lastIndexedAt ?? '—'}
              </div>
              {(status?.index.warnings?.length ?? 0) > 0 && (
                <div className="space-y-1 text-sm">
                  {status?.index.warnings?.map((w) => (
                    <div key={w} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{w}</span>
                      <Badge variant="secondary">warning</Badge>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Docs */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Docs</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  maybeConfirm(
                    approval?.confirmDocsRefresh,
                    'Refresh docs?',
                    'This updates generated sections in .flowpatch/docs/*. Continue?',
                    () => void run(() => window.projectAPI.docsRefresh())
                  )
                }
                disabled={jobIsActive(docsJob)}
              >
                {jobIsActive(docsJob) ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh docs
              </Button>
            </section>

            {/* Config */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Config</h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => run(() => window.projectAPI.validateConfig())}
                  disabled={jobIsActive(validateJob)}
                >
                  {jobIsActive(validateJob) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-2 h-4 w-4" />
                  )}
                  Validate config
                </Button>
              </div>

              {diagnostics && diagnostics.length > 0 && (
                <div className="space-y-1 text-sm">
                  {diagnostics.map((d, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <span
                        className={
                          d.level === 'error' ? 'text-destructive' : 'text-muted-foreground'
                        }
                      >
                        {d.message}
                      </span>
                      <Badge variant={d.level === 'error' ? 'destructive' : 'secondary'}>
                        {d.level}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Context preview */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Context Preview</h3>
              <div className="flex items-center gap-2">
                <Input value={previewTask} onChange={(e) => setPreviewTask(e.target.value)} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    maybeConfirm(
                      approval?.confirmContextPreview,
                      'Generate context preview?',
                      'This will build a minimal context bundle and write .flowpatch/state/last_context.json.',
                      () => void run(() => window.projectAPI.contextPreview(previewTask))
                    )
                  }
                  disabled={jobIsActive(previewJob)}
                >
                  {jobIsActive(previewJob) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="mr-2 h-4 w-4" />
                  )}
                  Preview
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Writes audit metadata to `.flowpatch/state/last_context.json` in the repo.
              </div>
              {previewPath && (
                <div className="text-xs text-muted-foreground">
                  Last preview: <span className="font-mono">{previewPath}</span>
                </div>
              )}
              {previewIncluded && previewIncluded.length > 0 && (
                <div className="space-y-1 text-sm">
                  {previewIncluded.slice(0, 8).map((f) => (
                    <div key={f.path} className="flex items-center justify-between">
                      <span className="truncate">{f.path}</span>
                      <Badge variant="secondary">{Math.round(f.score)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Maintenance */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Maintenance</h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    maybeConfirm(
                      approval?.confirmRepair,
                      'Repair workspace?',
                      'This will create missing .flowpatch templates and ensure .gitignore contains .flowpatch/state/. Continue?',
                      () => void run(() => window.projectAPI.repairWorkspace())
                    )
                  }
                  disabled={jobIsActive(repairJob)}
                >
                  {jobIsActive(repairJob) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="mr-2 h-4 w-4" />
                  )}
                  Repair
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    maybeConfirm(
                      approval?.confirmMigrate,
                      'Migrate workspace?',
                      'This may update .flowpatch/config.yml and templates to a newer schema. Continue?',
                      () => void run(() => window.projectAPI.migrateWorkspace())
                    )
                  }
                  disabled={jobIsActive(migrateJob)}
                >
                  {jobIsActive(migrateJob) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                  )}
                  Migrate
                </Button>
              </div>
            </section>
          </div>
        </ScrollArea>

        {/* Lightweight confirm dialog */}
        {confirm && (
          <div className="border-t pt-3 mt-2">
            <div className="font-medium">{confirm.title}</div>
            <div className="text-sm text-muted-foreground mt-1">{confirm.body}</div>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const action = confirm.onConfirm
                  setConfirm(null)
                  action()
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
