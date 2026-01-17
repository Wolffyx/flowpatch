import { Play, TestTube, ExternalLink, Scissors, Info } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip } from '../ui/tooltip'
import type { Card, Worktree } from '../../../../shared/types'

interface QuickActionsBarProps {
  card: Card
  worktree: Worktree | null
  checkingTestInfo: boolean
  onRunWorker: () => void
  onOpenTestDialog: () => void
  onOpenRemote: () => void
  onSplitCard?: () => void
}

export function QuickActionsBar({
  card,
  worktree,
  checkingTestInfo,
  onRunWorker,
  onOpenTestDialog,
  onOpenRemote,
  onSplitCard
}: QuickActionsBarProps): React.JSX.Element {
  const showTestButton = worktree || card.status === 'in_progress' || card.status === 'ready'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {card.ready_eligible === 1 && card.provider !== 'local' && (
        <Button variant="default" size="sm" onClick={onRunWorker}>
          <Play className="h-3 w-3 mr-1" />
          Run Worker
        </Button>
      )}
      {showTestButton && (
        <Button variant="outline" size="sm" onClick={onOpenTestDialog} disabled={checkingTestInfo}>
          <TestTube className="h-3 w-3 mr-1" />
          Test
        </Button>
      )}
      {card.remote_url && (
        <Button variant="outline" size="sm" onClick={onOpenRemote}>
          <ExternalLink className="h-3 w-3 mr-1" />
          Open in {card.provider === 'github' ? 'GitHub' : 'GitLab'}
        </Button>
      )}
      {onSplitCard && (
        <Button variant="outline" size="sm" onClick={onSplitCard}>
          <Scissors className="h-3 w-3 mr-1" />
          Split
        </Button>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Info className="h-3 w-3" />
          </Button>
          <div className="text-xs space-y-1">
            <p>
              <kbd>E</kbd> Edit • <kbd>W</kbd> Worker • <kbd>T</kbd> Test
            </p>
            <p>
              <kbd>1-6</kbd> Status • <kbd>ESC</kbd> Close
            </p>
          </div>
        </Tooltip>
      </div>
    </div>
  )
}
