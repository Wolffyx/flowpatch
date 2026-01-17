import { useMemo } from 'react'
import { MessageSquare, GitPullRequest, ExternalLink, Clock, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { ScrollArea } from '../ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { cn } from '../../lib/utils'
import { formatRelativeTime, parseLabels, parseAssignees } from '../../lib/utils'
import { GitDiffDialog } from '../GitDiffDialog'
import { AgentChatDialog } from '../AgentChatDialog'
import { DependencyManager } from '../DependencyManager'
import { TestModificationsDialog } from '../TestModificationsDialog'
import { CardMetadataHeader } from './CardMetadataHeader'
import { QuickActionsBar } from './QuickActionsBar'
import { DescriptionEditor } from './DescriptionEditor'
import { TimelineSection } from './TimelineSection'
import { WorktreeSection } from './WorktreeSection'
import { useCardDialogState } from './useCardDialogState'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { KANBAN_COLUMNS, type Card, type CardLink, type Event, type CardStatus } from '../../../../shared/types'

interface CardDialogProps {
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

export function CardDialog({
  card,
  linkedPRs,
  events,
  projectId,
  onClose,
  onMoveCard,
  onRunWorker,
  onSplitCard,
  onCardDeleted
}: CardDialogProps): React.JSX.Element | null {
  const state = useCardDialogState(card, projectId)

  // Derived data - must be before early return to follow Rules of Hooks
  const labels = useMemo(() => (card ? parseLabels(card.labels_json) : []), [card])
  const assignees = useMemo(() => (card ? parseAssignees(card.assignees_json) : []), [card])
  const cardEvents = useMemo(() => (card ? events.filter((e) => e.card_id === card.id) : []), [events, card])

  const showTestButton = !!state.worktree || card?.status === 'in_progress' || card?.status === 'ready'

  // Keyboard shortcuts
  useKeyboardShortcuts({
    card,
    isEditingDescription: state.isEditingDescription,
    showTestButton,
    onStartEdit: () => state.setIsEditingDescription(true),
    onSaveDescription: () => state.handleSaveDescription(card?.body || ''),
    onCancelEdit: () => state.setIsEditingDescription(false),
    onRunWorker,
    onOpenTestDialog: state.handleOpenTestDialog,
    onMoveCard
  })

  if (!card) return null

  return (
    <Dialog open={!!card} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-[900px] h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">{card.title}</DialogTitle>
        {/* Header */}
        <div className="border-b px-6 py-4 space-y-3">
          <CardMetadataHeader
            card={card}
            worktree={state.worktree}
            latestJob={state.latestJob}
            onClose={onClose}
          />
          <QuickActionsBar
            card={card}
            worktree={state.worktree}
            checkingTestInfo={state.checkingTestInfo}
            onRunWorker={() => onRunWorker(card.id)}
            onOpenTestDialog={state.handleOpenTestDialog}
            onOpenRemote={() => window.electron.ipcRenderer.send('openExternal', card.remote_url)}
            onSplitCard={onSplitCard ? () => onSplitCard(card) : undefined}
          />
        </div>

        {/* Tabs */}
        <Tabs value={state.activeTab} onValueChange={state.setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="px-6 pt-2 pb-2 border-b shrink-0">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
              <TabsTrigger value="git">Git & Dev</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
            <div className="max-w-full overflow-x-hidden">
              {/* Details Tab */}
              <TabsContent value="details" className="p-6 space-y-6 mt-0 max-w-full">
              <DescriptionEditor
                description={card.body}
                isEditing={state.isEditingDescription}
                isSaving={state.isSavingDescription}
                onStartEdit={() => state.setIsEditingDescription(true)}
                onSave={state.handleSaveDescription}
                onCancel={() => state.setIsEditingDescription(false)}
              />

              {/* Linked Pull Requests */}
              {linkedPRs && linkedPRs.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <GitPullRequest className="h-4 w-4" />
                    Linked Pull Requests
                  </h3>
                  <div className="space-y-2 rounded-md bg-muted p-3">
                    {linkedPRs.map((link) => (
                      <button
                        key={link.id}
                        className="flex items-center gap-2 text-sm text-primary hover:underline w-full text-left rounded p-2 hover:bg-background"
                        onClick={(e) => {
                          e.preventDefault()
                          window.electron.ipcRenderer.send('openExternal', link.linked_url)
                        }}
                      >
                        <GitPullRequest className="h-4 w-4 text-chart-2 shrink-0" />
                        <span className="truncate">
                          {link.linked_type.toUpperCase()} #{link.linked_number_or_iid}
                        </span>
                        <ExternalLink className="h-3 w-3 ml-auto shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Labels */}
              {labels.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Labels</h3>
                  <div className="flex flex-wrap gap-1.5">
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
                  <h3 className="text-sm font-semibold mb-3">Assignees</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {assignees.map((assignee) => (
                      <Badge key={assignee} variant="outline">
                        {assignee}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="pt-4 border-t">
                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="flex items-center gap-2">
                    <Clock className="h-3 w-3" />
                    Local update: {formatRelativeTime(card.updated_local_at)}
                  </p>
                  {card.updated_remote_at && (
                    <p className="flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      Remote update: {formatRelativeTime(card.updated_remote_at)}
                    </p>
                  )}
                </div>
              </div>
              </TabsContent>

              {/* Actions Tab */}
              <TabsContent value="actions" className="p-6 space-y-6 mt-0 max-w-full">
              {/* Status Selector */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Status</h3>
                <Select value={card.status} onValueChange={(value) => onMoveCard(card.id, value as CardStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KANBAN_COLUMNS.map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        <div className="flex items-center gap-2">
                          <div className={cn('h-2 w-2 rounded-full', col.color)} />
                          {col.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Dependencies */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Dependencies</h3>
                <div className="rounded-md bg-muted p-3">
                  <DependencyManager card={card} />
                </div>
              </div>

              {/* Delete Card */}
              <div className="pt-4 border-t">
                <h3 className="text-sm font-semibold mb-3 text-destructive">Danger Zone</h3>
                {state.showDeleteConfirm ? (
                  <div className="space-y-3 rounded-md border border-destructive p-4">
                    <p className="text-sm font-medium text-destructive">
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
                        onClick={() => state.handleDeleteCard(onClose, onCardDeleted)}
                        disabled={state.isDeletingCard}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        {state.isDeletingCard ? 'Deleting...' : 'Delete Card'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => state.setShowDeleteConfirm(false)}
                        disabled={state.isDeletingCard}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => state.setShowDeleteConfirm(true)}
                    className="text-destructive hover:text-destructive border-destructive/30"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete Card
                  </Button>
                )}
              </div>
              </TabsContent>

              {/* Git & Dev Tab */}
              <TabsContent value="git" className="p-6 space-y-6 mt-0 max-w-full">
              {state.worktree ? (
                <WorktreeSection
                  worktree={state.worktree}
                  loading={state.worktreeLoading}
                  onViewDiff={() => state.setDiffDialogOpen(true)}
                  onOpenFolder={state.handleOpenWorktreeFolder}
                  onRecreate={state.handleRecreateWorktree}
                  onRemove={state.handleRemoveWorktree}
                />
              ) : (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No worktree for this card
                </div>
              )}

              {/* Agent Chat */}
              {state.latestJob && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Agent Chat
                  </h3>
                  <div className="space-y-2 rounded-md bg-muted p-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge
                        variant={
                          state.latestJob.state === 'failed'
                            ? 'destructive'
                            : state.latestJob.state === 'running'
                              ? 'default'
                              : 'secondary'
                        }
                      >
                        {state.latestJob.state}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {formatRelativeTime(state.latestJob.created_at)}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => state.setChatDialogOpen(true)}
                      className="w-full"
                    >
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Open Chat
                    </Button>
                  </div>
                </div>
              )}
              </TabsContent>

              {/* Activity Tab */}
              <TabsContent value="activity" className="p-6 space-y-4 mt-0 max-w-full">
                <TimelineSection events={cardEvents} />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>

        {/* Dialogs */}
        {state.worktree && (
          <GitDiffDialog
            open={state.diffDialogOpen}
            onOpenChange={state.setDiffDialogOpen}
            worktreeId={state.worktree.id}
            branchName={state.worktree.branch_name}
          />
        )}

        {state.latestJob && card && (
          <AgentChatDialog
            open={state.chatDialogOpen}
            onOpenChange={state.setChatDialogOpen}
            jobId={state.latestJob.id}
            cardId={card.id}
            cardTitle={card.title}
          />
        )}

        {state.testInfo && (
          <TestModificationsDialog
            open={state.testDialogOpen}
            onOpenChange={state.setTestDialogOpen}
            projectId={projectId || ''}
            cardId={card.id}
            testInfo={state.testInfo}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
