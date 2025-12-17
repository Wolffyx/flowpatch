import { Github, GitlabIcon, Server } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from './ui/dialog'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { RemoteInfo } from '../../../shared/types'

interface RemoteSelectorProps {
  open: boolean
  projectName: string
  remotes: RemoteInfo[]
  onSelect: (remoteName: string, remoteUrl: string, repoKey: string) => void
  onCancel: () => void
}

export function RemoteSelector({
  open,
  projectName,
  remotes,
  onSelect,
  onCancel
}: RemoteSelectorProps): React.JSX.Element {
  const getProviderIcon = (provider: string): React.ReactNode => {
    switch (provider) {
      case 'github':
        return <Github className="h-5 w-5" />
      case 'gitlab':
        return <GitlabIcon className="h-5 w-5" />
      default:
        return <Server className="h-5 w-5" />
    }
  }

  const formatRepoKey = (repoKey: string): string => {
    // Remove provider prefix for display
    return repoKey.replace(/^(github|gitlab):/, '')
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Remote</DialogTitle>
          <DialogDescription>
            Choose which remote to use for <strong>{projectName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4">
          {remotes.map((remote) => (
            <button
              key={remote.name}
              className={cn(
                'w-full flex items-center gap-3 rounded-lg border p-4 text-left transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
              )}
              onClick={() => onSelect(remote.name.split(':')[0], remote.url, remote.repoKey)}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                {getProviderIcon(remote.provider)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{remote.name.split(':')[0]}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {formatRepoKey(remote.repoKey)}
                </p>
              </div>
              <div className="text-xs text-muted-foreground capitalize">{remote.provider}</div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
