/**
 * Worker Error History Dialog
 *
 * Displays recent worker errors with timestamps, card names, and error messages.
 * Allows clearing the error history.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from './ui/dialog'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Trash2, Clock } from 'lucide-react'
import type { WorkerError } from '@shared/types'

interface WorkerErrorHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  errors: WorkerError[]
  onClearHistory: () => void
}

export function WorkerErrorHistoryDialog({
  open,
  onOpenChange,
  errors,
  onClearHistory
}: WorkerErrorHistoryDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Worker Error History</DialogTitle>
          <DialogDescription>Recent worker errors (last 10)</DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[300px] pr-4">
          {errors.length === 0 ? (
            <p className="text-muted-foreground text-sm">No errors recorded</p>
          ) : (
            <div className="space-y-3">
              {errors.map((err, i) => (
                <div key={i} className="border rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <Clock className="h-3 w-3" />
                    {new Date(err.timestamp).toLocaleString()}
                    {err.phase && <span>• {err.phase}</span>}
                  </div>
                  {err.cardTitle && <div className="font-medium mb-1">{err.cardTitle}</div>}
                  <div className="text-destructive break-words">{err.error}</div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {errors.length > 0 && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={onClearHistory}>
              <Trash2 className="h-4 w-4 mr-2" />
              Clear History
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
