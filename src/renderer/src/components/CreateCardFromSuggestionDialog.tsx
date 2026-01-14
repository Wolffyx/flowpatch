import { useState, useCallback, useEffect } from 'react'
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
import { Badge } from './ui/badge'
import {
  Loader2,
  Check,
  FileText,
  Server,
  Sparkles,
  Lightbulb,
  Bug,
  Zap,
  Palette,
  HelpCircle,
  ThumbsUp
} from 'lucide-react'
import { cn } from '../lib/utils'
import { AIDescriptionDialog } from './AIDescriptionDialog'
import type {
  FeatureSuggestion,
  FeatureSuggestionCategory,
  Provider
} from '../../../shared/types'

export type CreateCardType = 'local' | 'repo_issue'

interface CreateCardFromSuggestionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  suggestion: FeatureSuggestion | null
  projectId: string
  hasRemote: boolean
  remoteProvider: Provider | null
  onCardCreated: () => void
}

const CATEGORY_ICONS: Record<FeatureSuggestionCategory, typeof Lightbulb> = {
  feature: Lightbulb,
  bug: Bug,
  performance: Zap,
  ui: Palette,
  documentation: FileText,
  other: HelpCircle
}

const CATEGORY_LABELS: Record<FeatureSuggestionCategory, string> = {
  feature: 'Feature',
  bug: 'Bug',
  performance: 'Performance',
  ui: 'UI/UX',
  documentation: 'Docs',
  other: 'Other'
}

export function CreateCardFromSuggestionDialog({
  open,
  onOpenChange,
  suggestion,
  projectId,
  hasRemote,
  remoteProvider,
  onCardCreated
}: CreateCardFromSuggestionDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [createType, setCreateType] = useState<CreateCardType>('local')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)

  // Initialize form when suggestion changes
  useEffect(() => {
    if (suggestion && open) {
      setTitle(suggestion.title)
      setBody(suggestion.description)
      setCreateType(
        hasRemote && (remoteProvider === 'github' || remoteProvider === 'gitlab')
          ? 'repo_issue'
          : 'local'
      )
      setError(null)
    }
  }, [suggestion, open, hasRemote, remoteProvider])

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
        await window.projectAPI.createCard({
          title: title.trim(),
          body: body.trim(),
          createType
        })
        // Reset form on success
        setTitle('')
        setBody('')
        onCardCreated()
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create card')
      } finally {
        setIsSubmitting(false)
      }
    },
    [title, body, createType, onCardCreated, onOpenChange]
  )

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!isSubmitting) {
        if (!newOpen) {
          // Reset form when closing
          setTitle('')
          setBody('')
          setError(null)
          setAiOpen(false)
        }
        onOpenChange(newOpen)
      }
    },
    [isSubmitting, onOpenChange]
  )

  const canCreateRepoIssue = hasRemote && (remoteProvider === 'github' || remoteProvider === 'gitlab')
  const aiButtonTitle = !title.trim()
    ? 'Add a title first'
    : !projectId
      ? 'Select a project first'
      : 'Improve description with AI'

  const CategoryIcon = suggestion ? CATEGORY_ICONS[suggestion.category] : HelpCircle

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Card from Suggestion</DialogTitle>
            <DialogDescription>
              Convert this feature suggestion into a Kanban card.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Suggestion Info */}
            {suggestion && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>From suggestion:</span>
                <Badge variant="secondary" className="text-xs flex items-center gap-1">
                  <CategoryIcon className="h-3 w-3" />
                  {CATEGORY_LABELS[suggestion.category]}
                </Badge>
                <span className={cn(
                  'flex items-center gap-1 text-xs',
                  suggestion.vote_count > 0
                    ? 'text-green-600 dark:text-green-400'
                    : suggestion.vote_count < 0
                      ? 'text-red-600 dark:text-red-400'
                      : ''
                )}>
                  <ThumbsUp className="h-3 w-3" />
                  {suggestion.vote_count}
                </span>
              </div>
            )}

            {/* Title */}
            <div className="grid gap-2">
              <label htmlFor="title" className="text-sm font-medium">
                Title *
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
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="body" className="text-sm font-medium">
                  Description
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAiOpen(true)}
                  disabled={isSubmitting || !projectId || !title.trim()}
                  title={aiButtonTitle}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Improve with AI
                </Button>
              </div>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Enter card description..."
                rows={5}
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
                    createType === 'local' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
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

                {/* Repo Issue Option */}
                <button
                  type="button"
                  onClick={() => canCreateRepoIssue && setCreateType('repo_issue')}
                  disabled={isSubmitting || !canCreateRepoIssue}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    createType === 'repo_issue'
                      ? 'border-primary bg-primary/5'
                      : canCreateRepoIssue
                        ? 'hover:bg-muted/50'
                        : 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border',
                      createType === 'repo_issue'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground'
                    )}
                  >
                    {createType === 'repo_issue' && <Check className="h-3 w-3" />}
                  </div>
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">Repo Issue</div>
                    <div className="text-xs text-muted-foreground">
                      {canCreateRepoIssue
                        ? remoteProvider === 'github'
                          ? 'Create an issue on GitHub and sync it to your Kanban'
                          : 'Create an issue on GitLab and sync it to your Kanban'
                        : hasRemote
                          ? 'Only GitHub/GitLab remotes support issue creation'
                          : 'Connect a remote to enable repo issue creation'}
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
              ) : createType === 'repo_issue' ? (
                <>
                  <Server className="mr-2 h-4 w-4" />
                  Create Repo Issue
                </>
              ) : (
                'Create Card'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <AIDescriptionDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        projectId={projectId}
        title={title.trim()}
        currentDescription={body}
        onApplyDescription={setBody}
      />
    </Dialog>
  )
}
