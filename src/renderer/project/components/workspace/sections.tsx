import { useState } from 'react'
import { Badge } from '../../../src/components/ui/badge'
import { Input } from '../../../src/components/ui/input'
import { Switch } from '../../../src/components/ui/switch'
import { RefreshCw, Wrench, FolderOpen, ShieldCheck, Eye, FileText, ArrowUpRight } from 'lucide-react'
import { Section, ActionButton } from './ui'
import { jobIsActive, type ApprovalState } from './types'
import type { Job, FlowPatchWorkspaceStatus } from '@shared/types'

type ConfirmFn = (
  enabled: boolean | undefined,
  title: string,
  body: string,
  onConfirm: () => void
) => void

type RunFn = (fn: () => Promise<unknown>) => Promise<void>

interface SectionProps {
  status: FlowPatchWorkspaceStatus | null
  approval: ApprovalState | null
  maybeConfirm: ConfirmFn
  run: RunFn
  onRefreshStatus: () => Promise<void>
}

interface JobSectionProps extends SectionProps {
  jobs: {
    ensure: Job | null
    indexBuild: Job | null
    indexRefresh: Job | null
    watchStart: Job | null
    watchStop: Job | null
    docs: Job | null
    validate: Job | null
    preview: Job | null
    repair: Job | null
    migrate: Job | null
  }
}

export function WorkspaceSection({ run, jobs }: { run: RunFn; jobs: { ensure: Job | null } }): React.JSX.Element {
  return (
    <Section title="Workspace">
      <div className="flex gap-2">
        <ActionButton
          onClick={() => run(() => window.projectAPI.ensureWorkspace())}
          loading={jobIsActive(jobs.ensure)}
          icon={Wrench}
        >
          Initialize
        </ActionButton>
        <ActionButton onClick={() => window.projectAPI.openWorkspaceFolder()} icon={FolderOpen}>
          Open Folder
        </ActionButton>
      </div>
    </Section>
  )
}

export function IndexSection({
  status,
  approval,
  maybeConfirm,
  run,
  jobs
}: Pick<JobSectionProps, 'status' | 'approval' | 'maybeConfirm' | 'run'> & {
  jobs: { indexBuild: Job | null; indexRefresh: Job | null; watchStart: Job | null; watchStop: Job | null }
}): React.JSX.Element {
  return (
    <Section title="Index">
      <div className="flex items-center gap-2">
        <ActionButton
          onClick={() =>
            maybeConfirm(approval?.confirmIndexBuild, 'Run index build?', 'Scans repo and writes to .flowpatch/state/', () =>
              void run(() => window.projectAPI.indexBuild())
            )
          }
          loading={jobIsActive(jobs.indexBuild)}
          icon={RefreshCw}
        >
          Build
        </ActionButton>
        <ActionButton
          onClick={() =>
            maybeConfirm(approval?.confirmIndexRefresh, 'Refresh index?', 'Rescans repo and rewrites index', () =>
              void run(() => window.projectAPI.indexRefresh())
            )
          }
          loading={jobIsActive(jobs.indexRefresh)}
          icon={RefreshCw}
        >
          Refresh
        </ActionButton>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">Auto</span>
          <Switch
            checked={status?.autoIndexingEnabled ?? false}
            disabled={jobIsActive(jobs.watchStart) || jobIsActive(jobs.watchStop)}
            onCheckedChange={(next) =>
              maybeConfirm(
                approval?.confirmWatchToggle,
                next ? 'Enable auto indexing?' : 'Disable auto indexing?',
                next ? 'Starts background indexing' : 'Stops background indexing',
                () => void run(() => (next ? window.projectAPI.indexWatchStart() : window.projectAPI.indexWatchStop()))
              )
            }
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground truncate">
        Head: {status?.index.headSha?.slice(0, 8) ?? '—'} · Indexed: {status?.index.lastIndexedSha?.slice(0, 8) ?? '—'}
      </p>
    </Section>
  )
}

export function DocsPlanSection({
  status,
  approval,
  maybeConfirm,
  run,
  onRefreshStatus,
  jobs
}: Pick<SectionProps, 'status' | 'approval' | 'maybeConfirm' | 'run' | 'onRefreshStatus'> & {
  jobs: { docs: Job | null }
}): React.JSX.Element {
  const [creatingPlan, setCreatingPlan] = useState(false)

  return (
    <Section title="Docs & Plan">
      <div className="flex gap-2">
        <ActionButton
          onClick={() =>
            maybeConfirm(approval?.confirmDocsRefresh, 'Refresh docs?', 'Updates generated sections in .flowpatch/docs/', () =>
              void run(() => window.projectAPI.docsRefresh())
            )
          }
          loading={jobIsActive(jobs.docs)}
          icon={RefreshCw}
        >
          Refresh Docs
        </ActionButton>
        {status?.hasPlan ? (
          <Badge variant="outline" className="h-8 px-3">
            PLAN.md exists
          </Badge>
        ) : (
          <ActionButton
            onClick={async () => {
              setCreatingPlan(true)
              try {
                await window.projectAPI.createPlanFile()
                await onRefreshStatus()
              } finally {
                setCreatingPlan(false)
              }
            }}
            loading={creatingPlan}
            disabled={!status?.writable}
            icon={FileText}
          >
            Create Plan
          </ActionButton>
        )}
      </div>
    </Section>
  )
}

export function ConfigSection({
  run,
  jobs,
  diagnostics
}: {
  run: RunFn
  jobs: { validate: Job | null }
  diagnostics?: { level: 'error' | 'warning'; message: string }[]
}): React.JSX.Element {
  return (
    <Section title="Config">
      <ActionButton
        onClick={() => run(() => window.projectAPI.validateConfig())}
        loading={jobIsActive(jobs.validate)}
        icon={ShieldCheck}
      >
        Validate
      </ActionButton>
      {diagnostics && diagnostics.length > 0 && (
        <div className="space-y-1 mt-2">
          {diagnostics.map((d, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs">
              <span className={d.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{d.message}</span>
              <Badge variant={d.level === 'error' ? 'destructive' : 'secondary'} className="text-[10px] h-5">
                {d.level}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

export function ContextPreviewSection({
  approval,
  maybeConfirm,
  run,
  jobs,
  previewIncluded
}: Pick<SectionProps, 'approval' | 'maybeConfirm' | 'run'> & {
  jobs: { preview: Job | null }
  previewIncluded?: { path: string; score: number }[]
}): React.JSX.Element {
  const [previewTask, setPreviewTask] = useState('Find the entrypoints for auth and routing.')

  return (
    <Section title="Context Preview">
      <div className="flex gap-2">
        <Input
          value={previewTask}
          onChange={(e) => setPreviewTask(e.target.value)}
          className="h-8 text-sm"
          placeholder="Task description..."
        />
        <ActionButton
          onClick={() =>
            maybeConfirm(approval?.confirmContextPreview, 'Generate preview?', 'Builds context bundle and writes to state/', () =>
              void run(() => window.projectAPI.contextPreview(previewTask))
            )
          }
          loading={jobIsActive(jobs.preview)}
          icon={Eye}
        >
          Preview
        </ActionButton>
      </div>
      {previewIncluded && previewIncluded.length > 0 && (
        <div className="space-y-0.5 mt-2">
          {previewIncluded.slice(0, 5).map((f) => (
            <div key={f.path} className="flex items-center justify-between text-xs">
              <span className="truncate text-muted-foreground">{f.path}</span>
              <Badge variant="secondary" className="text-[10px] h-5 ml-2">
                {Math.round(f.score)}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

export function MaintenanceSection({
  approval,
  maybeConfirm,
  run,
  jobs
}: Pick<SectionProps, 'approval' | 'maybeConfirm' | 'run'> & {
  jobs: { repair: Job | null; migrate: Job | null }
}): React.JSX.Element {
  return (
    <Section title="Maintenance">
      <div className="flex gap-2">
        <ActionButton
          onClick={() =>
            maybeConfirm(approval?.confirmRepair, 'Repair workspace?', 'Creates missing templates and updates .gitignore', () =>
              void run(() => window.projectAPI.repairWorkspace())
            )
          }
          loading={jobIsActive(jobs.repair)}
          icon={Wrench}
        >
          Repair
        </ActionButton>
        <ActionButton
          onClick={() =>
            maybeConfirm(approval?.confirmMigrate, 'Migrate workspace?', 'Updates config and templates to newer schema', () =>
              void run(() => window.projectAPI.migrateWorkspace())
            )
          }
          loading={jobIsActive(jobs.migrate)}
          icon={ArrowUpRight}
        >
          Migrate
        </ActionButton>
      </div>
    </Section>
  )
}
