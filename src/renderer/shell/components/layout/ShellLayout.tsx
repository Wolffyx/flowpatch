/**
 * Shell Layout Component
 *
 * Main layout wrapper that provides the shell structure with slots for:
 * - Title bar (header with tabs)
 * - Main content area
 * - Logs panel (optional, at bottom)
 * - Dialogs (portaled)
 */

import type { ReactNode } from 'react'

interface ShellLayoutProps {
  /** Title bar with tabs and toolbar */
  titleBar: ReactNode
  /** Main content area */
  children: ReactNode
  /** Optional logs panel at bottom */
  logsPanel?: ReactNode
}

export function ShellLayout({
  titleBar,
  children,
  logsPanel
}: ShellLayoutProps): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Title Bar with Tabs */}
      {titleBar}

      {/* Main Content Area */}
      <div className="flex-1 relative overflow-hidden">
        {children}
      </div>

      {/* Logs Panel - Fixed at bottom, above everything */}
      {logsPanel && (
        <div className="shrink-0 border-t bg-background z-20">
          {logsPanel}
        </div>
      )}
    </div>
  )
}
