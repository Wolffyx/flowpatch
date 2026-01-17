/**
 * Title Bar Component
 *
 * The header with home button, tab bar, and toolbar controls
 */

import { Home } from 'lucide-react'
import { Button } from '../../../src/components/ui/button'
import { TabBar } from '../TabBar'
import { ToolbarButtons } from './ToolbarButtons'
import { WindowControls } from './WindowControls'
import type { TabDataWithStatus } from '../../hooks'
import type { ActivityState } from '../../interfaces'

interface TitleBarProps {
  /** Tabs with worker status */
  tabs: TabDataWithStatus[]
  /** Active tab ID */
  activeTabId: string | null
  /** Whether home view is visible */
  isHomeVisible: boolean
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
  /** Handle new tab / home button click */
  onNewTab: () => void
  /** Handle tab click */
  onTabClick: (tabId: string) => void
  /** Handle tab close */
  onTabClose: (tabId: string) => void
  /** Handle tab move */
  onTabMove: (tabId: string, newIndex: number) => void
  /** Handle close other tabs */
  onCloseOthers: (tabId: string) => void
  /** Handle close tabs to right */
  onCloseToRight: (tabId: string) => void
  /** Handle duplicate tab */
  onDuplicateTab: (tabId: string) => void
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

const isMacOS = /Mac|Macintosh|MacIntel|MacPPC/.test(navigator.userAgent)

export function TitleBar({
  tabs,
  activeTabId,
  isHomeVisible,
  activity,
  logsPanelOpen,
  activityOpen,
  chatOpen,
  historyOpen,
  onNewTab,
  onTabClick,
  onTabClose,
  onTabMove,
  onCloseOthers,
  onCloseToRight,
  onDuplicateTab,
  onToggleLogs,
  onOpenActivity,
  onOpenChat,
  onOpenHistory,
  onOpenSettings
}: TitleBarProps): React.JSX.Element {
  return (
    <div
      className="flex items-center bg-muted/50 border-b shrink-0 h-11"
      style={
        {
          WebkitAppRegion: 'drag',
          paddingLeft: isMacOS ? 72 : 0
        } as React.CSSProperties
      }
    >
      {/* Home button */}
      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Button
          variant={isHomeVisible ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 px-2 mx-2"
          onClick={onNewTab}
          title="Home"
        >
          <Home className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs strip - allow dragging on empty space */}
      <div className="flex-1">
        <TabBar
          tabs={tabs}
          activeTabId={isHomeVisible ? null : activeTabId}
          onTabClick={onTabClick}
          onTabClose={onTabClose}
          onNewTab={onNewTab}
          onTabMove={onTabMove}
          onCloseOthers={onCloseOthers}
          onCloseToRight={onCloseToRight}
          onDuplicateTab={onDuplicateTab}
        />
      </div>

      {/* Right side controls - not draggable */}
      <div
        className="flex items-center gap-1 px-2 h-9"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <ToolbarButtons
          activity={activity}
          logsPanelOpen={logsPanelOpen}
          activityOpen={activityOpen}
          chatOpen={chatOpen}
          historyOpen={historyOpen}
          onToggleLogs={onToggleLogs}
          onOpenActivity={onOpenActivity}
          onOpenChat={onOpenChat}
          onOpenHistory={onOpenHistory}
          onOpenSettings={onOpenSettings}
        />

        {/* Window Controls (Windows only) */}
        {!isMacOS && <WindowControls />}
      </div>
    </div>
  )
}
