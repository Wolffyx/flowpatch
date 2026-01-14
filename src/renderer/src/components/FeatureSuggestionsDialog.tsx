import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'
import {
  ThumbsUp,
  ThumbsDown,
  Plus,
  Loader2,
  Lightbulb,
  Bug,
  Zap,
  FileText,
  Palette,
  HelpCircle,
  Trash2,
  Clock,
  Filter,
  SquarePlus
} from 'lucide-react'
import { CreateCardFromSuggestionDialog } from './CreateCardFromSuggestionDialog'
import type {
  FeatureSuggestion,
  FeatureSuggestionStatus,
  FeatureSuggestionCategory,
  Provider
} from '../../../shared/types'

interface FeatureSuggestionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  hasRemote: boolean
  remoteProvider: Provider | null
}

const CATEGORIES: { id: FeatureSuggestionCategory; label: string; icon: typeof Lightbulb }[] = [
  { id: 'feature', label: 'Feature', icon: Lightbulb },
  { id: 'bug', label: 'Bug', icon: Bug },
  { id: 'performance', label: 'Performance', icon: Zap },
  { id: 'ui', label: 'UI/UX', icon: Palette },
  { id: 'documentation', label: 'Docs', icon: FileText },
  { id: 'other', label: 'Other', icon: HelpCircle }
]

const STATUS_BADGES: Record<
  FeatureSuggestionStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  open: { label: 'Open', variant: 'secondary' },
  in_progress: { label: 'In Progress', variant: 'default' },
  completed: { label: 'Completed', variant: 'outline' },
  rejected: { label: 'Rejected', variant: 'destructive' }
}

export function FeatureSuggestionsDialog({
  open,
  onOpenChange,
  projectId,
  hasRemote,
  remoteProvider
}: FeatureSuggestionsDialogProps): React.JSX.Element {
  const [suggestions, setSuggestions] = useState<FeatureSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  // State for create card dialog
  const [createCardOpen, setCreateCardOpen] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState<FeatureSuggestion | null>(null)

  // Filter state
  const [statusFilter, setStatusFilter] = useState<FeatureSuggestionStatus | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<FeatureSuggestionCategory | 'all'>('all')

  // Form state
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formCategory, setFormCategory] = useState<FeatureSuggestionCategory>('feature')

  const loadSuggestions = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.projectAPI.getFeatureSuggestions({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        sortBy: 'vote_count',
        sortOrder: 'desc'
      })
      if (result.error) {
        toast.error('Failed to load suggestions', { description: result.error })
      } else {
        setSuggestions(result.suggestions)
      }
    } catch (err) {
      toast.error('Failed to load suggestions', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setLoading(false)
    }
  }, [statusFilter, categoryFilter])

  useEffect(() => {
    if (open) {
      loadSuggestions()
    }
  }, [open, loadSuggestions])

  const handleCreateSubmit = useCallback(async () => {
    if (!formTitle.trim()) {
      toast.error('Title is required')
      return
    }
    if (!formDescription.trim()) {
      toast.error('Description is required')
      return
    }

    setSaving(true)
    try {
      const result = await window.projectAPI.createFeatureSuggestion({
        title: formTitle.trim(),
        description: formDescription.trim(),
        category: formCategory
      })
      if (result.error) {
        toast.error('Failed to create suggestion', { description: result.error })
      } else {
        toast.success('Suggestion submitted')
        setFormTitle('')
        setFormDescription('')
        setFormCategory('feature')
        setIsCreating(false)
        loadSuggestions()
      }
    } catch (err) {
      toast.error('Failed to create suggestion', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSaving(false)
    }
  }, [formTitle, formDescription, formCategory, loadSuggestions])

  const handleVote = useCallback(
    async (suggestionId: string, voteType: 'up' | 'down') => {
      try {
        const result = await window.projectAPI.voteOnSuggestion(suggestionId, voteType)
        if (result.error) {
          toast.error('Failed to vote', { description: result.error })
        } else {
          setSuggestions((prev) =>
            prev.map((s) => (s.id === suggestionId ? { ...s, vote_count: result.voteCount } : s))
          )
        }
      } catch (err) {
        toast.error('Failed to vote', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    []
  )

  const handleDelete = useCallback(
    async (suggestionId: string) => {
      try {
        const result = await window.projectAPI.deleteFeatureSuggestion(suggestionId)
        if (result.error) {
          toast.error('Failed to delete suggestion', { description: result.error })
        } else {
          toast.success('Suggestion deleted')
          loadSuggestions()
        }
      } catch (err) {
        toast.error('Failed to delete suggestion', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [loadSuggestions]
  )

  const getCategoryIcon = (category: FeatureSuggestionCategory) => {
    const cat = CATEGORIES.find((c) => c.id === category)
    const Icon = cat?.icon ?? HelpCircle
    return <Icon className="h-3.5 w-3.5" />
  }

  const handleCreateCard = useCallback((suggestion: FeatureSuggestion) => {
    setSelectedSuggestion(suggestion)
    setCreateCardOpen(true)
  }, [])

  const handleCardCreated = useCallback(() => {
    setCreateCardOpen(false)
    setSelectedSuggestion(null)
    toast.success('Card created from suggestion')
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            Feature Suggestions
          </DialogTitle>
          <DialogDescription>
            Submit and vote on feature ideas for this project.
          </DialogDescription>
        </DialogHeader>

        {isCreating ? (
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Title *</label>
              <Input
                placeholder="Brief summary of your suggestion"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Description *</label>
              <textarea
                className="min-h-[100px] rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y"
                placeholder="Describe your suggestion in detail..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Category</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setFormCategory(cat.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors',
                        formCategory === cat.id
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-input hover:bg-muted'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {cat.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsCreating(false)
                  setFormTitle('')
                  setFormDescription('')
                  setFormCategory('feature')
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateSubmit} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Suggestion'
                )}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 py-2">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <select
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as FeatureSuggestionStatus | 'all')
                  }
                >
                  <option value="all">All Status</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="rejected">Rejected</option>
                </select>
                <select
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={categoryFilter}
                  onChange={(e) =>
                    setCategoryFilter(e.target.value as FeatureSuggestionCategory | 'all')
                  }
                >
                  <option value="all">All Categories</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button size="sm" onClick={() => setIsCreating(true)}>
                <Plus className="h-4 w-4 mr-1" />
                New Suggestion
              </Button>
            </div>

            <ScrollArea className="flex-1 min-h-[300px] max-h-[400px] pr-4">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Loading suggestions...
                </div>
              ) : suggestions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No suggestions yet.</p>
                  <p className="text-xs mt-1">Be the first to suggest a feature!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {suggestions.map((suggestion) => {
                    const statusBadge = STATUS_BADGES[suggestion.status]
                    return (
                      <div
                        key={suggestion.id}
                        className="rounded-lg border p-3 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleVote(suggestion.id, 'up')}
                              className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                              title="Upvote"
                            >
                              <ThumbsUp className="h-4 w-4" />
                            </button>
                            <span
                              className={cn(
                                'text-sm font-medium tabular-nums',
                                suggestion.vote_count > 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : suggestion.vote_count < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-muted-foreground'
                              )}
                            >
                              {suggestion.vote_count}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleVote(suggestion.id, 'down')}
                              className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                              title="Downvote"
                            >
                              <ThumbsDown className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{suggestion.title}</span>
                              <Badge variant={statusBadge.variant} className="text-xs">
                                {statusBadge.label}
                              </Badge>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                {getCategoryIcon(suggestion.category)}
                                {CATEGORIES.find((c) => c.id === suggestion.category)?.label}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {suggestion.description}
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(suggestion.created_at).toLocaleDateString()}
                              </span>
                              {suggestion.created_by && <span>by {suggestion.created_by}</span>}
                            </div>
                          </div>

                          <div className="flex flex-col gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleCreateCard(suggestion)}
                              className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                              title="Create card from this suggestion"
                            >
                              <SquarePlus className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(suggestion.id)}
                              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </>
        )}

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Create Card from Suggestion Dialog */}
      <CreateCardFromSuggestionDialog
        open={createCardOpen}
        onOpenChange={setCreateCardOpen}
        suggestion={selectedSuggestion}
        projectId={projectId}
        hasRemote={hasRemote}
        remoteProvider={remoteProvider}
        onCardCreated={handleCardCreated}
      />
    </Dialog>
  )
}
