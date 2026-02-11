import { Play, TestTube, ExternalLink, Scissors, Info, Upload } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip } from '../ui/tooltip'
import { TESTABLE_STATUSES, type Card, type Worktree } from '../../../../shared/types'

interface QuickActionsBarProps {
  card: Card
  worktree: Worktree | null
  checkingTestInfo: boolean
  hasRemote?: boolean
  remoteProvider?: string
  onRunWorker: () => void
  onOpenTestDialog: () => void
  onOpenRemote: () => void
  onSplitCard?: () => void
  onPushToRemote?: () => void
}

export function QuickActionsBar({
  card,
  worktree,
  checkingTestInfo,
  hasRemote,
  remoteProvider,
  onRunWorker,
  onOpenTestDialog,
  onOpenRemote,
  onSplitCard,
  onPushToRemote
}: QuickActionsBarProps): React.JSX.Element {
  const showTestButton = worktree || TESTABLE_STATUSES.includes(card.status)

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
      {card.provider === 'local' && hasRemote && onPushToRemote && (
        <Button variant="outline" size="sm" onClick={onPushToRemote}>
          <Upload className="h-3 w-3 mr-1" />
          Push to {remoteProvider === 'github' ? 'GitHub' : 'GitLab'}
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
