/**
 * Git Diff Dialog Component
 *
 * A dialog wrapper for the GitDiffViewer component.
 * Shows the diff for a worktree in a modal dialog.
 */

import { useState } from 'react'
import { GitCompareArrows, SplitSquareHorizontal, AlignJustify } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { GitDiffViewer } from './GitDiffViewer'
import { cn } from '../lib/utils'

interface GitDiffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  worktreeId: string
  branchName?: string
}

export function GitDiffDialog({
  open,
  onOpenChange,
  worktreeId,
  branchName
}: GitDiffDialogProps): React.JSX.Element {
  const [viewMode, setViewMode] = useState<'inline' | 'side-by-side'>('inline')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5" />
            <DialogTitle>
              {branchName ? `Changes on ${branchName}` : 'Git Diff'}
            </DialogTitle>
          </div>

          {/* View mode toggle */}
          <div className="flex items-center gap-1 border rounded-md p-1">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 px-2',
                viewMode === 'inline' && 'bg-muted'
              )}
              onClick={() => setViewMode('inline')}
              title="Inline view"
            >
              <AlignJustify className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 px-2',
                viewMode === 'side-by-side' && 'bg-muted'
              )}
              onClick={() => setViewMode('side-by-side')}
              title="Side-by-side view"
            >
              <SplitSquareHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          <GitDiffViewer
            worktreeId={worktreeId}
            viewMode={viewMode}
            className="h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
