import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { FileText, Github, Loader2, Check } from 'lucide-react'
import { cn } from '../lib/utils'
import type { Provider } from '../../../shared/types'

export type CreateCardType = 'local' | 'github_issue'

interface AddCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hasRemote: boolean
  remoteProvider: Provider | null
  onCreateCard: (data: {
    title: string
    body: string
    createType: CreateCardType
  }) => Promise<void>
}

export function AddCardDialog({
  open,
  onOpenChange,
  hasRemote,
  remoteProvider,
  onCreateCard
}: AddCardDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [createType, setCreateType] = useState<CreateCardType>('local')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!title.trim()) {
        setError('Title is required')
        return
      }

      setIsSubmitting(true)
      setError(null)

      try {
        await onCreateCard({
          title: title.trim(),
          body: body.trim(),
          createType
        })
        // Reset form on success
        setTitle('')
        setBody('')
        setCreateType('local')
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create card')
      } finally {
        setIsSubmitting(false)
      }
    },
    [title, body, createType, onCreateCard, onOpenChange]
  )

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!isSubmitting) {
        if (!newOpen) {
          // Reset form when closing
          setTitle('')
          setBody('')
          setCreateType('local')
          setError(null)
        }
        onOpenChange(newOpen)
      }
    },
    [isSubmitting, onOpenChange]
  )

  const canCreateRemote = hasRemote && remoteProvider === 'github'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add New Card</DialogTitle>
            <DialogDescription>
              Create a new card for your Kanban board. You can create a local draft or sync it with
              GitHub.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Title */}
            <div className="grid gap-2">
              <label htmlFor="title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter card title..."
                autoFocus
                disabled={isSubmitting}
              />
            </div>

            {/* Body */}
            <div className="grid gap-2">
              <label htmlFor="body" className="text-sm font-medium">
                Description (optional)
              </label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Enter card description..."
                rows={4}
                disabled={isSubmitting}
              />
            </div>

            {/* Card Type Selection */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Card Type</label>
              <div className="grid gap-2">
                {/* Local Draft Option */}
                <button
                  type="button"
                  onClick={() => setCreateType('local')}
                  disabled={isSubmitting}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    createType === 'local'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border',
                      createType === 'local'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground'
                    )}
                  >
                    {createType === 'local' && <Check className="h-3 w-3" />}
                  </div>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">Local Draft</div>
                    <div className="text-xs text-muted-foreground">
                      Create a local card that stays in your Kanban only
                    </div>
                  </div>
                </button>

                {/* GitHub Issue Option */}
                <button
                  type="button"
                  onClick={() => canCreateRemote && setCreateType('github_issue')}
                  disabled={isSubmitting || !canCreateRemote}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    createType === 'github_issue'
                      ? 'border-primary bg-primary/5'
                      : canCreateRemote
                        ? 'hover:bg-muted/50'
                        : 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border',
                      createType === 'github_issue'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground'
                    )}
                  >
                    {createType === 'github_issue' && <Check className="h-3 w-3" />}
                  </div>
                  <Github className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">GitHub Issue</div>
                    <div className="text-xs text-muted-foreground">
                      {canCreateRemote
                        ? 'Create an issue on GitHub and sync it to your Kanban'
                        : hasRemote
                          ? 'Only GitHub remotes support issue creation'
                          : 'Select a remote to enable GitHub issue creation'}
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !title.trim()}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : createType === 'github_issue' ? (
                <>
                  <Github className="mr-2 h-4 w-4" />
                  Create Issue
                </>
              ) : (
                'Create Card'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
