/**
 * Unlink Confirmation Dialog
 *
 * Secondary dialog for confirming project unlink
 */

import { useState, useCallback } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
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
import { useSettingsContext } from './hooks/useSettingsContext'

export function UnlinkConfirmDialog(): React.JSX.Element {
  const { project, showUnlinkConfirm, setShowUnlinkConfirm, onClose } = useSettingsContext()
  const [isUnlinking, setIsUnlinking] = useState(false)

  const handleUnlink = useCallback(async () => {
    if (!project) return
    setIsUnlinking(true)
    try {
      await window.electron.ipcRenderer.invoke('unlinkProject', { projectId: project.id })
      toast.success('Project unlinked', {
        description: `"${project.name}" has been removed from Patchwork`
      })
      setShowUnlinkConfirm(false)
      onClose()
    } catch (err) {
      console.error('Failed to unlink project:', err)
      toast.error('Failed to unlink project', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setIsUnlinking(false)
    }
  }, [project, setShowUnlinkConfirm, onClose])

  return (
    <Dialog open={showUnlinkConfirm} onOpenChange={setShowUnlinkConfirm}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Unlink Project
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to unlink &quot;{project?.name}&quot;? This will remove the
            project from Patchwork but will not delete your files.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowUnlinkConfirm(false)}
            disabled={isUnlinking}
          >
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleUnlink} disabled={isUnlinking}>
            {isUnlinking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Unlinking...
              </>
            ) : (
              'Unlink'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
