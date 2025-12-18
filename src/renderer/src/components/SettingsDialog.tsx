import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { cn } from '../lib/utils'
import { Check, Loader2, Sparkles, Bot, Code } from 'lucide-react'
import type { PolicyConfig, Project } from '../../../shared/types'

export type WorkerToolPreference = 'auto' | 'claude' | 'codex'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  onSetWorkerToolPreference: (toolPreference: WorkerToolPreference) => Promise<void>
  onSetWorkerRollbackOnCancel: (rollbackOnCancel: boolean) => Promise<void>
  onSetShowPullRequestsSection: (showPullRequestsSection: boolean) => Promise<void>
}

function readToolPreference(project: Project): WorkerToolPreference {
  if (!project.policy_json) return 'auto'
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    const pref = policy?.worker?.toolPreference
    if (pref === 'claude' || pref === 'codex' || pref === 'auto') return pref
    return 'auto'
  } catch {
    return 'auto'
  }
}

function readRollbackOnCancel(project: Project): boolean {
  if (!project.policy_json) return false
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return !!policy?.worker?.rollbackOnCancel
  } catch {
    return false
  }
}

function readShowPullRequestsSection(project: Project): boolean {
  if (!project.policy_json) return false
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return !!policy?.ui?.showPullRequestsSection
  } catch {
    return false
  }
}

export function SettingsDialog({
  open,
  onOpenChange,
  project,
  onSetWorkerToolPreference,
  onSetWorkerRollbackOnCancel,
  onSetShowPullRequestsSection
}: SettingsDialogProps): React.JSX.Element {
  const initialPreference = useMemo(() => readToolPreference(project), [project])
  const initialRollbackOnCancel = useMemo(() => readRollbackOnCancel(project), [project])
  const initialShowPullRequestsSection = useMemo(() => readShowPullRequestsSection(project), [project])
  const [toolPreference, setToolPreference] = useState<WorkerToolPreference>(initialPreference)
  const [rollbackOnCancel, setRollbackOnCancel] = useState(initialRollbackOnCancel)
  const [showPullRequestsSection, setShowPullRequestsSection] = useState(initialShowPullRequestsSection)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setToolPreference(readToolPreference(project))
    setRollbackOnCancel(readRollbackOnCancel(project))
    setShowPullRequestsSection(readShowPullRequestsSection(project))
    setError(null)
    setIsSaving(false)
  }, [open, project])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setError(null)
    try {
      const nextActions: Promise<void>[] = []

      const existingPreference = readToolPreference(project)
      if (existingPreference !== toolPreference) {
        nextActions.push(onSetWorkerToolPreference(toolPreference))
      }

      const existingRollback = readRollbackOnCancel(project)
      if (existingRollback !== rollbackOnCancel) {
        nextActions.push(onSetWorkerRollbackOnCancel(rollbackOnCancel))
      }

      const existingShowPRs = readShowPullRequestsSection(project)
      if (existingShowPRs !== showPullRequestsSection) {
        nextActions.push(onSetShowPullRequestsSection(showPullRequestsSection))
      }

      await Promise.all(nextActions)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }, [
    onOpenChange,
    onSetShowPullRequestsSection,
    onSetWorkerRollbackOnCancel,
    onSetWorkerToolPreference,
    project,
    rollbackOnCancel,
    showPullRequestsSection,
    toolPreference
  ])

  const options: {
    id: WorkerToolPreference
    title: string
    description: string
    icon: ReactNode
    disabled?: boolean
  }[] = [
    {
      id: 'auto',
      title: 'Auto',
      description: 'Use Claude Code if available; otherwise use Codex.',
      icon: <Sparkles className="h-4 w-4 text-muted-foreground" />
    },
    {
      id: 'claude',
      title: 'Claude Code',
      description: 'Prefer the Claude Code CLI when the worker runs.',
      icon: <Bot className="h-4 w-4 text-muted-foreground" />
    },
    {
      id: 'codex',
      title: 'Codex',
      description: 'Prefer the Codex CLI when the worker runs.',
      icon: <Code className="h-4 w-4 text-muted-foreground" />
    }
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Choose which AI agent to use for this project&apos;s worker runs.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">AI Agent</label>
            <div className="grid gap-2">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setToolPreference(opt.id)}
                  disabled={isSaving || opt.disabled}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    toolPreference === opt.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                    (isSaving || opt.disabled) && 'opacity-60'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border',
                      toolPreference === opt.id
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground'
                    )}
                  >
                    {toolPreference === opt.id && <Check className="h-3 w-3" />}
                  </div>
                  {opt.icon}
                  <div className="flex-1">
                    <div className="font-medium">{opt.title}</div>
                    <div className="text-xs text-muted-foreground">{opt.description}</div>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Stored in this project&apos;s policy (database). The worker still falls back if the
              selected CLI isn&apos;t installed.
            </p>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Cancel Behavior</label>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="flex-1">
                <div className="font-medium text-sm">Rollback changes on cancel</div>
                <div className="text-xs text-muted-foreground">
                  If you move a running card back to Draft (or forward to In Review/Testing/Done), the worker is canceled.
                  Enable this to attempt to roll back the worker&apos;s local changes.
                </div>
              </div>
              <Switch
                checked={rollbackOnCancel}
                onCheckedChange={setRollbackOnCancel}
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Board</label>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="flex-1">
                <div className="font-medium text-sm">Show Pull Requests section</div>
                <div className="text-xs text-muted-foreground">
                  When enabled, pull requests / merge requests are shown in a separate section (and removed from the Kanban columns).
                </div>
              </div>
              <Switch
                checked={showPullRequestsSection}
                onCheckedChange={setShowPullRequestsSection}
                disabled={isSaving}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
