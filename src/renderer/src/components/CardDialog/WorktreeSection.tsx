import { GitBranch, GitCompareArrows, FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import type { Worktree } from '../../../../shared/types'

interface WorktreeSectionProps {
  worktree: Worktree
  loading: boolean
  onViewDiff: () => void
  onOpenFolder: () => void
  onRecreate: () => void
  onRemove: () => void
}

export function WorktreeSection({
  worktree,
  loading,
  onViewDiff,
  onOpenFolder,
  onRecreate,
  onRemove
}: WorktreeSectionProps): React.JSX.Element {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <GitBranch className="h-4 w-4" />
        Worktree
      </h3>
      <div className="space-y-3 rounded-md bg-muted p-4">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-mono">{worktree.branch_name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              worktree.status === 'error'
                ? 'destructive'
                : worktree.status === 'running'
                  ? 'default'
                  : worktree.status === 'cleanup_pending'
                    ? 'secondary'
                    : 'outline'
            }
          >
            {worktree.status}
          </Badge>
        </div>
        {worktree.last_error && (
          <p className="text-xs text-destructive bg-destructive/10 p-2 rounded">
            {worktree.last_error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onViewDiff}
            disabled={loading || worktree.status === 'cleaned'}
          >
            <GitCompareArrows className="h-3 w-3 mr-1" />
            View Diff
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenFolder}
            disabled={loading || worktree.status === 'cleaned'}
          >
            <FolderOpen className="h-3 w-3 mr-1" />
            Open Folder
          </Button>
          {worktree.status === 'error' && (
            <Button variant="outline" size="sm" onClick={onRecreate} disabled={loading}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Recreate
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRemove}
            disabled={loading || worktree.status === 'running'}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Remove
          </Button>
        </div>
      </div>
    </div>
  )
}
