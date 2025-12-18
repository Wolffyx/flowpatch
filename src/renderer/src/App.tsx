import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { KanbanBoard } from './components/KanbanBoard'
import { CardDrawer } from './components/CardDrawer'
import { RemoteSelector } from './components/RemoteSelector'
import { CommandPalette } from './components/CommandPalette'
import { AddCardDialog, type CreateCardType } from './components/AddCardDialog'
import { Button } from './components/ui/button'
import { useAppStore } from './store/useAppStore'
import type { CardStatus, PolicyConfig, Project, Provider } from '../../shared/types'
import { WorkerLogDialog } from './components/WorkerLogDialog'
import { PullRequestsSection } from './components/PullRequestsSection'

function readShowPullRequestsSection(project: Project): boolean {
  if (!project.policy_json) return false
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return !!policy?.ui?.showPullRequestsSection
  } catch {
    return false
  }
}

function App(): React.JSX.Element {
  const store = useAppStore()
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [addCardDialogOpen, setAddCardDialogOpen] = useState(false)
  const [workerLogsOpen, setWorkerLogsOpen] = useState(false)

  const selectedProject = store.getSelectedProject()
  const selectedCard = store.getSelectedCard()
  const showPullRequestsSection = selectedProject ? readShowPullRequestsSection(selectedProject.project) : false
  const pullRequestCards = selectedProject
    ? selectedProject.cards.filter((c) => c.type === 'pr' || c.type === 'mr')
    : []
  const boardCards =
    selectedProject && showPullRequestsSection
      ? selectedProject.cards.filter((c) => c.type !== 'pr' && c.type !== 'mr')
      : selectedProject?.cards || []

  const workerJobs = (selectedProject?.jobs || []).filter((j) => j.type === 'worker_run')
  const activeWorkerJob = workerJobs.find((j) => j.state === 'running' || j.state === 'queued') || null
  const latestWorkerJob =
    workerJobs.length === 0
      ? null
      : workerJobs.reduce((latest, job) => {
          const latestTime = latest.updated_at || latest.created_at
          const jobTime = job.updated_at || job.created_at
          return jobTime > latestTime ? job : latest
        })
  const jobForLogs = activeWorkerJob || latestWorkerJob
  const cardForLogs =
    jobForLogs?.card_id
      ? selectedProject?.cards.find((c) => c.id === jobForLogs.card_id) || null
      : null

  // Determine remote provider for the selected project
  const remoteProvider: Provider | null = selectedProject?.project.remote_repo_key
    ? selectedProject.project.remote_repo_key.startsWith('github:')
      ? 'github'
      : selectedProject.project.remote_repo_key.startsWith('gitlab:')
        ? 'gitlab'
        : null
    : null

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Ctrl+K or Cmd+K to open command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
      // Escape to close panels
      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false)
        } else if (store.selectedCardId) {
          store.selectCard(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commandPaletteOpen, store])

  const handleAddCard = useCallback(() => {
    setAddCardDialogOpen(true)
  }, [])

  const handleCreateCard = useCallback(
    async (data: { title: string; body: string; createType: CreateCardType }) => {
      await store.createCard(data)
    },
    [store]
  )

  const handleMoveCard = useCallback(
    (cardId: string, status: CardStatus) => {
      store.moveCard(cardId, status)
    },
    [store]
  )

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <Sidebar
        projects={store.projects}
        selectedProjectId={store.selectedProjectId}
        onSelectProject={store.selectProject}
        onOpenRepo={store.openRepo}
        onDeleteProject={store.deleteProject}
      />

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <TopBar
          project={selectedProject?.project || null}
          jobs={selectedProject?.jobs || []}
          cards={selectedProject?.cards || []}
          isLoading={store.isLoading}
          onSync={store.syncProject}
          onToggleWorker={store.toggleWorker}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onSetWorkerToolPreference={store.setWorkerToolPreference}
          onSetWorkerRollbackOnCancel={store.setWorkerRollbackOnCancel}
          onSetShowPullRequestsSection={store.setShowPullRequestsSection}
          onOpenWorkerLogs={() => setWorkerLogsOpen(true)}
        />

        {/* Board and drawer */}
        <div className="flex flex-1 overflow-hidden">
          {selectedProject ? (
            <>
              {showPullRequestsSection && (
                <PullRequestsSection
                  cards={pullRequestCards}
                  selectedCardId={store.selectedCardId}
                  onSelectCard={store.selectCard}
                />
              )}

              <div className="flex-1 overflow-hidden">
                <KanbanBoard
                  cards={boardCards}
                  selectedCardId={store.selectedCardId}
                  onSelectCard={store.selectCard}
                  onMoveCard={handleMoveCard}
                  onAddCard={handleAddCard}
                />
              </div>

              {/* Card drawer */}
              {selectedCard && (
                <CardDrawer
                  card={selectedCard}
                  events={selectedProject.events}
                  projectId={selectedProject.project.id}
                  onClose={() => store.selectCard(null)}
                  onMoveCard={handleMoveCard}
                  onRunWorker={store.runWorker}
                />
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-2">Welcome to Patchwork</h2>
                <p className="text-muted-foreground mb-4">
                  Open a repository to get started with your Kanban board.
                </p>
                <Button onClick={store.openRepo}>Open Repository</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Remote selector dialog */}
      {store.pendingRemoteSelection && (
        <RemoteSelector
          open={true}
          projectName={store.pendingRemoteSelection.project.name}
          remotes={store.pendingRemoteSelection.remotes}
          onSelect={store.selectRemote}
          onCancel={store.cancelRemoteSelection}
        />
      )}

      {/* Command palette */}
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        hasProject={!!selectedProject}
        onOpenRepo={store.openRepo}
        onSync={store.syncProject}
        onRunWorker={() => store.runWorker()}
        onAddCard={handleAddCard}
      />

      {/* Add card dialog */}
      <AddCardDialog
        open={addCardDialogOpen}
        onOpenChange={setAddCardDialogOpen}
        hasRemote={!!selectedProject?.project.remote_repo_key}
        remoteProvider={remoteProvider}
        onCreateCard={handleCreateCard}
      />

      <WorkerLogDialog
        open={workerLogsOpen}
        onOpenChange={setWorkerLogsOpen}
        job={jobForLogs}
        card={cardForLogs}
        liveLogs={jobForLogs ? store.workerLogsByJobId[jobForLogs.id] ?? [] : []}
        onClearLogs={store.clearWorkerLogs}
      />

      {/* Error display */}
      {store.error && (
        <div className="fixed bottom-4 right-4 max-w-md rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive shadow-lg">
          <p className="font-medium">Error</p>
          <p>{store.error}</p>
        </div>
      )}
    </div>
  )
}

export default App
