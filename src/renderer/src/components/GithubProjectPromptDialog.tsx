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
import { Loader2, Search, Plus, Check } from 'lucide-react'
import { cn } from '../lib/utils'
import type { Project } from '../../../shared/types'

interface GithubProject {
  id: string
  title: string
  number: number
}

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
  const [isLoading, setIsLoading] = useState(false)
  const [isLinking, setIsLinking] = useState(false)
  const [existingProjects, setExistingProjects] = useState<GithubProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [mode, setMode] = useState<'loading' | 'select' | 'create'>('loading')

  // Load existing projects when dialog opens
  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setExistingProjects([])
      setSelectedProjectId(null)
      setMode('loading')
      setTitle(defaultTitle)
      return
    }

    const loadProjects = async (): Promise<void> => {
      setIsLoading(true)
      setMode('loading')
      try {
        const res = (await window.electron.ipcRenderer.invoke('listGithubRepositoryProjects', {
          projectId: project.id
        })) as { projects?: GithubProject[]; error?: string }
        if (res?.projects && res.projects.length > 0) {
          setExistingProjects(res.projects)
          // Auto-select the first project
          setSelectedProjectId(res.projects[0].id)
          setMode('select')
        } else {
          setExistingProjects([])
          setMode('create')
        }
      } catch (error) {
        console.error('Failed to load GitHub projects:', error)
        setMode('create')
      } finally {
        setIsLoading(false)
      }
    }

    loadProjects()
  }, [open, project.id, defaultTitle])

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

  const linkExisting = useCallback(async () => {
    if (!selectedProjectId) {
      toast.error('Please select a project')
      return
    }
    setIsLinking(true)
    try {
      const res = (await window.electron.ipcRenderer.invoke('linkGithubProjectV2', {
        projectId: project.id,
        githubProjectId: selectedProjectId
      })) as { success?: boolean; error?: string; projectId?: string }
      if (res?.error) {
        toast.error('Failed to link GitHub Project', { description: res.error })
        return
      }
      const linkedProject = existingProjects.find((p) => p.id === selectedProjectId)
      toast.success('GitHub Project linked', {
        description: linkedProject?.title || 'Project linked successfully'
      })
      onCreated?.()
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to link GitHub Project', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setIsLinking(false)
    }
  }, [existingProjects, onCreated, onOpenChange, project.id, selectedProjectId])

  const create = useCallback(async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error('Project title is required')
      return
    }
    setIsCreating(true)
    try {
      const res = (await window.electron.ipcRenderer.invoke('createGithubProjectV2', {
        projectId: project.id,
        title: trimmed
      })) as { success?: boolean; error?: string; projectId?: string }
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

  const isProcessing = isCreating || isLinking || isLoading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'loading'
              ? 'Checking for GitHub Projects...'
              : mode === 'select'
                ? 'Link GitHub Project'
                : 'Create a GitHub Project?'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'loading'
              ? 'Looking for existing GitHub Projects linked to this repository...'
              : mode === 'select'
                ? 'We found existing GitHub Projects linked to this repository. Select one to sync status, or create a new one.'
                : 'FlowPatch can create a GitHub Projects V2 board for this repository and sync status from its Status field.'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'loading' && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {mode === 'select' && (
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Search className="h-4 w-4" />
              Select existing project
            </label>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {existingProjects.map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => setSelectedProjectId(proj.id)}
                  disabled={isProcessing}
                  className={cn(
                    'w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors',
                    selectedProjectId === proj.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  )}
                >
                  <div>
                    <div className="font-medium">{proj.title}</div>
                    <div className="text-xs text-muted-foreground">Project #{proj.number}</div>
                  </div>
                  {selectedProjectId === proj.id && <Check className="h-5 w-5 text-primary" />}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode('create')}
              disabled={isProcessing}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create new project instead
            </Button>
          </div>
        )}

        {mode === 'create' && (
          <div className="space-y-3 py-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Project title</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isProcessing}
              />
            </div>
            {existingProjects.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMode('select')}
                disabled={isProcessing}
                className="w-full"
              >
                <Search className="h-4 w-4 mr-2" />
                Use existing project instead
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={dismiss} disabled={isProcessing}>
            Not now
          </Button>
          {mode === 'select' && (
            <Button type="button" onClick={linkExisting} disabled={isProcessing || !selectedProjectId}>
              {isLinking && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Link Project
            </Button>
          )}
          {mode === 'create' && (
            <Button type="button" onClick={create} disabled={isProcessing}>
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
