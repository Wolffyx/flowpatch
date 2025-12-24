/**
 * Shell Top Bar Component
 *
 * Displays:
 * - Current project name
 * - Busy indicator when jobs are running
 * - Settings button
 * - Logs panel toggle
 */

import { Settings, Terminal, Loader2 } from 'lucide-react'
import { Button } from '../../src/components/ui/button'
import { Badge } from '../../src/components/ui/badge'

interface ShellTopBarProps {
  projectName: string | null
  isBusy: boolean
  activeRuns: number
  onOpenSettings: () => void
  onToggleLogs: () => void
  logsOpen: boolean
}

export function ShellTopBar({
  projectName,
  isBusy,
  activeRuns,
  onOpenSettings,
  onToggleLogs,
  logsOpen
}: ShellTopBarProps): React.JSX.Element {
  return (
    <div className="flex h-12 items-center justify-between border-b px-4 bg-background">
      <div className="flex items-center gap-4">
        {projectName ? (
          <h2 className="font-semibold">{projectName}</h2>
        ) : (
          <span className="text-muted-foreground">No project open</span>
        )}

        {/* Busy Indicator */}
        {isBusy && (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{activeRuns} running</span>
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant={logsOpen ? 'secondary' : 'ghost'} size="sm" onClick={onToggleLogs}>
          <Terminal className="mr-2 h-4 w-4" />
          Logs
        </Button>

        <Button variant="ghost" size="sm" onClick={onOpenSettings}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </Button>
      </div>
    </div>
  )
}
