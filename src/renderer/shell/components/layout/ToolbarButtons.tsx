/**
 * Toolbar Buttons Component
 *
 * Right-side toolbar with logs, activity, chat, history, and settings buttons
 */

import { Settings, Terminal, ListChecks, MessageSquare, History } from 'lucide-react'
import { Button } from '../../../src/components/ui/button'
import { Badge } from '../../../src/components/ui/badge'
import type { ActivityState } from '../../interfaces'

interface ToolbarButtonsProps {
  /** Current activity state */
  activity: ActivityState
  /** Whether logs panel is open */
  logsPanelOpen: boolean
  /** Whether activity dialog is open */
  activityOpen: boolean
  /** Whether chat dialog is open */
  chatOpen: boolean
  /** Whether history dialog is open */
  historyOpen: boolean
  /** Toggle logs panel */
  onToggleLogs: () => void
  /** Open activity dialog */
  onOpenActivity: () => void
  /** Open chat dialog */
  onOpenChat: () => void
  /** Open history dialog */
  onOpenHistory: () => void
  /** Open settings dialog */
  onOpenSettings: () => void
}

export function ToolbarButtons({
  activity,
  logsPanelOpen,
  activityOpen,
  chatOpen,
  historyOpen,
  onToggleLogs,
  onOpenActivity,
  onOpenChat,
  onOpenHistory,
  onOpenSettings
}: ToolbarButtonsProps): React.JSX.Element {
  return (
    <>
      {/* Busy indicator */}
      {activity.isBusy && (
        <Badge variant="secondary" className="text-xs mr-2">
          {activity.totalActiveRuns} running
        </Badge>
      )}

      {/* Logs toggle */}
      <Button
        variant={logsPanelOpen ? 'secondary' : 'ghost'}
        size="sm"
        className="h-7 px-2"
        onClick={onToggleLogs}
        title="Logs"
      >
        <Terminal className="h-4 w-4" />
      </Button>

      {/* Activity */}
      <Button
        variant={activityOpen ? 'secondary' : 'ghost'}
        size="sm"
        className="h-7 px-2"
        onClick={onOpenActivity}
        title="Activity"
      >
        <ListChecks className="h-4 w-4" />
      </Button>

      {/* Agent Chat */}
      <Button
        variant={chatOpen ? 'secondary' : 'ghost'}
        size="sm"
        className="h-7 px-2"
        onClick={onOpenChat}
        title="Agent Chat"
      >
        <MessageSquare className="h-4 w-4" />
      </Button>

      {/* Session History */}
      <Button
        variant={historyOpen ? 'secondary' : 'ghost'}
        size="sm"
        className="h-7 px-2"
        onClick={onOpenHistory}
        title="Session History"
      >
        <History className="h-4 w-4" />
      </Button>

      {/* Settings */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={onOpenSettings}
        title="Settings"
      >
        <Settings className="h-4 w-4" />
      </Button>
    </>
  )
}
