/**
 * Window Controls Component
 *
 * Windows-only minimize, maximize, and close buttons
 */

import { Minus, Square, X } from 'lucide-react'

export function WindowControls(): React.JSX.Element {
  return (
    <div className="flex items-center ml-2 border-l pl-2">
      <button
        onClick={() => window.shellAPI.minimizeWindow()}
        className="p-1.5 hover:bg-muted rounded transition-colors"
        title="Minimize"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        onClick={() => window.shellAPI.maximizeWindow()}
        className="p-1.5 hover:bg-muted rounded transition-colors"
        title="Maximize"
      >
        <Square className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => window.shellAPI.closeWindow()}
        className="p-1.5 hover:bg-destructive hover:text-destructive-foreground rounded transition-colors"
        title="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
