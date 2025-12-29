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
import { AddCardDialog, type CreateCardType } from '../src/components/AddCardDialog'
import { LabelSetupDialog } from '../src/components/LabelSetupDialog'
import { GithubProjectPromptDialog } from '../src/components/GithubProjectPromptDialog'
import { WorkerLogDialog } from '../src/components/WorkerLogDialog'
import {
  StarterCardsWizardDialog,
  type StarterCardsWizardMode
} from '../src/components/StarterCardsWizardDialog'
import { WorkspaceDialog } from './components/WorkspaceDialog'
import { UsageIndicator } from './components/UsageIndicator'
import { Button } from '../src/components/ui/button'
import { Switch } from '../src/components/ui/switch'
import { Badge } from '../src/components/ui/badge'
import { RefreshCw, Bot, Loader2, Play, Pause, AlertCircle, Terminal, Folder } from 'lucide-react'
import { cn } from '../src/lib/utils'
import {
  buildLinkedPullRequestIndex,
  filterOutLinkedPullRequestCards,
  isLinkedPullRequestCard
} from '../src/lib/linkedPullRequests'
import type {
  Card,
  CardLink,
  CardStatus,
  Event,
  Job,
  Project,
  Provider,
  WorkerLogMessage,
  PatchworkWorkspaceStatus
} from '@shared/types'

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
        shouldShowStarterCardsWizard?: boolean
      }>
      getCards: () => Promise<Card[]>
      getCardLinks: () => Promise<CardLink[]>
      moveCard: (cardId: string, status: CardStatus) => Promise<void>
      ensureProjectRemote: (projectId: string) => Promise<{ project?: Project; error?: string }>
      createCard: (data: { title: string; body?: string; createType: CreateCardType }) => Promise<Card>
      sync: () => Promise<void>
      onSyncComplete: (callback: () => void) => () => void
      isWorkerEnabled: () => Promise<boolean>
      toggleWorker: (enabled: boolean) => Promise<void>
      runWorker: (cardId?: string) => Promise<void>
      getJobs: () => Promise<Job[]>
      getEvents: (limit?: number) => Promise<Event[]>
      onStateUpdate: (callback: () => void) => () => void
      onWorkerLog: (callback: (log: WorkerLogMessage) => void) => () => void

      // Patchwork workspace (.patchwork)
      getWorkspaceStatus: () => Promise<PatchworkWorkspaceStatus | null>
      ensureWorkspace: () => Promise<unknown>
      indexBuild: () => Promise<unknown>
      indexRefresh: () => Promise<unknown>
      indexWatchStart: () => Promise<unknown>
      indexWatchStop: () => Promise<unknown>
      validateConfig: () => Promise<unknown>
      docsRefresh: () => Promise<unknown>
      contextPreview: (task: string) => Promise<unknown>
      repairWorkspace: () => Promise<unknown>
      migrateWorkspace: () => Promise<unknown>
      openWorkspaceFolder: () => Promise<unknown>

      // Configuration sync
      updateFeatureConfig: (
        featureKey: string,
        config: Record<string, unknown>
      ) => Promise<{
        success: boolean
        policy?: unknown
        errors?: string[]
        warnings?: string[]
      }>

      // Usage tracking
      getTotalUsage: () => Promise<{ usage: { tokens: number; cost: number } }>
      getUsageWithLimits: () => Promise<{
        usageWithLimits: {
          tool_type: string
          total_input_tokens: number
          total_output_tokens: number
          total_tokens: number
          total_cost_usd: number
          invocation_count: number
          avg_duration_ms: number
          limits: {
            tool_type: string
            daily_token_limit: number | null
            monthly_token_limit: number | null
            daily_cost_limit_usd: number | null
            monthly_cost_limit_usd: number | null
          } | null
          daily_tokens_used: number
          monthly_tokens_used: number
          daily_cost_used: number
          monthly_cost_used: number
        }[]
      }>
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
  const [starterCardsWizardOpen, setStarterCardsWizardOpen] = useState(false)
  const [starterCardsWizardMode, setStarterCardsWizardMode] =
    useState<StarterCardsWizardMode>('manual')
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [workerEnabled, setWorkerEnabled] = useState(false)
  const [workerLogsOpen, setWorkerLogsOpen] = useState(false)
  const [workerLogsByJobId, setWorkerLogsByJobId] = useState<Record<string, string[]>>({})
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspaceStatus, setWorkspaceStatus] = useState<PatchworkWorkspaceStatus | null>(null)
  const [workspaceStatusLoading, setWorkspaceStatusLoading] = useState(false)

  // Initial load - shows loading indicator
  async function loadWorkspaceStatus(): Promise<void> {
    setWorkspaceStatusLoading(true)
    try {
      const status = await window.projectAPI.getWorkspaceStatus()
      setWorkspaceStatus(status)
    } catch (error) {
      console.error('Failed to load workspace status:', error)
    } finally {
      setWorkspaceStatusLoading(false)
    }
  }

  // Background refresh - does NOT show loading to avoid flashing
  async function refreshWorkspaceStatus(): Promise<void> {
    try {
      const status = await window.projectAPI.getWorkspaceStatus()
      setWorkspaceStatus(status)
    } catch (error) {
      console.error('Failed to refresh workspace status:', error)
    }
  }

  // Build card links lookup
  const cardLinksByCardId: Record<string, CardLink[]> = {}
  for (const link of cardLinks) {
    if (!cardLinksByCardId[link.card_id]) {
      cardLinksByCardId[link.card_id] = []
    }
    cardLinksByCardId[link.card_id].push(link)
  }

  // Get selected card
  const selectedCard = selectedCardId ? (cards.find((c) => c.id === selectedCardId) ?? null) : null

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
  const cardForLogs = jobForLogs?.card_id
    ? (cards.find((c) => c.id === jobForLogs.card_id) ?? null)
    : null

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
      void loadWorkspaceStatus()
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

  // Listen for state updates - refresh data without showing loading screen
  useEffect(() => {
    const unsubscribe = window.projectAPI.onStateUpdate(() => {
      refreshData() // Use refreshData instead of loadData to avoid loading flash
      void refreshWorkspaceStatus() // Use refresh to avoid loading flash
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

  async function checkOnboardingState(projectId: string): Promise<void> {
    try {
      const state = await window.projectAPI.getRepoOnboardingState(projectId)
      if (state.shouldShowLabelWizard) {
        setStarterCardsWizardOpen(false)
        setGithubProjectPromptOpen(false)
        setLabelSetupOpen(true)
        return
      }
      if (state.shouldPromptGithubProject) {
        setStarterCardsWizardOpen(false)
        setGithubProjectPromptOpen(true)
        return
      }
      if (state.shouldShowStarterCardsWizard) {
        if (!starterCardsWizardOpen) {
          setStarterCardsWizardMode('onboarding')
          setStarterCardsWizardOpen(true)
        }
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

  // Initial load - shows loading screen
  async function loadData(): Promise<void> {
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

  // Background refresh - does NOT show loading screen to avoid flashing
  async function refreshData(): Promise<void> {
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
      console.error('Failed to refresh project data:', error)
    }
  }

  async function loadWorkerEnabled(): Promise<void> {
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
    setCards((prev) => prev.map((card) => (card.id === cardId ? { ...card, status } : card)))

    try {
      await window.projectAPI.moveCard(cardId, status)
    } catch (error) {
      console.error('Failed to move card:', error)
      // Reload to get correct state (use refreshData to avoid flash)
      refreshData()
    }
  }, [])

  const remoteProvider: Provider | null = project?.remote_repo_key
    ? project.remote_repo_key.startsWith('github:')
      ? 'github'
      : project.remote_repo_key.startsWith('gitlab:')
        ? 'gitlab'
        : null
    : null

  const repoIssueProvider = remoteProvider === 'github' || remoteProvider === 'gitlab' ? remoteProvider : null
  const canCreateRepoIssues = repoIssueProvider !== null

  const handleOpenAddCard = useCallback((): void => {
    void (async () => {
      if (project && !project.remote_repo_key) {
        const result = await window.projectAPI.ensureProjectRemote(project.id)
        if (!result?.error && result?.project) {
          setProject(result.project)
        }
      }
      setAddCardOpen(true)
    })()
  }, [project])

  const handleGenerateCards = useCallback((): void => {
    setStarterCardsWizardMode('manual')
    setStarterCardsWizardOpen(true)
  }, [])

  const handleCreateCardsBatch = useCallback(
    async (
      items: Array<{ title: string; body: string }>,
      createType: 'local' | 'repo_issue'
    ): Promise<void> => {
      for (const item of items) {
        await window.projectAPI.createCard({
          title: item.title,
          body: item.body || undefined,
          createType
        })
      }
      const [cardsData, linksData, jobsData] = await Promise.all([
        window.projectAPI.getCards(),
        window.projectAPI.getCardLinks(),
        window.projectAPI.getJobs()
      ])
      setCards(cardsData)
      setCardLinks(linksData)
      setJobs(jobsData)
    },
    []
  )

  const handleCreateCard = useCallback(
    async (data: { title: string; body: string; createType: CreateCardType }): Promise<void> => {
    try {
      const newCard = await window.projectAPI.createCard(data)
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
            <Switch checked={workerEnabled} onCheckedChange={handleToggleWorker} />
            {workerEnabled && (
              <Badge
                variant={activeWorkerJob ? 'secondary' : hasWorkerError ? 'destructive' : 'default'}
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

          {/* Workspace + Index chips */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Workspace</span>
            <Badge
              variant={
                workspaceStatusLoading
                  ? 'secondary'
                  : !workspaceStatus
                    ? 'outline'
                    : !workspaceStatus.writable
                      ? 'destructive'
                      : workspaceStatus.exists
                        ? 'default'
                        : 'secondary'
              }
              className="cursor-pointer"
              onClick={() => setWorkspaceOpen(true)}
              title="Open workspace settings"
            >
              {workspaceStatusLoading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Loading
                </>
              ) : !workspaceStatus ? (
                'Unknown'
              ) : !workspaceStatus.writable ? (
                'Read-only'
              ) : workspaceStatus.exists ? (
                'OK'
              ) : (
                'Missing'
              )}
            </Badge>

            <Badge
              variant={
                !workspaceStatus
                  ? 'outline'
                  : workspaceStatus.index.state === 'ready'
                    ? 'default'
                    : workspaceStatus.index.state === 'stale'
                      ? 'secondary'
                      : workspaceStatus.index.state === 'building'
                        ? 'secondary'
                        : workspaceStatus.index.state === 'blocked'
                          ? 'destructive'
                          : 'outline'
              }
              className="cursor-pointer"
              onClick={() => setWorkspaceOpen(true)}
              title="Index status"
            >
              {workspaceStatus?.index.state ?? 'missing'}
              {workspaceStatus?.autoIndexingEnabled ? ' • auto' : ''}
              {workspaceStatus?.watchEnabled ? ' • watch' : ''}
            </Badge>
          </div>
        </div>

        {/* Usage Indicator */}
        <UsageIndicator />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void window.projectAPI.openWorkspaceFolder()
            }}
            title="Open .patchwork folder"
          >
            <Folder className="mr-2 h-4 w-4" />
            Workspace
          </Button>

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
          <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
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
            onAddCard={handleOpenAddCard}
            onGenerateCards={handleGenerateCards}
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
        projectId={projectInfo?.projectId ?? ''}
        hasRemote={!!project?.remote_repo_key}
        remoteProvider={remoteProvider}
        onCreateCard={handleCreateCard}
      />

      <StarterCardsWizardDialog
        open={starterCardsWizardOpen}
        onOpenChange={setStarterCardsWizardOpen}
        projectId={projectInfo?.projectId ?? ''}
        mode={starterCardsWizardMode}
        canCreateRepoIssues={canCreateRepoIssues}
        repoIssueProvider={repoIssueProvider}
        onCreateCards={handleCreateCardsBatch}
      />

      <WorkerLogDialog
        open={workerLogsOpen}
        onOpenChange={setWorkerLogsOpen}
        job={jobForLogs ?? null}
        card={cardForLogs}
        liveLogs={jobForLogs ? (workerLogsByJobId[jobForLogs.id] ?? []) : []}
        onClearLogs={clearWorkerLogs}
      />

      <WorkspaceDialog
        open={workspaceOpen}
        onOpenChange={(open) => {
          setWorkspaceOpen(open)
          if (open) void loadWorkspaceStatus()
        }}
        status={workspaceStatus}
        jobs={jobs}
        onRefreshStatus={loadWorkspaceStatus}
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
