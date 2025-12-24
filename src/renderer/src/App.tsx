import { useState, useEffect, useCallback, useMemo } from 'react'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { KanbanBoard } from './components/KanbanBoard'
import { CardDrawer } from './components/CardDrawer'
import { RemoteSelector } from './components/RemoteSelector'
import { CommandPalette } from './components/CommandPalette'
import { AddCardDialog, type CreateCardType } from './components/AddCardDialog'
import { Button } from './components/ui/button'
import { Toaster } from './components/ui/sonner'
import { useAppStore } from './store/useAppStore'
import type { CardStatus, PolicyConfig, Project, Provider } from '../../shared/types'
import { WorkerLogDialog } from './components/WorkerLogDialog'
import { PullRequestsSection } from './components/PullRequestsSection'
import { RepoStartDialog } from './components/RepoStartDialog'
import { LabelSetupDialog } from './components/LabelSetupDialog'
import { GithubProjectPromptDialog } from './components/GithubProjectPromptDialog'
import { StartupCheckDialog } from './components/StartupCheckDialog'
import {
  StarterCardsWizardDialog,
  type StarterCardsWizardMode
} from './components/StarterCardsWizardDialog'
import { matchAccelerator } from '@shared/accelerator'
import { useShortcuts } from './lib/useShortcuts'
import {
  buildLinkedPullRequestIndex,
  filterOutLinkedPullRequestCards,
  isLinkedPullRequestCard
} from './lib/linkedPullRequests'

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
  const [repoStartOpen, setRepoStartOpen] = useState(false)
  const [labelSetupOpen, setLabelSetupOpen] = useState(false)
  const [githubProjectPromptOpen, setGithubProjectPromptOpen] = useState(false)
  const [startupCheckOpen, setStartupCheckOpen] = useState(false)
  const [starterCardsWizardOpen, setStarterCardsWizardOpen] = useState(false)
  const [starterCardsWizardMode, setStarterCardsWizardMode] =
    useState<StarterCardsWizardMode>('manual')

  const selectedProject = store.getSelectedProject()
  const selectedCard = store.getSelectedCard()
  const { byId: shortcutById } = useShortcuts()
  const showPullRequestsSection = selectedProject
    ? readShowPullRequestsSection(selectedProject.project)
    : false

  const linkedPrIndex = useMemo(
    () => buildLinkedPullRequestIndex(selectedProject?.cardLinks),
    [selectedProject?.cardLinks]
  )

  const pullRequestCards = selectedProject
    ? selectedProject.cards.filter(
        (c) => (c.type === 'pr' || c.type === 'mr') && !isLinkedPullRequestCard(c, linkedPrIndex)
      )
    : []

  const boardCards = selectedProject
    ? filterOutLinkedPullRequestCards(
        showPullRequestsSection
          ? selectedProject.cards.filter((c) => c.type !== 'pr' && c.type !== 'mr')
          : selectedProject.cards,
        linkedPrIndex
      )
    : []

  const workerJobs = (selectedProject?.jobs || []).filter((j) => j.type === 'worker_run')
  const activeWorkerJob =
    workerJobs.find((j) => j.state === 'running' || j.state === 'queued') || null
  const latestWorkerJob =
    workerJobs.length === 0
      ? null
      : workerJobs.reduce((latest, job) => {
          const latestTime = latest.updated_at || latest.created_at
          const jobTime = job.updated_at || job.created_at
          return jobTime > latestTime ? job : latest
        })
  const jobForLogs = activeWorkerJob || latestWorkerJob
  const cardForLogs = jobForLogs?.card_id
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

  // If a PR becomes "collapsed into" an issue (linked), ensure it doesn't remain selected.
  useEffect(() => {
    if (!selectedProject || !store.selectedCardId) return
    const card = selectedProject.cards.find((c) => c.id === store.selectedCardId)
    if (card && isLinkedPullRequestCard(card, linkedPrIndex)) {
      store.selectCard(null)
    }
  }, [linkedPrIndex, selectedProject, store])

  // Repo onboarding dialogs (labels + optional GitHub Project creation)
  useEffect(() => {
    const project = selectedProject?.project
    if (!project?.id) return
    let canceled = false

    window.electron.ipcRenderer
      .invoke('getRepoOnboardingState', { projectId: project.id })
      .then(
        (state: {
          shouldShowLabelWizard?: boolean
          shouldPromptGithubProject?: boolean
          shouldShowStarterCardsWizard?: boolean
        }) => {
        if (canceled) return
        if (state?.shouldShowLabelWizard) {
          setGithubProjectPromptOpen(false)
          setStarterCardsWizardOpen(false)
          setLabelSetupOpen(true)
          return
        }
        if (state?.shouldPromptGithubProject && !labelSetupOpen) {
          setStarterCardsWizardOpen(false)
          setGithubProjectPromptOpen(true)
          return
        }
        if (state?.shouldShowStarterCardsWizard && !labelSetupOpen && !githubProjectPromptOpen) {
          if (!starterCardsWizardOpen) {
            setStarterCardsWizardMode('onboarding')
            setStarterCardsWizardOpen(true)
          }
        }
      })
      .catch(() => {
        // ignore
      })

    return () => {
      canceled = true
    }
  }, [
    githubProjectPromptOpen,
    labelSetupOpen,
    starterCardsWizardOpen,
    selectedProject?.project.id,
    selectedProject?.project.remote_repo_key,
    selectedProject?.project.policy_json,
    selectedProject?.project.last_sync_at
  ])

  // Startup CLI agent check (first launch only)
  useEffect(() => {
    let canceled = false
    window.electron.ipcRenderer
      .invoke('checkCliAgents')
      .then((result: { anyAvailable: boolean; isFirstCheck: boolean }) => {
        if (canceled) return
        if (!result.anyAvailable && result.isFirstCheck) {
          setStartupCheckOpen(true)
        }
      })
      .catch(() => {
        // ignore
      })
    return () => {
      canceled = true
    }
  }, [])

  const handleAddCard = useCallback((): void => {
    void (async () => {
      try {
        const project = selectedProject?.project
        if (project && !project.remote_repo_key) {
          await window.electron.ipcRenderer.invoke('ensureProjectRemote', { projectId: project.id })
          await store.loadState()
        }
      } catch {
      }
      setAddCardDialogOpen(true)
    })()
  }, [selectedProject?.project, store])

  const handleGenerateCards = useCallback((): void => {
    setStarterCardsWizardMode('manual')
    setStarterCardsWizardOpen(true)
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable === true

      const shortcutOpenPalette = shortcutById['commandPalette.open'] ?? 'CmdOrCtrl+K'
      const shortcutEscape = shortcutById['ui.escape'] ?? 'Escape'
      const shortcutOpenRepo = shortcutById['repo.open'] ?? 'CmdOrCtrl+O'
      const shortcutSync = shortcutById['sync.now'] ?? 'CmdOrCtrl+S'
      const shortcutRunWorker = shortcutById['worker.run'] ?? 'CmdOrCtrl+R'
      const shortcutAddCard = shortcutById['card.add'] ?? 'CmdOrCtrl+N'

      if (!isEditable && matchAccelerator(shortcutOpenPalette, e)) {
        e.preventDefault()
        setCommandPaletteOpen(true)
        return
      }

      if (matchAccelerator(shortcutEscape, e)) {
        e.preventDefault()
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false)
        } else if (store.selectedCardId) {
          store.selectCard(null)
        }
        return
      }

      if (isEditable) return

      if (matchAccelerator(shortcutOpenRepo, e)) {
        e.preventDefault()
        setRepoStartOpen(true)
        return
      }

      if (selectedProject && matchAccelerator(shortcutSync, e)) {
        e.preventDefault()
        void store.syncProject()
        return
      }

      if (selectedProject && matchAccelerator(shortcutRunWorker, e)) {
        e.preventDefault()
        void store.runWorker()
        return
      }

      if (selectedProject && matchAccelerator(shortcutAddCard, e)) {
        e.preventDefault()
        handleAddCard()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commandPaletteOpen, handleAddCard, selectedProject, shortcutById, store])

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
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar
        projects={store.projects}
        selectedProjectId={store.selectedProjectId}
        onSelectProject={store.selectProject}
        onOpenRepo={() => setRepoStartOpen(true)}
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
          commandPaletteShortcut={shortcutById['commandPalette.open']}
          onSetWorkerToolPreference={store.setWorkerToolPreference}
          onSetWorkerRollbackOnCancel={store.setWorkerRollbackOnCancel}
          onSetShowPullRequestsSection={store.setShowPullRequestsSection}
          onOpenWorkerLogs={() => setWorkerLogsOpen(true)}
        />

        {/* Board and drawer */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {selectedProject ? (
            <>
              {showPullRequestsSection && (
                <PullRequestsSection
                  cards={pullRequestCards}
                  selectedCardId={store.selectedCardId}
                  onSelectCard={store.selectCard}
                />
              )}

              <div className="flex-1 overflow-hidden min-h-0">
                <KanbanBoard
                  cards={boardCards}
                  cardLinksByCardId={store.cardLinksByCardId}
                  selectedCardId={store.selectedCardId}
                  onSelectCard={store.selectCard}
                  onMoveCard={handleMoveCard}
                  onAddCard={handleAddCard}
                  onGenerateCards={handleGenerateCards}
                />
              </div>

              {/* Card drawer */}
              {selectedCard && (
                <CardDrawer
                  card={selectedCard}
                  linkedPRs={store.cardLinksByCardId[selectedCard.id]}
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
                <Button onClick={() => setRepoStartOpen(true)}>Open or Create Repository</Button>
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
        onOpenRepo={() => setRepoStartOpen(true)}
        onSync={store.syncProject}
        onRunWorker={() => store.runWorker()}
        onAddCard={handleAddCard}
        onGenerateCards={handleGenerateCards}
        shortcuts={shortcutById}
      />

      {/* Add card dialog */}
      <AddCardDialog
        open={addCardDialogOpen}
        onOpenChange={setAddCardDialogOpen}
        projectId={selectedProject?.project.id || store.selectedProjectId || ''}
        hasRemote={!!selectedProject?.project.remote_repo_key}
        remoteProvider={remoteProvider}
        onCreateCard={handleCreateCard}
      />

      <StarterCardsWizardDialog
        open={starterCardsWizardOpen}
        onOpenChange={setStarterCardsWizardOpen}
        projectId={selectedProject?.project.id || store.selectedProjectId || ''}
        mode={starterCardsWizardMode}
        onCreateCards={store.createCardsBatch}
      />

      <WorkerLogDialog
        open={workerLogsOpen}
        onOpenChange={setWorkerLogsOpen}
        job={jobForLogs}
        card={cardForLogs}
        liveLogs={jobForLogs ? (store.workerLogsByJobId[jobForLogs.id] ?? []) : []}
        onClearLogs={store.clearWorkerLogs}
      />

      <RepoStartDialog
        open={repoStartOpen}
        onOpenChange={setRepoStartOpen}
        onOpenRepo={store.openRepo}
        onCreateRepo={store.createRepo}
      />

      {selectedProject?.project && (
        <LabelSetupDialog
          open={labelSetupOpen}
          onOpenChange={setLabelSetupOpen}
          project={selectedProject.project}
        />
      )}

      {selectedProject?.project && (
        <GithubProjectPromptDialog
          open={githubProjectPromptOpen}
          onOpenChange={setGithubProjectPromptOpen}
          project={selectedProject.project}
        />
      )}

      <StartupCheckDialog
        open={startupCheckOpen}
        onOpenChange={setStartupCheckOpen}
        onCheckComplete={() => setStartupCheckOpen(false)}
      />

      {/* Error display */}
      {store.error && (
        <div className="fixed bottom-4 right-4 max-w-md rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive shadow-lg">
          <p className="font-medium">Error</p>
          <p>{store.error}</p>
        </div>
      )}

      {/* Toast notifications */}
      <Toaster position="bottom-right" />
    </div>
  )
}

export default App
