/**
 * Project Application
 *
 * The project renderer that displays:
 * - Toolbar with sync and worker controls
 * - Kanban board with cards
 * - Card drawer for details
 * - Add card dialog
 *
 * This runs inside a WebContentsView managed by the shell.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Toaster } from '../src/components/ui/sonner'
import { KanbanBoard } from '../src/components/KanbanBoard'
import { CardDrawer } from '../src/components/CardDrawer'
import { AddCardDialog } from '../src/components/AddCardDialog'
import { LabelSetupDialog } from '../src/components/LabelSetupDialog'
import { GithubProjectPromptDialog } from '../src/components/GithubProjectPromptDialog'
import { WorkerLogDialog } from '../src/components/WorkerLogDialog'
import { Button } from '../src/components/ui/button'
import { Switch } from '../src/components/ui/switch'
import { Badge } from '../src/components/ui/badge'
import { RefreshCw, Bot, Loader2, Play, Pause, AlertCircle, Terminal } from 'lucide-react'
import { cn } from '../src/lib/utils'
import {
  buildLinkedPullRequestIndex,
  filterOutLinkedPullRequestCards,
  isLinkedPullRequestCard
} from '../src/lib/linkedPullRequests'
import type { Card, CardLink, CardStatus, Event, Job, Project, WorkerLogMessage } from '@shared/types'

// Declare the project API type
declare global {
  interface Window {
    projectAPI: {
      onProjectOpened: (
        callback: (info: { projectId: string; projectKey: string; projectPath: string }) => void
      ) => () => void
      onProjectClosing: (callback: () => void) => () => void
      getProject: (projectId: string) => Promise<Project | null>
      getRepoOnboardingState: (projectId: string) => Promise<{
        shouldShowLabelWizard?: boolean
        shouldPromptGithubProject?: boolean
      }>
      getCards: () => Promise<Card[]>
      getCardLinks: () => Promise<CardLink[]>
      moveCard: (cardId: string, status: CardStatus) => Promise<void>
      createCard: (title: string, body?: string) => Promise<Card>
      sync: () => Promise<void>
      onSyncComplete: (callback: () => void) => () => void
      isWorkerEnabled: () => Promise<boolean>
      toggleWorker: (enabled: boolean) => Promise<void>
      runWorker: (cardId?: string) => Promise<void>
      getJobs: () => Promise<Job[]>
      getEvents: (limit?: number) => Promise<Event[]>
      onStateUpdate: (callback: () => void) => () => void
      onWorkerLog: (callback: (log: WorkerLogMessage) => void) => () => void
    }
  }
}

interface ProjectInfo {
  projectId: string
  projectKey: string
  projectPath: string
}

export default function App(): React.JSX.Element {
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [cardLinks, setCardLinks] = useState<CardLink[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [addCardOpen, setAddCardOpen] = useState(false)
  const [labelSetupOpen, setLabelSetupOpen] = useState(false)
  const [githubProjectPromptOpen, setGithubProjectPromptOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [workerEnabled, setWorkerEnabled] = useState(false)
  const [workerLogsOpen, setWorkerLogsOpen] = useState(false)
  const [workerLogsByJobId, setWorkerLogsByJobId] = useState<Record<string, string[]>>({})

  // Build card links lookup
  const cardLinksByCardId: Record<string, CardLink[]> = {}
  for (const link of cardLinks) {
    if (!cardLinksByCardId[link.card_id]) {
      cardLinksByCardId[link.card_id] = []
    }
    cardLinksByCardId[link.card_id].push(link)
  }

  // Get selected card
  const selectedCard = selectedCardId ? cards.find((c) => c.id === selectedCardId) ?? null : null

  const linkedPrIndex = useMemo(() => buildLinkedPullRequestIndex(cardLinks), [cardLinks])
  const visibleCards = useMemo(
    () => filterOutLinkedPullRequestCards(cards, linkedPrIndex),
    [cards, linkedPrIndex]
  )

  // Worker status calculations
  const workerJobs = jobs.filter((j) => j.type === 'worker_run')
  const activeWorkerJob = workerJobs.find((j) => j.state === 'running' || j.state === 'queued')
  const latestWorkerJob =
    workerJobs.length === 0
      ? null
      : workerJobs.reduce((latest, job) => {
          const latestTime = latest.updated_at || latest.created_at
          const jobTime = job.updated_at || job.created_at
          return jobTime > latestTime ? job : latest
        })
  const hasWorkerError = latestWorkerJob?.state === 'failed'
  const readyCards = cards.filter((c) => c.status === 'ready')
  const jobForLogs = activeWorkerJob || latestWorkerJob
  const cardForLogs =
    jobForLogs?.card_id ? cards.find((c) => c.id === jobForLogs.card_id) ?? null : null

  // If a PR becomes linked to an issue, hide it and clear selection.
  useEffect(() => {
    if (!selectedCardId) return
    const card = cards.find((c) => c.id === selectedCardId)
    if (card && isLinkedPullRequestCard(card, linkedPrIndex)) {
      setSelectedCardId(null)
    }
  }, [cards, linkedPrIndex, selectedCardId])

  // Listen for project opened event
  useEffect(() => {
    const unsubscribe = window.projectAPI.onProjectOpened((info) => {
      setProjectInfo(info)
      loadData()
      loadWorkerEnabled()
    })
    return unsubscribe
  }, [])

  // Listen for project closing event
  useEffect(() => {
    const unsubscribe = window.projectAPI.onProjectClosing(() => {
      setProjectInfo(null)
      setCards([])
      setCardLinks([])
      setSelectedCardId(null)
    })
    return unsubscribe
  }, [])

  // Listen for state updates
  useEffect(() => {
    const unsubscribe = window.projectAPI.onStateUpdate(() => {
      loadData()
      // Re-check onboarding state on state updates (e.g., after resetLabelWizard)
      if (projectInfo) {
        checkOnboardingState(projectInfo.projectId)
      }
    })
    return unsubscribe
  }, [projectInfo])

  // Load project and check onboarding state when project opens
  useEffect(() => {
    if (!projectInfo) return

    const loadProjectAndOnboarding = async (): Promise<void> => {
      try {
        const projectData = await window.projectAPI.getProject(projectInfo.projectId)
        setProject(projectData)
        await checkOnboardingState(projectInfo.projectId)
      } catch (error) {
        console.error('Failed to load project:', error)
      }
    }

    loadProjectAndOnboarding()
  }, [projectInfo])

  const checkOnboardingState = async (projectId: string): Promise<void> => {
    try {
      const state = await window.projectAPI.getRepoOnboardingState(projectId)
      if (state.shouldShowLabelWizard) {
        setLabelSetupOpen(true)
      }
      if (state.shouldPromptGithubProject) {
        setGithubProjectPromptOpen(true)
      }
    } catch (error) {
      console.error('Failed to check onboarding state:', error)
    }
  }

  // Listen for worker logs
  useEffect(() => {
    const unsubscribe = window.projectAPI.onWorkerLog((payload) => {
      if (!payload?.jobId || !payload?.line) return
      setWorkerLogsByJobId((prev) => {
        const existing = prev[payload.jobId] ?? []
        const nextLines = [...existing, payload.line].slice(-1000)
        return { ...prev, [payload.jobId]: nextLines }
      })
    })
    return unsubscribe
  }, [])

  const clearWorkerLogs = useCallback((jobId: string) => {
    setWorkerLogsByJobId((prev) => {
      if (!(jobId in prev)) return prev
      const next = { ...prev }
      delete next[jobId]
      return next
    })
  }, [])

  const loadData = async (): Promise<void> => {
    setIsLoading(true)
    try {
      const [cardsData, linksData, jobsData] = await Promise.all([
        window.projectAPI.getCards(),
        window.projectAPI.getCardLinks(),
        window.projectAPI.getJobs()
      ])
      setCards(cardsData)
      setCardLinks(linksData)
      setJobs(jobsData)
    } catch (error) {
      console.error('Failed to load project data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadWorkerEnabled = async (): Promise<void> => {
    try {
      const enabled = await window.projectAPI.isWorkerEnabled()
      setWorkerEnabled(enabled)
    } catch (error) {
      console.error('Failed to load worker status:', error)
    }
  }

  const handleSync = useCallback(async (): Promise<void> => {
    setIsSyncing(true)
    try {
      await window.projectAPI.sync()
    } catch (error) {
      console.error('Failed to sync:', error)
    } finally {
      setIsSyncing(false)
    }
  }, [])

  const handleToggleWorker = useCallback(async (enabled: boolean): Promise<void> => {
    try {
      await window.projectAPI.toggleWorker(enabled)
      setWorkerEnabled(enabled)
    } catch (error) {
      console.error('Failed to toggle worker:', error)
    }
  }, [])

  const handleMoveCard = useCallback(async (cardId: string, status: CardStatus): Promise<void> => {
    // Optimistic update
    setCards((prev) =>
      prev.map((card) => (card.id === cardId ? { ...card, status } : card))
    )

    try {
      await window.projectAPI.moveCard(cardId, status)
    } catch (error) {
      console.error('Failed to move card:', error)
      // Reload to get correct state
      loadData()
    }
  }, [])

  const handleAddCard = useCallback(
    async (title: string, body?: string): Promise<void> => {
      try {
        const newCard = await window.projectAPI.createCard(title, body)
        setCards((prev) => [...prev, newCard])
        setAddCardOpen(false)
      } catch (error) {
        console.error('Failed to create card:', error)
      }
    },
    []
  )

  const handleCloseDrawer = useCallback((): void => {
    setSelectedCardId(null)
  }, [])

  if (!projectInfo) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>Waiting for project...</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>Loading project...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Toolbar */}
      <div className="flex h-12 items-center justify-between border-b px-4 shrink-0">
        <div className="flex items-center gap-4">
          {/* Worker toggle */}
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Worker</span>
            <Switch
              checked={workerEnabled}
              onCheckedChange={handleToggleWorker}
            />
            {workerEnabled && (
              <Badge
                variant={
                  activeWorkerJob
                    ? 'secondary'
                    : hasWorkerError
                      ? 'destructive'
                      : 'default'
                }
                className="ml-1"
              >
                {activeWorkerJob ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    Processing...
                  </>
                ) : hasWorkerError ? (
                  <>
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Error
                  </>
                ) : readyCards.length > 0 ? (
                  <>
                    <Play className="h-3 w-3 mr-1" />
                    {readyCards.length} ready
                  </>
                ) : (
                  <>
                    <Pause className="h-3 w-3 mr-1" />
                    Idle
                  </>
                )}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWorkerLogsOpen(true)}
            disabled={!jobForLogs}
            title="Worker logs"
          >
            <Terminal className="mr-2 h-4 w-4" />
            Logs
          </Button>

          {/* Sync button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={isSyncing}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', isSyncing && 'animate-spin')} />
            Sync
          </Button>
        </div>
      </div>

      {/* Main Content - flex row with kanban and drawer */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Kanban Board */}
        <div className="flex-1 overflow-hidden min-h-0">
          <KanbanBoard
            cards={visibleCards}
            cardLinksByCardId={cardLinksByCardId}
            selectedCardId={selectedCardId}
            onSelectCard={setSelectedCardId}
            onMoveCard={handleMoveCard}
            onAddCard={() => setAddCardOpen(true)}
          />
        </div>

        {/* Card Drawer - side panel */}
        {selectedCard && (
          <CardDrawer
            card={selectedCard}
            linkedPRs={cardLinksByCardId[selectedCard.id] ?? []}
            events={[]} // TODO: Load events for card
            projectId={projectInfo?.projectId ?? null}
            onClose={handleCloseDrawer}
            onMoveCard={handleMoveCard}
            onRunWorker={(cardId) => window.projectAPI.runWorker(cardId)}
          />
        )}
      </div>

      {/* Add Card Dialog */}
      <AddCardDialog
        open={addCardOpen}
        onOpenChange={setAddCardOpen}
        onSubmit={handleAddCard}
      />

      <WorkerLogDialog
        open={workerLogsOpen}
        onOpenChange={setWorkerLogsOpen}
        job={jobForLogs ?? null}
        card={cardForLogs}
        liveLogs={jobForLogs ? workerLogsByJobId[jobForLogs.id] ?? [] : []}
        onClearLogs={clearWorkerLogs}
      />

      {/* Onboarding Dialogs */}
      {project && (
        <LabelSetupDialog
          open={labelSetupOpen}
          onOpenChange={setLabelSetupOpen}
          project={project}
        />
      )}

      {project && (
        <GithubProjectPromptDialog
          open={githubProjectPromptOpen}
          onOpenChange={setGithubProjectPromptOpen}
          project={project}
        />
      )}

      <Toaster />
    </div>
  )
}
