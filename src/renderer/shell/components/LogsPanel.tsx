/**
 * Logs Panel Component
 *
 * Collapsible panel at the bottom of the shell that displays:
 * - Real-time log entries from workers and sync
 * - Log filtering and search
 * - Export and clear actions
 */

import { useRef, useEffect } from 'react'
import { X, Download, Trash2 } from 'lucide-react'
import { Button } from '../../src/components/ui/button'
import { cn } from '../../src/lib/utils'

interface LogEntry {
  id: string
  ts: string
  projectKey: string
  source: string
  stream: 'stdout' | 'stderr' | 'info' | 'error' | 'warn'
  line: string
}

interface LogsPanelProps {
  logs: LogEntry[]
  onClose: () => void
  onExport: () => void
  onClear: () => void
}

export function LogsPanel({ logs, onClose, onExport, onClear }: LogsPanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const target = e.currentTarget
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50
    autoScrollRef.current = isAtBottom
  }

  const getStreamColor = (stream: LogEntry['stream']): string => {
    switch (stream) {
      case 'stderr':
      case 'error':
        return 'text-red-500'
      case 'warn':
        return 'text-yellow-500'
      case 'info':
        return 'text-blue-500'
      default:
        return 'text-foreground'
    }
  }

  const formatTimestamp = (ts: string): string => {
    const date = new Date(ts)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  return (
    <div className="h-48 border-t bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <span className="text-sm font-medium">Logs ({logs.length})</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onExport}>
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear}>
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Log Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto font-mono text-xs p-2"
        onScroll={handleScroll}
      >
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No logs yet
          </div>
        ) : (
          <div className="space-y-0.5">
            {logs.map((entry) => (
              <div key={entry.id} className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{formatTimestamp(entry.ts)}</span>
                <span className="text-muted-foreground shrink-0">[{entry.source}]</span>
                <span className={cn('break-all', getStreamColor(entry.stream))}>{entry.line}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
