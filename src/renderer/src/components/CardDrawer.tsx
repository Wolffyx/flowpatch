import { useState, useEffect, useCallback } from 'react'
import {
  X,
  ExternalLink,
  Play,
  RefreshCw,
  Clock,
  AlertCircle,
  CheckCircle2,
  GitBranch,
  FolderOpen,
  Trash2,
  GitPullRequest,
  GitCompareArrows,
  MessageSquare,
  Pencil,
  Save,
  Scissors,
  TestTube
} from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { ScrollArea } from './ui/scroll-area'
import { GitDiffDialog } from './GitDiffDialog'
import { AgentChatDialog } from './AgentChatDialog'
import { DependencyManager } from './DependencyManager'
import { TestModificationsDialog } from './TestModificationsDialog'
import { cn } from '../lib/utils'
import { formatRelativeTime, parseLabels, parseAssignees } from '../lib/utils'
import {
  KANBAN_COLUMNS,
  type Card,
  type CardLink,
  type Event,
  type CardStatus,
  type Worktree,
  type Job
} from '../../../shared/types'

interface CardDrawerProps {
  card: Card | null
  linkedPRs?: CardLink[]
  events: Event[]
  projectId: string | null
  onClose: () => void
  onMoveCard: (cardId: string, status: CardStatus) => void
  onRunWorker: (cardId: string) => void
  onSplitCard?: (card: Card) => void
  onCardDeleted?: () => void
}

export function CardDrawer({
  card,
  linkedPRs,
  events,
  projectId,
  onClose,
  onMoveCard,
  onRunWorker,
  onSplitCard,
  onCardDeleted
}: CardDrawerProps): React.JSX.Element | null {
  const [worktree, setWorktree] = useState<Worktree | null>(null)
  const [worktreeLoading, setWorktreeLoading] = useState(false)
  const [diffDialogOpen, setDiffDialogOpen] = useState(false)
  const [chatDialogOpen, setChatDialogOpen] = useState(false)
  const [latestJob, setLatestJob] = useState<Job | null>(null)
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [editedDescription, setEditedDescription] = useState('')
  const [isSavingDescription, setIsSavingDescription] = useState(false)
  const [isDeletingCard, setIsDeletingCard] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testInfo, setTestInfo] = useState<{
    success: boolean
    hasWorktree?: boolean
    worktreePath?: string
    branchName?: string | null
    repoPath?: string
    projectType?: { type: string; hasPackageJson: boolean; port?: number }
    commands?: { install?: string; dev?: string; build?: string }
    error?: string
  } | null>(null)
  const [testModeEnabled, setTestModeEnabled] = useState(false)
  const [checkingTestInfo, setCheckingTestInfo] = useState(false)

  // Load worktree and latest job info for this card
  useEffect(() => {
    if (!card || !projectId) {
      setWorktree(null)
      setLatestJob(null)
      return
    }

    const loadData = async (): Promise<void> => {
      try {
        // Load worktrees
        const worktrees = (await window.electron.ipcRenderer.invoke(
          'listWorktrees',
          projectId
        )) as Worktree[]
        const cardWorktree = worktrees.find(
          (wt) => wt.card_id === card.id && wt.status !== 'cleaned'
        )
        setWorktree(cardWorktree ?? null)

        // Load latest job for this card
        const jobs = (await window.projectAPI.getJobs()) as Job[]
        const cardJobs = jobs.filter((j) => j.card_id === card.id)
        if (cardJobs.length > 0) {
          // Sort by created_at descending and get the most recent
          cardJobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          setLatestJob(cardJobs[0])
        } else {
          setLatestJob(null)
        }

        // Test mode will be checked when button is clicked
      } catch {
        setWorktree(null)
        setLatestJob(null)
      }
    }

    loadData()
  }, [card?.id, projectId])

  const handleOpenWorktreeFolder = async (): Promise<void> => {
    if (!worktree) return
    await window.electron.ipcRenderer.invoke('openWorktreeFolder', worktree.worktree_path)
  }

  const handleRemoveWorktree = async (): Promise<void> => {
    if (!worktree) return
    setWorktreeLoading(true)
    try {
      await window.electron.ipcRenderer.invoke('removeWorktree', worktree.id)
      setWorktree(null)
    } finally {
      setWorktreeLoading(false)
    }
  }

  const handleRecreateWorktree = async (): Promise<void> => {
    if (!worktree) return
    setWorktreeLoading(true)
    try {
      await window.electron.ipcRenderer.invoke('recreateWorktree', worktree.id)
      // Reload worktree info
      if (projectId) {
        const worktrees = (await window.electron.ipcRenderer.invoke(
          'listWorktrees',
          projectId
        )) as Worktree[]
        const cardWorktree = worktrees.find(
          (wt) => wt.card_id === card?.id && wt.status !== 'cleaned'
        )
        setWorktree(cardWorktree ?? null)
      }
    } finally {
      setWorktreeLoading(false)
    }
  }

  const handleOpenTestDialog = async (): Promise<void> => {
    if (!card || !projectId) return

    setCheckingTestInfo(true)
    try {
      const info = (await window.projectAPI.getCardTestInfo(projectId, card.id)) as typeof testInfo
      setTestInfo(info)
      if (info.success) {
        setTestDialogOpen(true)
      } else {
        // Show error - no branch/worktree found
        console.error('Failed to get test info:', info.error)
      }
    } catch (error) {
      console.error('Failed to load test info:', error)
    } finally {
      setCheckingTestInfo(false)
    }
  }

  // Check if test button should be shown - show if card has worktree or is in progress/ready
  const showTestButton = worktree || card.status === 'in_progress' || card.status === 'ready'

  // Reset edit state when card changes
  useEffect(() => {
    setIsEditingDescription(false)
    setEditedDescription(card?.body || '')
    setShowDeleteConfirm(false)
  }, [card?.id])

  const handleStartEditDescription = useCallback(() => {
    setEditedDescription(card?.body || '')
    setIsEditingDescription(true)
  }, [card?.body])

  const handleCancelEditDescription = useCallback(() => {
    setIsEditingDescription(false)
    setEditedDescription(card?.body || '')
  }, [card?.body])

  const handleSaveDescription = useCallback(async () => {
    if (!card) return
    setIsSavingDescription(true)
    try {
      const result = await window.projectAPI.editCardBody(card.id, editedDescription || null)
      if (result.error) {
        console.error('Failed to save description:', result.error)
      } else {
        setIsEditingDescription(false)
      }
    } catch (error) {
      console.error('Failed to save description:', error)
    } finally {
      setIsSavingDescription(false)
    }
  }, [card, editedDescription])

  const handleDeleteCard = useCallback(async () => {
    if (!card) return
    setIsDeletingCard(true)
    try {
      const result = await window.projectAPI.deleteCard(card.id)
      if (result.error) {
        console.error('Failed to delete card:', result.error)
      } else {
        setShowDeleteConfirm(false)
        onClose()
        onCardDeleted?.()
      }
    } catch (error) {
      console.error('Failed to delete card:', error)
    } finally {
      setIsDeletingCard(false)
    }
  }, [card, onClose, onCardDeleted])

  if (!card) return null

  const labels = parseLabels(card.labels_json)
  const assignees = parseAssignees(card.assignees_json)
  const cardEvents = events.filter((e) => e.card_id === card.id)

  const getEventIcon = (type: string): React.ReactNode => {
    switch (type) {
      case 'status_changed':
        return <RefreshCw className="h-3 w-3" />
      case 'worker_plan':
      case 'worker_run':
        return <Play className="h-3 w-3" />
      case 'pr_created':
        return <CheckCircle2 className="h-3 w-3 text-chart-2" />
      case 'error':
        return <AlertCircle className="h-3 w-3 text-destructive" />
      default:
        return <Clock className="h-3 w-3" />
    }
  }

  return (
    <div className="flex h-full w-80 max-w-full shrink-0 flex-col border-l bg-card min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="font-semibold truncate">Card Details</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 pr-6 space-y-6">
          {/* Title and number */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {card.remote_number_or_iid && (
                <span className="text-sm text-muted-foreground">#{card.remote_number_or_iid}</span>
              )}
              <Badge
                variant={
                  card.sync_state === 'error'
                    ? 'destructive'
                    : card.sync_state === 'pending'
                      ? 'secondary'
                      : 'default'
                }
              >
                {card.sync_state}
              </Badge>
            </div>
            <h3 className="text-lg font-medium">{card.title}</h3>
          </div>

          {/* Remote link */}
          {card.remote_url && (
            <div>
              <a
                href={card.remote_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                onClick={(e) => {
                  e.preventDefault()
                  window.electron.ipcRenderer.send('openExternal', card.remote_url)
                }}
              >
                <ExternalLink className="h-3 w-3" />
                Open in {card.provider === 'github' ? 'GitHub' : 'GitLab'}
              </a>
            </div>
          )}

          {/* Linked Pull Requests */}
          {linkedPRs && linkedPRs.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Linked Pull Requests</h4>
              <div className="space-y-2 rounded-md bg-muted p-3">
                {linkedPRs.map((link) => (
                  <button
                    key={link.id}
                    className="flex items-center gap-2 text-sm text-primary hover:underline w-full text-left"
                    onClick={(e) => {
                      e.preventDefault()
                      window.electron.ipcRenderer.send('openExternal', link.linked_url)
                    }}
                  >
                    <GitPullRequest className="h-4 w-4 text-chart-2" />
                    <span className="truncate">
                      {link.linked_type.toUpperCase()} #{link.linked_number_or_iid}
                    </span>
                    <ExternalLink className="h-3 w-3 ml-auto flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Body / Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Description</h4>
              {!isEditingDescription && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleStartEditDescription}
                  className="h-6 px-2"
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              )}
            </div>
            {isEditingDescription ? (
              <div className="space-y-2">
                <textarea
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  className="w-full min-h-[100px] text-sm rounded-md bg-muted p-3 border border-input focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  placeholder="Add a description..."
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveDescription}
                    disabled={isSavingDescription}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    {isSavingDescription ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEditDescription}
                    disabled={isSavingDescription}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : card.body ? (
              <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words overflow-x-hidden rounded-md bg-muted p-3">
                {card.body}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic rounded-md bg-muted p-3">
                No description provided. Click Edit to add one.
              </div>
            )}
          </div>

          {/* Actions */}
          {projectId && (
            <div>
              <h4 className="text-sm font-medium mb-2">Actions</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSplitCard?.(card)}
                disabled={!onSplitCard}
              >
                <Scissors className="h-3 w-3 mr-1" />
                Split with AI
              </Button>
            </div>
          )}

          {/* Dependencies */}
          <div className="rounded-md bg-muted p-3">
            <DependencyManager card={card} />
          </div>

          {/* Status controls */}
          <div>
            <h4 className="text-sm font-medium mb-2">Status</h4>
            <div className="flex flex-wrap gap-2">
              {KANBAN_COLUMNS.map((col) => (
                <Button
                  key={col.id}
                  variant={card.status === col.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onMoveCard(card.id, col.id)}
                >
                  <div className={cn('h-2 w-2 rounded-full mr-2', col.color)} />
                  {col.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Labels */}
          {labels.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Labels</h4>
              <div className="flex flex-wrap gap-1">
                {labels.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Assignees */}
          {assignees.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Assignees</h4>
              <div className="flex flex-wrap gap-1">
                {assignees.map((assignee) => (
                  <Badge key={assignee} variant="outline">
                    {assignee}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Worker controls */}
          {card.ready_eligible === 1 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Worker</h4>
              <Button
                variant="default"
                size="sm"
                onClick={() => onRunWorker(card.id)}
                disabled={card.provider === 'local'}
              >
                <Play className="h-4 w-4 mr-2" />
                Run Worker Now
              </Button>
            </div>
          )}

          {/* Test Modifications */}
          {showTestButton && (
            <div>
              <h4 className="text-sm font-medium mb-2">Test Modifications</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenTestDialog}
                disabled={checkingTestInfo}
              >
                <TestTube className="h-4 w-4 mr-2" />
                {checkingTestInfo ? 'Checking...' : 'Test Modifications'}
              </Button>
            </div>
          )}

          {/* Agent Chat - shown when there's a job for this card */}
          {latestJob && (
            <div>
              <h4 className="text-sm font-medium mb-2">Agent Chat</h4>
              <div className="space-y-2 rounded-md bg-muted p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge
                    variant={
                      latestJob.state === 'failed'
                        ? 'destructive'
                        : latestJob.state === 'running'
                          ? 'default'
                          : 'secondary'
                    }
                  >
                    {latestJob.state}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {formatRelativeTime(latestJob.created_at)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setChatDialogOpen(true)}
                  className="w-full"
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Open Chat
                </Button>
              </div>
            </div>
          )}

          {/* Worktree info */}
          {worktree && (
            <div>
              <h4 className="text-sm font-medium mb-2">Worktree</h4>
              <div className="space-y-2 rounded-md bg-muted p-3">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-mono truncate">{worktree.branch_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      worktree.status === 'error'
                        ? 'destructive'
                        : worktree.status === 'running'
                          ? 'default'
                          : worktree.status === 'cleanup_pending'
                            ? 'secondary'
                            : 'outline'
                    }
                  >
                    {worktree.status}
                  </Badge>
                </div>
                {worktree.last_error && (
                  <p className="text-xs text-destructive">{worktree.last_error}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDiffDialogOpen(true)}
                    disabled={worktreeLoading || worktree.status === 'cleaned'}
                  >
                    <GitCompareArrows className="h-3 w-3 mr-1" />
                    View Diff
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenWorktreeFolder}
                    disabled={worktreeLoading || worktree.status === 'cleaned'}
                  >
                    <FolderOpen className="h-3 w-3 mr-1" />
                    Open Folder
                  </Button>
                  {worktree.status === 'error' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRecreateWorktree}
                      disabled={worktreeLoading}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Recreate
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveWorktree}
                    disabled={worktreeLoading || worktree.status === 'running'}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Git Diff Dialog */}
          {worktree && (
            <GitDiffDialog
              open={diffDialogOpen}
              onOpenChange={setDiffDialogOpen}
              worktreeId={worktree.id}
              branchName={worktree.branch_name}
            />
          )}

          {/* Agent Chat Dialog */}
          {latestJob && card && (
            <AgentChatDialog
              open={chatDialogOpen}
              onOpenChange={setChatDialogOpen}
              jobId={latestJob.id}
              cardId={card.id}
              cardTitle={card.title}
            />
          )}


          {/* Timeline */}
          <div>
            <h4 className="text-sm font-medium mb-2">Timeline</h4>
            {cardEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet</p>
            ) : (
              <div className="space-y-2">
                {cardEvents.slice(0, 10).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-2 text-sm border-l-2 border-border pl-3 py-1"
                  >
                    {getEventIcon(event.type)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{event.type.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(event.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Local update: {formatRelativeTime(card.updated_local_at)}</p>
            {card.updated_remote_at && (
              <p>Remote update: {formatRelativeTime(card.updated_remote_at)}</p>
            )}
          </div>

          {/* Delete Card */}
          <div className="pt-4 border-t">
            {showDeleteConfirm ? (
              <div className="space-y-2">
                <p className="text-sm text-destructive font-medium">
                  Are you sure you want to delete this card?
                </p>
                <p className="text-xs text-muted-foreground">
                  This action cannot be undone. The card will be removed from your local database.
                  {card.remote_url && ' The remote issue/PR will not be affected.'}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteCard}
                    disabled={isDeletingCard}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    {isDeletingCard ? 'Deleting...' : 'Delete'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeletingCard}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Delete Card
              </Button>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Test Modifications Dialog */}
      {testInfo && (
        <TestModificationsDialog
          open={testDialogOpen}
          onOpenChange={setTestDialogOpen}
          projectId={projectId || ''}
          cardId={card.id}
          testInfo={testInfo}
        />
      )}
    </div>
  )
}
