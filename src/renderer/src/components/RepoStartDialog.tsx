import { useCallback, useMemo, useState } from 'react'
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
import { Check, FolderOpen, Github, GitlabIcon, Loader2, Plus, Server } from 'lucide-react'
import { cn } from '../lib/utils'
import type { CreateRepoPayload, RemoteProviderChoice, RepoVisibility } from '../../../shared/types'

interface RepoStartDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenRepo: () => Promise<void>
  onCreateRepo: (payload: CreateRepoPayload) => Promise<void>
}

export function RepoStartDialog({
  open,
  onOpenChange,
  onOpenRepo,
  onCreateRepo
}: RepoStartDialogProps): React.JSX.Element {
  const [mode, setMode] = useState<'choose' | 'create'>('choose')
  const [repoName, setRepoName] = useState('')
  const [localParentPath, setLocalParentPath] = useState('')
  const [remoteProvider, setRemoteProvider] = useState<RemoteProviderChoice>('none')
  const [remoteVisibility, setRemoteVisibility] = useState<RepoVisibility>('private')
  const [remoteName, setRemoteName] = useState('origin')
  const [githubOwner, setGithubOwner] = useState('')
  const [gitlabHost, setGitlabHost] = useState('gitlab.com')
  const [gitlabNamespace, setGitlabNamespace] = useState('')
  const [addReadme, setAddReadme] = useState(true)
  const [initialCommit, setInitialCommit] = useState(true)
  const [pushToRemote, setPushToRemote] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fullRepoPath = useMemo(() => {
    if (!localParentPath.trim() || !repoName.trim()) return ''
    const parent = localParentPath.replace(/[\\/]+$/, '')
    return `${parent}\\${repoName.trim()}`
  }, [localParentPath, repoName])

  const canSubmit = repoName.trim().length > 0 && localParentPath.trim().length > 0

  const reset = useCallback(() => {
    setMode('choose')
    setRepoName('')
    setLocalParentPath('')
    setRemoteProvider('none')
    setRemoteVisibility('private')
    setRemoteName('origin')
    setGithubOwner('')
    setGitlabHost('gitlab.com')
    setGitlabNamespace('')
    setAddReadme(true)
    setInitialCommit(true)
    setPushToRemote(false)
    setIsSubmitting(false)
    setError(null)
  }, [])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isSubmitting) {
        reset()
      }
      onOpenChange(nextOpen)
    },
    [isSubmitting, onOpenChange, reset]
  )

  const handleBrowse = useCallback(async () => {
    setError(null)
    const result = await window.electron.ipcRenderer.invoke('selectDirectory')
    if (result?.error) {
      setError(result.error)
      return
    }
    if (!result?.canceled && result?.path) {
      setLocalParentPath(result.path)
    }
  }, [])

  const handleOpenRepo = useCallback(async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      await onOpenRepo()
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open repository')
    } finally {
      setIsSubmitting(false)
    }
  }, [handleOpenChange, onOpenRepo])

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit) {
        setError('Repository name and local parent path are required.')
        return
      }

      const payload: CreateRepoPayload = {
        repoName: repoName.trim(),
        localParentPath: localParentPath.trim(),
        addReadme,
        initialCommit,
        remoteProvider,
        remoteVisibility: remoteProvider === 'none' ? undefined : remoteVisibility,
        remoteName: remoteProvider === 'none' ? undefined : remoteName.trim() || 'origin',
        pushToRemote: remoteProvider === 'none' ? undefined : pushToRemote,
        githubOwner: remoteProvider === 'github' ? githubOwner.trim() || undefined : undefined,
        gitlabHost: remoteProvider === 'gitlab' ? gitlabHost.trim() || undefined : undefined,
        gitlabNamespace:
          remoteProvider === 'gitlab' ? gitlabNamespace.trim() || undefined : undefined
      }

      setIsSubmitting(true)
      setError(null)
      try {
        await onCreateRepo(payload)
        handleOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create repository')
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      addReadme,
      canSubmit,
      githubOwner,
      gitlabHost,
      gitlabNamespace,
      handleOpenChange,
      initialCommit,
      localParentPath,
      onCreateRepo,
      pushToRemote,
      remoteName,
      remoteProvider,
      remoteVisibility,
      repoName
    ]
  )

  const providerIcon = (provider: RemoteProviderChoice): React.ReactNode => {
    switch (provider) {
      case 'github':
        return <Github className="h-4 w-4 text-muted-foreground" />
      case 'gitlab':
        return <GitlabIcon className="h-4 w-4 text-muted-foreground" />
      default:
        return <Server className="h-4 w-4 text-muted-foreground" />
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        {mode === 'choose' ? (
          <>
            <DialogHeader>
              <DialogTitle>Get Started</DialogTitle>
              <DialogDescription>Open an existing repo or create a new one.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-4">
              <button
                type="button"
                disabled={isSubmitting}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-4 text-left transition-colors',
                  'hover:bg-muted/50'
                )}
                onClick={handleOpenRepo}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="font-medium">Open Repository</div>
                  <div className="text-xs text-muted-foreground">
                    Use an existing local git repo
                  </div>
                </div>
              </button>

              <button
                type="button"
                disabled={isSubmitting}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-4 text-left transition-colors',
                  'hover:bg-muted/50'
                )}
                onClick={() => setMode('create')}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                  <Plus className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="font-medium">Create Repository</div>
                  <div className="text-xs text-muted-foreground">
                    Initialize locally, optionally create a remote on GitHub/GitLab
                  </div>
                </div>
              </button>

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Create Repository</DialogTitle>
              <DialogDescription>
                Create a local repo, and optionally create a remote using GitHub CLI or GitLab CLI.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Repository name</label>
                <Input
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="my-repo"
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Local parent folder</label>
                <div className="flex gap-2">
                  <Input
                    value={localParentPath}
                    onChange={(e) => setLocalParentPath(e.target.value)}
                    placeholder="C:\\Users\\you\\Projects"
                    disabled={isSubmitting}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBrowse}
                    disabled={isSubmitting}
                  >
                    Browse
                  </Button>
                </div>
                {fullRepoPath && (
                  <div className="text-xs text-muted-foreground">Will create: {fullRepoPath}</div>
                )}
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Remote</label>
                <div className="grid gap-2">
                  {(['none', 'github', 'gitlab'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setRemoteProvider(p)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                        remoteProvider === p ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-full border',
                          remoteProvider === p
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground'
                        )}
                      >
                        {remoteProvider === p && <Check className="h-3 w-3" />}
                      </div>
                      {providerIcon(p)}
                      <div className="flex-1">
                        <div className="font-medium">
                          {p === 'none'
                            ? 'Local only'
                            : p === 'github'
                              ? 'GitHub (gh)'
                              : 'GitLab (glab)'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p === 'none'
                            ? 'Create a repo without a remote'
                            : p === 'github'
                              ? 'Create a GitHub repo using gh'
                              : 'Create a GitLab project using glab'}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {remoteProvider !== 'none' && (
                <div className="grid gap-3 rounded-lg border p-3">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Visibility</label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(['private', 'public'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setRemoteVisibility(v)}
                          className={cn(
                            'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                            remoteVisibility === v
                              ? 'border-primary bg-primary/5'
                              : 'hover:bg-muted/50'
                          )}
                        >
                          <span className="font-medium">
                            {v === 'private' ? 'Private' : 'Public'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Remote name</label>
                    <Input
                      value={remoteName}
                      onChange={(e) => setRemoteName(e.target.value)}
                      placeholder="origin"
                      disabled={isSubmitting}
                    />
                  </div>

                  {remoteProvider === 'github' && (
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Owner / org (optional)</label>
                      <Input
                        value={githubOwner}
                        onChange={(e) => setGithubOwner(e.target.value)}
                        placeholder="your-org"
                        disabled={isSubmitting}
                      />
                      <div className="text-xs text-muted-foreground">
                        Leave empty to create under your GitHub user.
                      </div>
                    </div>
                  )}

                  {remoteProvider === 'gitlab' && (
                    <div className="grid gap-3">
                      <div className="grid gap-2">
                        <label className="text-sm font-medium">GitLab host</label>
                        <Input
                          value={gitlabHost}
                          onChange={(e) => setGitlabHost(e.target.value)}
                          placeholder="gitlab.com"
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="grid gap-2">
                        <label className="text-sm font-medium">Group / namespace (optional)</label>
                        <Input
                          value={gitlabNamespace}
                          onChange={(e) => setGitlabNamespace(e.target.value)}
                          placeholder="my-group/subgroup"
                          disabled={isSubmitting}
                        />
                        <div className="text-xs text-muted-foreground">
                          Leave empty to create under your user namespace.
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <div className="text-sm">
                      <div className="font-medium">Push initial commit</div>
                      <div className="text-xs text-muted-foreground">
                        Pushes `main` after creation (requires a successful commit)
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant={pushToRemote ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPushToRemote((v) => !v)}
                      disabled={isSubmitting}
                    >
                      {pushToRemote ? 'On' : 'Off'}
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="text-sm">
                    <div className="font-medium">Add README</div>
                    <div className="text-xs text-muted-foreground">Creates `README.md`</div>
                  </div>
                  <Button
                    type="button"
                    variant={addReadme ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAddReadme((v) => !v)}
                    disabled={isSubmitting}
                  >
                    {addReadme ? 'On' : 'Off'}
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="text-sm">
                    <div className="font-medium">Initial commit</div>
                    <div className="text-xs text-muted-foreground">Commits current files</div>
                  </div>
                  <Button
                    type="button"
                    variant={initialCommit ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setInitialCommit((v) => !v)}
                    disabled={isSubmitting}
                  >
                    {initialCommit ? 'On' : 'Off'}
                  </Button>
                </div>
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMode('choose')}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button type="submit" disabled={isSubmitting || !canSubmit}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
