import { useCallback, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../src/components/ui/dialog'
import { Button } from '../../../src/components/ui/button'
import { Badge } from '../../../src/components/ui/badge'
import { ScrollArea } from '../../../src/components/ui/scroll-area'
import { RefreshCw } from 'lucide-react'
import type { Job, FlowPatchWorkspaceStatus } from '@shared/types'
import { latestJobOfType, jobIsActive, parseJobResult, defaultApproval, type ApprovalState } from './types'
import {
  WorkspaceSection,
  IndexSection,
  DocsPlanSection,
  ConfigSection,
  ContextPreviewSection,
  MaintenanceSection
} from './sections'

interface WorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: FlowPatchWorkspaceStatus | null
  jobs: Job[]
  onRefreshStatus: () => Promise<void>
}

export function WorkspaceDialog({
  open,
  onOpenChange,
  status,
  jobs,
  onRefreshStatus
}: WorkspaceDialogProps): React.JSX.Element {
  const [confirm, setConfirm] = useState<{ title: string; body: string; onConfirm: () => void } | null>(null)
  const [approval, setApproval] = useState<ApprovalState | null>(null)

  const jobMap = useMemo(
    () => ({
      ensure: latestJobOfType(jobs, 'workspace_ensure'),
      indexBuild: latestJobOfType(jobs, 'index_build'),
      indexRefresh: latestJobOfType(jobs, 'index_refresh'),
      watchStart: latestJobOfType(jobs, 'index_watch_start'),
      watchStop: latestJobOfType(jobs, 'index_watch_stop'),
      docs: latestJobOfType(jobs, 'docs_refresh'),
      validate: latestJobOfType(jobs, 'config_validate'),
      preview: latestJobOfType(jobs, 'context_preview'),
      repair: latestJobOfType(jobs, 'repair'),
      migrate: latestJobOfType(jobs, 'migrate')
    }),
    [jobs]
  )

  const validateResult = parseJobResult(jobMap.validate)
  const diagnostics = (validateResult?.artifacts as any)?.diagnostics as
    | { level: 'error' | 'warning'; message: string }[]
    | undefined

  const previewResult = parseJobResult(jobMap.preview)
  const previewIncluded = (previewResult?.artifacts as any)?.included as { path: string; score: number }[] | undefined

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      await fn()
      await onRefreshStatus()
    },
    [onRefreshStatus]
  )

  const maybeConfirm = useCallback(
    (enabled: boolean | undefined, title: string, body: string, onConfirm: () => void): void => {
      if (enabled === false) {
        onConfirm()
        return
      }
      setConfirm({ title, body, onConfirm })
    },
    []
  )

  const anyBusy = useMemo(
    () => Object.values(jobMap).some(jobIsActive),
    [jobMap]
  )

  const loadApproval = useCallback(async (): Promise<void> => {
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
        setApproval(defaultApproval)
      }
    } catch {
      setApproval(defaultApproval)
    }
  }, [])

  const indexState = status?.index.state
  const indexBadgeVariant = indexState === 'ready' ? 'default' : indexState === 'blocked' ? 'destructive' : 'secondary'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) void loadApproval()
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader className="pb-2">
          <div className="flex items-center justify-between">
            <DialogTitle>Workspace</DialogTitle>
            <Button variant="ghost" size="sm" onClick={() => onRefreshStatus()} disabled={anyBusy}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5 pb-2 border-b">
          <Badge variant={status?.exists ? 'default' : 'secondary'}>
            {status?.exists ? '.flowpatch' : 'no .flowpatch'}
          </Badge>
          <Badge variant={status?.writable ? 'default' : 'destructive'}>
            {status?.writable ? 'writable' : 'read-only'}
          </Badge>
          <Badge variant={status?.gitignoreHasStateIgnore ? 'default' : 'secondary'}>
            {status?.gitignoreHasStateIgnore ? 'gitignore ok' : 'gitignore needs update'}
          </Badge>
          <Badge variant={indexBadgeVariant}>index {indexState ?? 'missing'}</Badge>
          {status?.hasPlan && <Badge variant="default">plan</Badge>}
          {status?.autoIndexingEnabled && <Badge variant="secondary">auto-index</Badge>}
        </div>

        <ScrollArea className="h-[380px] pr-3">
          <div className="space-y-4">
            <WorkspaceSection run={run} jobs={{ ensure: jobMap.ensure }} />
            <IndexSection
              status={status}
              approval={approval}
              maybeConfirm={maybeConfirm}
              run={run}
              jobs={{
                indexBuild: jobMap.indexBuild,
                indexRefresh: jobMap.indexRefresh,
                watchStart: jobMap.watchStart,
                watchStop: jobMap.watchStop
              }}
            />
            <DocsPlanSection
              status={status}
              approval={approval}
              maybeConfirm={maybeConfirm}
              run={run}
              onRefreshStatus={onRefreshStatus}
              jobs={{ docs: jobMap.docs }}
            />
            <ConfigSection run={run} jobs={{ validate: jobMap.validate }} diagnostics={diagnostics} />
            <ContextPreviewSection
              approval={approval}
              maybeConfirm={maybeConfirm}
              run={run}
              jobs={{ preview: jobMap.preview }}
              previewIncluded={previewIncluded}
            />
            <MaintenanceSection
              approval={approval}
              maybeConfirm={maybeConfirm}
              run={run}
              jobs={{ repair: jobMap.repair, migrate: jobMap.migrate }}
            />
          </div>
        </ScrollArea>

        {confirm && (
          <div className="border-t pt-3 mt-2">
            <p className="font-medium text-sm">{confirm.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{confirm.body}</p>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
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
