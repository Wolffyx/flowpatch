/**
 * CommentsSection
 *
 * Displays and manages comments/feedback for a card.
 * Users can add comments, set priority levels, mark as resolved,
 * and control which comments are included in the next AI run.
 */

import { useCallback, useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Textarea } from './ui/textarea'
import { ScrollArea } from './ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select'
import { cn, formatRelativeTime } from '../lib/utils'
import {
  MessageSquare,
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Send,
  Check,
  Undo2,
  Trash2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertOctagon,
  Pencil,
  X
} from 'lucide-react'
import type {
  CardComment,
  CommentPriority,
  CardStatus
} from '../../../shared/types'

interface CommentsSectionProps {
  cardId: string
  projectId: string
  cardStatus: CardStatus  // Reserved for future use (e.g., show different UI in review vs other states)
}

const PRIORITY_COLORS: Record<CommentPriority, string> = {
  critical: 'bg-red-500',
  important: 'bg-yellow-500',
  normal: 'bg-gray-500'
}

const PRIORITY_LABELS: Record<CommentPriority, string> = {
  critical: 'Critical',
  important: 'Important',
  normal: 'Normal'
}

const PRIORITY_ORDER: CommentPriority[] = ['critical', 'important', 'normal']

export function CommentsSection({
  cardId,
  projectId: _projectId,
  cardStatus: _cardStatus
}: CommentsSectionProps): React.JSX.Element {
  const [comments, setComments] = useState<CardComment[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCommentBody, setNewCommentBody] = useState('')
  const [newCommentPriority, setNewCommentPriority] = useState<CommentPriority>('normal')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  // Debounce ref for toggle inclusion
  const toggleDebounceRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Sort comments helper
  const sortComments = useCallback((commentsToSort: CardComment[]) => {
    return [...commentsToSort].sort((a, b) => {
      const priorityDiff =
        PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
      if (priorityDiff !== 0) return priorityDiff
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [])

  const loadComments = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.projectAPI.getCardComments(cardId)
      if (result.error) {
        toast.error('Failed to load comments', { description: result.error })
      } else {
        setComments(sortComments(result.comments))
      }
    } catch (err) {
      toast.error('Failed to load comments', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setLoading(false)
    }
  }, [cardId, sortComments])

  useEffect(() => {
    loadComments()
  }, [loadComments])

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      toggleDebounceRef.current.forEach((timer) => clearTimeout(timer))
    }
  }, [])

  const handleAddComment = async () => {
    if (!newCommentBody.trim()) return

    const body = newCommentBody.trim()
    const priority = newCommentPriority

    // Optimistic UI: add comment immediately
    const optimisticComment: CardComment = {
      id: `temp-${Date.now()}`,
      card_id: cardId,
      project_id: '',
      remote_comment_id: null,
      author: null,
      body,
      source: 'user',
      sync_state: 'pending_push',
      priority,
      resolution: 'open',
      resolved_at: null,
      resolved_by_job_id: null,
      include_in_next_run: true,
      processed_for_job_id: null,
      processed_at: null,
      created_at: new Date().toISOString(),
      remote_created_at: null,
      updated_at: new Date().toISOString()
    }

    setComments((prev) => sortComments([optimisticComment, ...prev]))
    setNewCommentBody('')
    setNewCommentPriority('normal')
    setShowAddForm(false)
    setSaving(true)

    try {
      const result = await window.projectAPI.createCardComment({
        cardId,
        body,
        priority
      })
      if (result.error) {
        // Rollback: remove optimistic comment
        setComments((prev) => prev.filter((c) => c.id !== optimisticComment.id))
        setShowAddForm(true)
        setNewCommentBody(body)
        setNewCommentPriority(priority)
        toast.error('Failed to add comment', { description: result.error })
      } else {
        // Replace optimistic with real comment
        setComments((prev) =>
          sortComments(prev.map((c) => (c.id === optimisticComment.id ? result.comment : c)))
        )
        toast.success('Comment added')
      }
    } catch (err) {
      // Rollback
      setComments((prev) => prev.filter((c) => c.id !== optimisticComment.id))
      setShowAddForm(true)
      setNewCommentBody(body)
      setNewCommentPriority(priority)
      toast.error('Failed to add comment', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleUpdatePriority = async (commentId: string, priority: CommentPriority) => {
    // Optimistic update
    setComments((prev) =>
      sortComments(prev.map((c) => (c.id === commentId ? { ...c, priority } : c)))
    )

    try {
      const result = await window.projectAPI.updateCommentPriority(commentId, priority)
      if (result.error) {
        loadComments() // Rollback by reloading
        toast.error('Failed to update priority', { description: result.error })
      }
    } catch (err) {
      loadComments()
      toast.error('Failed to update priority')
    }
  }

  const handleResolveComment = async (commentId: string) => {
    setActionInProgress(commentId)
    // Optimistic update
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? { ...c, resolution: 'resolved' as const, resolved_at: new Date().toISOString() }
          : c
      )
    )

    try {
      const result = await window.projectAPI.resolveComment(commentId)
      if (result.error) {
        loadComments()
        toast.error('Failed to resolve comment', { description: result.error })
      } else {
        toast.success('Comment resolved')
      }
    } catch (err) {
      loadComments()
      toast.error('Failed to resolve comment')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleReopenComment = async (commentId: string) => {
    setActionInProgress(commentId)
    // Optimistic update
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId ? { ...c, resolution: 'open' as const, resolved_at: null } : c
      )
    )

    try {
      const result = await window.projectAPI.reopenComment(commentId)
      if (result.error) {
        loadComments()
        toast.error('Failed to reopen comment', { description: result.error })
      }
    } catch (err) {
      loadComments()
      toast.error('Failed to reopen comment')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleToggleInclusion = async (commentId: string, include: boolean) => {
    // Optimistic update immediately
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, include_in_next_run: include } : c))
    )

    // Clear existing debounce for this comment
    const existingTimer = toggleDebounceRef.current.get(commentId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Debounce the API call
    const timer = setTimeout(async () => {
      toggleDebounceRef.current.delete(commentId)
      try {
        const result = await window.projectAPI.toggleCommentInclusion(commentId, include)
        if (result.error) {
          loadComments() // Rollback
          toast.error('Failed to update comment', { description: result.error })
        }
      } catch (err) {
        loadComments()
        toast.error('Failed to update comment')
      }
    }, 300)

    toggleDebounceRef.current.set(commentId, timer)
  }

  const handleDeleteComment = async (commentId: string) => {
    setActionInProgress(commentId)
    // Optimistic update
    const deletedComment = comments.find((c) => c.id === commentId)
    setComments((prev) => prev.filter((c) => c.id !== commentId))

    try {
      const result = await window.projectAPI.deleteCardComment(commentId)
      if (result.error) {
        // Rollback
        if (deletedComment) {
          setComments((prev) => sortComments([...prev, deletedComment]))
        }
        toast.error('Failed to delete comment', { description: result.error })
      } else {
        toast.success('Comment deleted')
      }
    } catch (err) {
      if (deletedComment) {
        setComments((prev) => sortComments([...prev, deletedComment]))
      }
      toast.error('Failed to delete comment')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleSelectAll = async () => {
    const toSelect = comments.filter(
      (c) => c.resolution === 'open' && c.source === 'user' && !c.include_in_next_run
    )
    if (toSelect.length === 0) return

    setBatchProcessing(true)
    // Optimistic update all at once
    setComments((prev) =>
      prev.map((c) =>
        toSelect.some((s) => s.id === c.id) ? { ...c, include_in_next_run: true } : c
      )
    )

    try {
      await Promise.all(
        toSelect.map((c) => window.projectAPI.toggleCommentInclusion(c.id, true))
      )
    } catch (err) {
      loadComments() // Rollback on any error
      toast.error('Failed to select all comments')
    } finally {
      setBatchProcessing(false)
    }
  }

  const handleDeselectAll = async () => {
    const toDeselect = comments.filter((c) => c.include_in_next_run && c.source === 'user')
    if (toDeselect.length === 0) return

    setBatchProcessing(true)
    // Optimistic update all at once
    setComments((prev) =>
      prev.map((c) =>
        toDeselect.some((d) => d.id === c.id) ? { ...c, include_in_next_run: false } : c
      )
    )

    try {
      await Promise.all(
        toDeselect.map((c) => window.projectAPI.toggleCommentInclusion(c.id, false))
      )
    } catch (err) {
      loadComments() // Rollback on any error
      toast.error('Failed to deselect all comments')
    } finally {
      setBatchProcessing(false)
    }
  }

  const handleDeduplicateComments = async () => {
    setBatchProcessing(true)
    try {
      const result = await window.projectAPI.deduplicateCardComments(cardId)
      if (result.deleted > 0) {
        toast.success(`Removed ${result.deleted} duplicate comment${result.deleted > 1 ? 's' : ''}`)
        loadComments()
      } else {
        toast.info('No duplicate comments found')
      }
    } catch (err) {
      toast.error('Failed to deduplicate comments')
    } finally {
      setBatchProcessing(false)
    }
  }

  const handleEditComment = async (commentId: string, newBody: string) => {
    const originalComment = comments.find((c) => c.id === commentId)
    if (!originalComment) return

    // Optimistic update
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, body: newBody } : c))
    )

    try {
      const result = await window.projectAPI.editCardComment(commentId, newBody)
      if (result.error) {
        // Rollback
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? originalComment : c))
        )
        toast.error('Failed to edit comment', { description: result.error })
      } else {
        toast.success('Comment updated')
      }
    } catch (err) {
      // Rollback
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? originalComment : c))
      )
      toast.error('Failed to edit comment')
    }
  }

  const openComments = comments.filter((c) => c.resolution === 'open')
  const resolvedComments = comments.filter((c) => c.resolution !== 'open')
  const includedCount = comments.filter((c) => c.include_in_next_run && c.resolution === 'open' && c.source === 'user').length

  // Detect potential duplicates (same body, normalized)
  const hasPotentialDuplicates = (() => {
    const seen = new Set<string>()
    for (const c of comments) {
      const key = c.body.trim().replace(/\s+/g, ' ').toLowerCase()
      if (seen.has(key)) return true
      seen.add(key)
    }
    return false
  })()

  const getPriorityIcon = (priority: CommentPriority): React.ReactNode => {
    switch (priority) {
      case 'critical':
        return <AlertCircle className="h-3 w-3 text-red-500" />
      case 'important':
        return <AlertTriangle className="h-3 w-3 text-yellow-500" />
      default:
        return <MessageSquare className="h-3 w-3 text-muted-foreground" />
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground/80"
        >
          <MessageSquare className="h-4 w-4" />
          Comments
          {comments.length > 0 && (
            <Badge variant="secondary" className="text-xs h-5 px-1.5">
              {comments.length}
            </Badge>
          )}
          {expanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
        {expanded && (
          <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)}>
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        )}
      </div>

      {expanded && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading...
            </div>
          ) : (
            <div className="space-y-3">
              {/* Add comment form */}
              {showAddForm && (
                <div className="space-y-2 rounded-md border p-3 bg-muted/50">
                  <Textarea
                    value={newCommentBody}
                    onChange={(e) => setNewCommentBody(e.target.value)}
                    placeholder="Add feedback for the AI worker..."
                    className="min-h-[80px] resize-y"
                    autoFocus
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Priority:</span>
                      <Select
                        value={newCommentPriority}
                        onValueChange={(v) => setNewCommentPriority(v as CommentPriority)}
                      >
                        <SelectTrigger size="sm" className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="critical">
                            <span className="flex items-center gap-2">
                              <AlertCircle className="h-3 w-3 text-red-500" />
                              Critical
                            </span>
                          </SelectItem>
                          <SelectItem value="important">
                            <span className="flex items-center gap-2">
                              <AlertTriangle className="h-3 w-3 text-yellow-500" />
                              Important
                            </span>
                          </SelectItem>
                          <SelectItem value="normal">
                            <span className="flex items-center gap-2">
                              <MessageSquare className="h-3 w-3 text-muted-foreground" />
                              Normal
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowAddForm(false)
                          setNewCommentBody('')
                          setNewCommentPriority('normal')
                        }}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleAddComment}
                        disabled={!newCommentBody.trim() || saving}
                      >
                        {saving ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3 mr-1" />
                        )}
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Duplicate warning and cleanup */}
              {hasPotentialDuplicates && (
                <div className="flex items-center gap-2 text-xs text-yellow-600 bg-yellow-500/10 rounded-md px-2 py-1.5">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Duplicate comments detected</span>
                  <button
                    onClick={handleDeduplicateComments}
                    disabled={batchProcessing}
                    className={cn(
                      'ml-1 hover:text-yellow-700 underline font-medium',
                      batchProcessing && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {batchProcessing ? 'Cleaning...' : 'Clean up'}
                  </button>
                </div>
              )}

              {/* Bulk actions */}
              {openComments.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {includedCount} of {openComments.filter((c) => c.source === 'user').length} included
                  </span>
                  <span className="text-muted-foreground/50">|</span>
                  <button
                    onClick={handleSelectAll}
                    disabled={batchProcessing}
                    className={cn(
                      'hover:text-foreground underline',
                      batchProcessing && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {batchProcessing ? 'Processing...' : 'Select all open'}
                  </button>
                  <button
                    onClick={handleDeselectAll}
                    disabled={batchProcessing}
                    className={cn(
                      'hover:text-foreground underline',
                      batchProcessing && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    Deselect all
                  </button>
                </div>
              )}

              {/* Open comments */}
              {openComments.length > 0 ? (
                <ScrollArea className="max-h-[300px]">
                  <div className="space-y-2 pr-2">
                    {openComments.map((comment) => (
                      <CommentItem
                        key={comment.id}
                        comment={comment}
                        onUpdatePriority={handleUpdatePriority}
                        onResolve={handleResolveComment}
                        onReopen={handleReopenComment}
                        onToggleInclusion={handleToggleInclusion}
                        onDelete={handleDeleteComment}
                        onEdit={handleEditComment}
                        getPriorityIcon={getPriorityIcon}
                        isActionInProgress={actionInProgress === comment.id}
                      />
                    ))}
                  </div>
                </ScrollArea>
              ) : !showAddForm ? (
                <div className="text-sm text-muted-foreground text-center py-3 rounded-md bg-muted/50">
                  No comments yet. Add feedback for the AI worker.
                </div>
              ) : null}

              {/* Resolved comments (collapsed by default) */}
              {resolvedComments.length > 0 && (
                <ResolvedCommentsSection
                  comments={resolvedComments}
                  onReopen={handleReopenComment}
                  onDelete={handleDeleteComment}
                  getPriorityIcon={getPriorityIcon}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface CommentItemProps {
  comment: CardComment
  onUpdatePriority: (id: string, priority: CommentPriority) => void
  onResolve: (id: string) => void
  onReopen: (id: string) => void
  onToggleInclusion: (id: string, include: boolean) => void
  onDelete: (id: string) => void
  onEdit: (id: string, body: string) => void
  getPriorityIcon: (priority: CommentPriority) => React.ReactNode
  isActionInProgress?: boolean
}

function CommentItem({
  comment,
  onUpdatePriority,
  onResolve,
  onReopen,
  onToggleInclusion,
  onDelete,
  onEdit,
  getPriorityIcon,
  isActionInProgress = false
}: CommentItemProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)

  const isResolved = comment.resolution !== 'open'
  const isUserComment = comment.source === 'user'
  const isSyncing = comment.sync_state === 'pending_push'
  const hasSyncError = comment.sync_state === 'error'

  const handleSaveEdit = () => {
    if (editBody.trim() && editBody !== comment.body) {
      onEdit(comment.id, editBody.trim())
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditBody(comment.body)
    setIsEditing(false)
  }

  return (
    <div
      className={cn(
        'p-3 rounded-md border',
        isResolved && 'opacity-60',
        comment.priority === 'critical' && !isResolved && 'border-red-500/30 bg-red-500/5',
        comment.priority === 'important' && !isResolved && 'border-yellow-500/30 bg-yellow-500/5',
        comment.priority === 'normal' && !isResolved && 'border-border bg-muted/30'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {getPriorityIcon(comment.priority)}
          <span className="text-xs font-medium">
            {comment.author || 'You'}
          </span>
          <Badge
            variant="outline"
            className={cn(
              'text-xs h-4 px-1',
              PRIORITY_COLORS[comment.priority],
              'text-white'
            )}
          >
            {PRIORITY_LABELS[comment.priority]}
          </Badge>
          {comment.source !== 'user' && (
            <Badge variant="secondary" className="text-xs h-4 px-1">
              {comment.source === 'ai_worker' ? 'AI' : 'System'}
            </Badge>
          )}
          {/* Sync status indicators */}
          {isSyncing && (
            <Badge variant="outline" className="text-xs h-4 px-1 text-blue-500 border-blue-500/30">
              <RefreshCw className="h-2.5 w-2.5 mr-1 animate-spin" />
              Syncing
            </Badge>
          )}
          {hasSyncError && (
            <Badge variant="outline" className="text-xs h-4 px-1 text-destructive border-destructive/30">
              <AlertOctagon className="h-2.5 w-2.5 mr-1" />
              Sync error
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(comment.remote_created_at || comment.created_at)}
        </span>
      </div>

      {/* Body */}
      {isEditing ? (
        <div className="space-y-2">
          <Textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="min-h-[60px] resize-y text-sm"
            autoFocus
          />
          <div className="flex justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-destructive hover:text-destructive"
              onClick={() => {
                setIsEditing(false)
                onDelete(comment.id)
              }}
              title="Delete comment"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2"
                onClick={handleCancelEdit}
              >
                <X className="h-3 w-3 mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-6 px-2"
                onClick={handleSaveEdit}
                disabled={!editBody.trim()}
              >
                <Check className="h-3 w-3 mr-1" />
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p
          className={cn(
            'text-sm whitespace-pre-wrap break-words',
            isResolved && 'line-through'
          )}
        >
          {comment.body}
        </p>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
        <div className="flex items-center gap-2">
          {/* Include in next run toggle (only for user comments) */}
          {isUserComment && !isResolved && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={comment.include_in_next_run}
                onChange={(e) => onToggleInclusion(comment.id, e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input"
              />
              <span className="text-xs text-muted-foreground">Include in AI run</span>
            </label>
          )}
          {comment.processed_at && (
            <span className="text-xs text-muted-foreground">
              Processed {formatRelativeTime(comment.processed_at)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Priority selector (only for user comments) */}
          {isUserComment && !isResolved && !isEditing && (
            <Select
              value={comment.priority}
              onValueChange={(v) => onUpdatePriority(comment.id, v as CommentPriority)}
              disabled={isActionInProgress}
            >
              <SelectTrigger size="sm" className="h-6 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="important">Important</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
              </SelectContent>
            </Select>
          )}
          {/* Edit button (only for user comments that aren't resolved) */}
          {isUserComment && !isResolved && !isEditing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setIsEditing(true)}
              disabled={isActionInProgress}
              title="Edit"
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
          {/* Resolve/Reopen button */}
          {isUserComment && !isEditing && (
            isResolved ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => onReopen(comment.id)}
                disabled={isActionInProgress}
                title="Reopen"
              >
                {isActionInProgress ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Undo2 className="h-3 w-3 mr-1" />
                )}
                Reopen
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => onResolve(comment.id)}
                disabled={isActionInProgress}
                title="Mark as resolved"
              >
                {isActionInProgress ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Check className="h-3 w-3 mr-1" />
                )}
                Resolve
              </Button>
            )
          )}
          {/* Delete button (only for local comments without remote) */}
          {!comment.remote_comment_id && !isEditing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              onClick={() => onDelete(comment.id)}
              disabled={isActionInProgress}
              title="Delete"
            >
              {isActionInProgress ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

interface ResolvedCommentsSectionProps {
  comments: CardComment[]
  onReopen: (id: string) => void
  onDelete: (id: string) => void
  getPriorityIcon: (priority: CommentPriority) => React.ReactNode
}

function ResolvedCommentsSection({
  comments,
  onReopen,
  onDelete,
  getPriorityIcon
}: ResolvedCommentsSectionProps): React.JSX.Element {
  // Auto-expand when there are resolved comments (better UX)
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="pt-2 border-t">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <CheckCircle2 className="h-3 w-3" />
        {comments.length} resolved
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>
      {expanded && (
        <div className="space-y-2 mt-2">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="p-2 rounded-md bg-muted/30 opacity-60"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  {getPriorityIcon(comment.priority)}
                  <span className="text-xs">{comment.author || 'You'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-xs"
                    onClick={() => onReopen(comment.id)}
                  >
                    <Undo2 className="h-2.5 w-2.5 mr-1" />
                    Reopen
                  </Button>
                  {!comment.remote_comment_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                      onClick={() => onDelete(comment.id)}
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-through">
                {comment.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
