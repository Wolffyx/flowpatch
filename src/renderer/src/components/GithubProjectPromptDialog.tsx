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
import type { Project } from '../../../shared/types'

export interface GithubProjectPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  onCreated?: () => void
}

export function GithubProjectPromptDialog({
  open,
  onOpenChange,
  project,
  onCreated
}: GithubProjectPromptDialogProps): React.JSX.Element {
  const defaultTitle = useMemo(() => `${project.name} Kanban`, [project.name])
  const [title, setTitle] = useState(defaultTitle)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(defaultTitle)
  }, [defaultTitle, open])

  const dismiss = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('dismissGithubProjectPrompt', {
        projectId: project.id
      })
    } catch {
      // ignore
    } finally {
      onOpenChange(false)
    }
  }, [onOpenChange, project.id])

  const create = useCallback(async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error('Project title is required')
      return
    }
    setIsCreating(true)
    try {
      const res = await window.electron.ipcRenderer.invoke('createGithubProjectV2', {
        projectId: project.id,
        title: trimmed
      })
      if (res?.error) {
        toast.error('Failed to create GitHub Project', { description: res.error })
        return
      }
      toast.success('GitHub Project created', { description: trimmed })
      onCreated?.()
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to create GitHub Project', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setIsCreating(false)
    }
  }, [onCreated, onOpenChange, project.id, title])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Create a GitHub Project?</DialogTitle>
          <DialogDescription>
            Patchwork can create a GitHub Projects V2 board for this repository and sync status from
            its Status field.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2">
          <label className="text-sm font-medium">Project title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={isCreating} />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={dismiss} disabled={isCreating}>
            Not now
          </Button>
          <Button type="button" onClick={create} disabled={isCreating}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
