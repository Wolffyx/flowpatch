/**
 * Reset Confirmation Dialog
 *
 * Confirmation dialog for full app reset (dev only)
 */

import { useState, useCallback } from 'react'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../../src/components/ui/dialog'
import { Button } from '../../../src/components/ui/button'

interface ResetConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ResetConfirmDialog({ open, onOpenChange }: ResetConfirmDialogProps): React.JSX.Element {
  const [isResetting, setIsResetting] = useState(false)

  const handleReset = useCallback(async () => {
    setIsResetting(true)
    try {
      const result = await window.shellAPI.resetEverything()
      if (!result.success) {
        toast.error('Reset failed', {
          description: result.error || 'Unknown error'
        })
        setIsResetting(false)
      }
      // If successful, the app will restart so no need to update state
    } catch (err) {
      console.error('Failed to reset app:', err)
      toast.error('Failed to reset app', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
      setIsResetting(false)
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Reset Everything
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <p>
              This will completely reset FlowPatch to a fresh install state. All data will be
              permanently deleted:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
              <li>All projects and cards</li>
              <li>Settings and preferences</li>
              <li>API keys</li>
              <li>Logs and history</li>
            </ul>
            <p className="text-sm font-medium text-foreground">
              Your project files and repositories will NOT be affected.
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isResetting}
          >
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleReset} disabled={isResetting}>
            {isResetting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Resetting...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Reset Everything
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
