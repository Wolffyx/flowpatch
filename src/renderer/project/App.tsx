/**
 * Project Application
 *
 * The project renderer that displays:
 * - Toolbar with sync and worker controls
 * - Kanban board with cards
 * - Card dialog for details
 * - Add card dialog
 *
 * This runs inside a WebContentsView managed by the shell.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Toaster } from '../src/components/ui/sonner'
import { KanbanBoard } from '../src/components/KanbanBoard'
import { CardDialog } from '../src/components/CardDialog'
import { AddCardDialog, type CreateCardType } from '../src/components/AddCardDialog'
import { LabelSetupDialog } from '../src/components/LabelSetupDialog'
import { GithubProjectPromptDialog } from '../src/components/GithubProjectPromptDialog'
import { WorkerLogDialog } from '../src/components/WorkerLogDialog'
import { FollowUpInstructionDialog } from '../src/components/FollowUpInstructionDialog'
import { PlanApprovalDialog } from '../src/components/PlanApprovalDialog'
import {
  StarterCardsWizardDialog,
  type StarterCardsWizardMode
} from '../src/components/StarterCardsWizardDialog'
import { WorkspaceDialog } from './components/workspace/WorkspaceDialog'
import { UsageIndicator } from './components/UsageIndicator'
import { FeatureSuggestionsDialog } from '../src/components/FeatureSuggestionsDialog'
import { GraphViewDialog } from '../src/components/GraphViewDialog'
import { SplitCardDialog } from '../src/components/SplitCardDialog'
import { useAudioNotifications } from '../src/hooks/useAudioNotifications'
import { useDevServerStatus } from '../src/hooks/useDevServerStatus'
import { Button } from '../src/components/ui/button'
import { Switch } from '../src/components/ui/switch'
import { Badge } from '../src/components/ui/badge'
import { RefreshCw, Bot, Loader2, Play, Pause, AlertCircle, Terminal, Folder, Lightbulb, Network, Send } from 'lucide-react'
import { cn } from '../src/lib/utils'
import {
  buildLinkedPullRequestIndex,
  filterOutLinkedPullRequestCards,
  isLinkedPullRequestCard
} from '../src/lib/linkedPullRequests'
import { PullRequestsSection } from '../src/components/PullRequestsSection'
import type { PolicyConfig } from '@shared/types'
import type {
  Card,
  CardLink,
  CardStatus,
  Event,
  Job,
  Project,
  Provider,
  WorkerLogMessage,
  FlowPatchWorkspaceStatus,
  FollowUpInstructionType,
  PlanApproval
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
      splitCard: (data: {
        cardId: string
        items: Array<{ title: string; body?: string }>
      }) => Promise<{ cards?: Card[]; error?: string }>
      sync: () => Promise<void>
      onSyncComplete: (callback: () => void) => () => void
      isWorkerEnabled: () => Promise<boolean>
      toggleWorker: (enabled: boolean) => Promise<void>
      runWorker: (cardId?: string) => Promise<void>
      getJobs: () => Promise<Job[]>
      getEvents: (limit?: number) => Promise<Event[]>
      onStateUpdate: (callback: () => void) => () => void
      onWorkerLog: (callback: (log: WorkerLogMessage) => void) => () => void

      // Plan Approval
      getPlanApproval: (params: { approvalId: string }) => Promise<PlanApproval | null>
      approvePlan: (approvalId: string, notes?: string) => Promise<{ success: boolean; error?: string }>
      rejectPlan: (approvalId: string, notes?: string) => Promise<{ success: boolean; error?: string }>
      skipPlanApproval: (approvalId: string) => Promise<{ success: boolean; error?: string }>
      onPlanApprovalRequired: (callback: (data: { approvalId: string; jobId: string; cardId: string }) => void) => () => void

      // Follow-up Instructions
      createFollowUpInstruction: (data: {
        jobId: string
        cardId: string
        instructionType: FollowUpInstructionType
        content: string
        priority?: number
      }) => Promise<{ success: boolean; error?: string }>

      // FlowPatch workspace (.flowpatch)
      getWorkspaceStatus: () => Promise<FlowPatchWorkspaceStatus | null>
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
      getFlowPatchConfig: () => Promise<unknown>
      createPlanFile: () => Promise<{
        success: boolean
        created?: boolean
        path?: string
        error?: string
        message?: string
      }>

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
            hourly_token_limit: number | null
            daily_token_limit: number | null
            monthly_token_limit: number | null
            hourly_cost_limit_usd: number | null
            daily_cost_limit_usd: number | null
            monthly_cost_limit_usd: number | null
          } | null
          hourly_tokens_used: number
          daily_tokens_used: number
          monthly_tokens_used: number
          hourly_cost_used: number
          daily_cost_used: number
          monthly_cost_used: number
        }[]
        resetTimes: {
          hourly_resets_in: number
          daily_resets_in: number
          monthly_resets_in: number
        }
      }>

      // Dependencies
      getDependenciesByProject: () => Promise<{
        dependencies: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: CardStatus[]
          required_status: CardStatus
          is_active: number
          created_at: string
          updated_at: string
        }[]
        error?: string
      }>

      // Agent Chat
      getChatMessages: (jobId: string, limit?: number) => Promise<{
        messages: {
          id: string
          job_id: string
          card_id: string
          project_id: string
          role: 'user' | 'agent' | 'system'
          content: string
          status: 'sent' | 'delivered' | 'read' | 'error'
          metadata_json?: string
          created_at: string
          updated_at?: string
        }[]
        error?: string
      }>
      sendChatMessage: (params: {
        jobId: string
        cardId: string
        content: string
        metadata?: Record<string, unknown>
      }) => Promise<{
        message: {
          id: string
          job_id: string
          card_id: string
          project_id: string
          role: 'user' | 'agent' | 'system'
          content: string
          status: 'sent' | 'delivered' | 'read' | 'error'
          metadata_json?: string
          created_at: string
          updated_at?: string
        }
        error?: string
      }>
      markChatAsRead: (jobId: string) => Promise<{ success: boolean; error?: string }>
      clearChatHistory: (jobId: string) => Promise<{ success: boolean; count: number; error?: string }>
      onChatMessage: (callback: (data: {
        type: string
        message: {
          id: string
          job_id: string
          card_id: string
          project_id: string
          role: 'user' | 'agent' | 'system'
          content: string
          status: 'sent' | 'delivered' | 'read' | 'error'
          metadata_json?: string
          created_at: string
          updated_at?: string
        }
        jobId: string
      }) => void) => () => void

      // Card operations
      editCardBody: (cardId: string, body: string | null) => Promise<{ card?: Card; error?: string }>
      deleteCard: (cardId: string) => Promise<{ success: boolean; error?: string }>

      // Card Dependencies
      getDependenciesForCardWithCards: (cardId: string) => Promise<{
        dependencies: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: CardStatus[]
          required_status: CardStatus
          is_active: number
          created_at: string
          updated_at: string
          depends_on_card?: {
            id: string
            project_id: string
            title: string
            status: CardStatus
          }
        }[]
        error?: string
      }>
      getDependentsOfCard: (cardId: string) => Promise<{
        dependencies: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: CardStatus[]
          required_status: CardStatus
          is_active: number
          created_at: string
          updated_at: string
        }[]
        error?: string
      }>
      checkWouldCreateCycle: (cardId: string, dependsOnCardId: string) => Promise<{
        wouldCreateCycle: boolean
        error?: string
      }>
      createDependency: (data: {
        cardId: string
        dependsOnCardId: string
        blockingStatuses?: CardStatus[]
        requiredStatus?: CardStatus
      }) => Promise<{
        dependency: {
          id: string
          project_id: string
          card_id: string
          depends_on_card_id: string
          blocking_statuses: CardStatus[]
          required_status: CardStatus
          is_active: number
          created_at: string
          updated_at: string
        } | null
        error?: string
      }>
      deleteDependency: (dependencyId: string) => Promise<{ success: boolean; error?: string }>
      toggleDependency: (dependencyId: string, isActive: boolean) => Promise<{ success: boolean; error?: string }>

      // Feature Suggestions
      getFeatureSuggestions: (options?: {
        status?: 'open' | 'in_progress' | 'completed' | 'rejected'
        category?: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
        sortBy?: 'vote_count' | 'created_at' | 'priority' | 'updated_at'
        sortOrder?: 'asc' | 'desc'
        limit?: number
        offset?: number
      }) => Promise<{
        suggestions: {
          id: string
          project_id: string
          title: string
          description: string
          category: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
          priority: number
          vote_count: number
          status: 'open' | 'in_progress' | 'completed' | 'rejected'
          created_by?: string
          created_at: string
          updated_at: string
        }[]
        error?: string
      }>
      createFeatureSuggestion: (data: {
        title: string
        description: string
        category?: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
        priority?: number
        createdBy?: string
      }) => Promise<{
        suggestion: {
          id: string
          project_id: string
          title: string
          description: string
          category: 'ui' | 'performance' | 'feature' | 'bug' | 'documentation' | 'other'
          priority: number
          vote_count: number
          status: 'open' | 'in_progress' | 'completed' | 'rejected'
          created_by?: string
          created_at: string
          updated_at: string
        } | null
        error?: string
      }>
      voteOnSuggestion: (suggestionId: string, voteType: 'up' | 'down', voterId?: string) => Promise<{
        voteCount: number
        userVote: 'up' | 'down' | null
        error?: string
      }>
      deleteFeatureSuggestion: (suggestionId: string) => Promise<{ success: boolean; error?: string }>

      // Diff viewer
      getDiffFiles: (worktreeId: string) => Promise<{
        files: {
          path: string
          status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
          additions: number
          deletions: number
          oldPath?: string
        }[]
        error?: string
      }>
      getFileDiff: (worktreeId: string, filePath: string) => Promise<{
        diff: {
          filePath: string
          oldContent: string
          newContent: string
          status: 'added' | 'modified' | 'deleted' | 'renamed'
          additions: number
          deletions: number
        } | null
        error?: string
      }>
    }

  }
}

interface ProjectInfo {
  projectId: string
  projectKey: string
  projectPath: string
}

function readShowPullRequestsSection(project: Project | null): boolean {
  if (!project?.policy_json) return false
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return !!policy?.ui?.showPullRequestsSection
  } catch {
    return false
  }
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
  const [workspaceStatus, setWorkspaceStatus] = useState<FlowPatchWorkspaceStatus | null>(null)
  const [workspaceStatusLoading, setWorkspaceStatusLoading] = useState(false)
  const [featureSuggestionsOpen, setFeatureSuggestionsOpen] = useState(false)
  const [graphViewOpen, setGraphViewOpen] = useState(false)
  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<PlanApproval | null>(null)
  const [approvalCard, setApprovalCard] = useState<Card | null>(null)
  const [splitDialogOpen, setSplitDialogOpen] = useState(false)
  const [splitDialogCard, setSplitDialogCard] = useState<Card | null>(null)

  // Audio notifications - read config from project policy
  const notificationsConfig = useMemo(() => {
    if (!project?.policy_json) {
      return {
        audioEnabled: false,
        soundOnComplete: true,
        soundOnError: true,
        soundOnApproval: true
      }
    }
    try {
      const policy = JSON.parse(project.policy_json)
      return {
        audioEnabled: policy?.features?.notifications?.audioEnabled ?? false,
        soundOnComplete: policy?.features?.notifications?.soundOnComplete ?? true,
        soundOnError: policy?.features?.notifications?.soundOnError ?? true,
        soundOnApproval: policy?.features?.notifications?.soundOnApproval ?? true
      }
    } catch {
      return {
        audioEnabled: false,
        soundOnComplete: true,
        soundOnError: true,
        soundOnApproval: true
      }
    }
  }, [project?.policy_json])

  // Use audio notifications hook to play sounds on job state changes
  const { initializeAudio } = useAudioNotifications({
    config: notificationsConfig,
    jobs,
    enabled: notificationsConfig.audioEnabled
  })

  // Track dev server status for cards
  const cardIds = useMemo(() => cards.map((c) => c.id), [cards])
  const { isRunning, getStatus } = useDevServerStatus(cardIds)

  // Build dev server status map for cards
  const devServerStatusByCardId = useMemo(() => {
    const statusMap: Record<string, { isRunning: boolean; port?: number; status?: 'starting' | 'running' | 'stopped' | 'error' }> = {}
    cards.forEach((card) => {
      if (isRunning(card.id)) {
        const status = getStatus(card.id)
        statusMap[card.id] = {
          isRunning: true,
          port: status?.port,
          status: status?.status || undefined
        }
      }
    })
    return statusMap
  }, [cards, isRunning, getStatus])

  // Initialize audio on first user interaction
  useEffect(() => {
    const handleUserInteraction = (): void => {
      initializeAudio()
      window.removeEventListener('click', handleUserInteraction)
      window.removeEventListener('keydown', handleUserInteraction)
    }
    window.addEventListener('click', handleUserInteraction)
    window.addEventListener('keydown', handleUserInteraction)
    return () => {
      window.removeEventListener('click', handleUserInteraction)
      window.removeEventListener('keydown', handleUserInteraction)
    }
  }, [initializeAudio])

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

  // Show Pull Requests Section setting
  const showPullRequestsSection = readShowPullRequestsSection(project)

  const linkedPrIndex = useMemo(() => buildLinkedPullRequestIndex(cardLinks), [cardLinks])

  // Pull request cards for the PR section (unlinked PRs/MRs only)
  const pullRequestCards = useMemo(
    () =>
      cards.filter(
        (c) => (c.type === 'pr' || c.type === 'mr') && !isLinkedPullRequestCard(c, linkedPrIndex)
      ),
    [cards, linkedPrIndex]
  )

  // Board cards - filter out PRs when showing in separate section
  const visibleCards = useMemo(
    () =>
      filterOutLinkedPullRequestCards(
        showPullRequestsSection
          ? cards.filter((c) => c.type !== 'pr' && c.type !== 'mr')
          : cards,
        linkedPrIndex
      ),
    [cards, linkedPrIndex, showPullRequestsSection]
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
    const unsubscribe = window.projectAPI.onStateUpdate(async () => {
      refreshData() // Use refreshData instead of loadData to avoid loading flash
      void refreshWorkspaceStatus() // Use refresh to avoid loading flash
      // Refresh project to get updated policy (e.g., showPullRequestsSection toggle)
      if (projectInfo) {
        try {
          const projectData = await window.projectAPI.getProject(projectInfo.projectId)
          setProject(projectData)
        } catch (error) {
          console.error('Failed to refresh project:', error)
        }
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

  // Listen for plan approval requests
  useEffect(() => {
    const unsubscribe = window.projectAPI.onPlanApprovalRequired(async (data) => {
      try {
        const approval = await window.projectAPI.getPlanApproval({ approvalId: data.approvalId })
        if (approval) {
          setPendingApproval(approval)
          const card = cards.find(c => c.id === data.cardId) ?? null
          setApprovalCard(card)
        }
      } catch (error) {
        console.error('Failed to load plan approval:', error)
      }
    })
    return unsubscribe
  }, [cards])

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

  const handleOpenSplitDialog = useCallback((card: Card): void => {
    setSplitDialogCard(card)
    setSplitDialogOpen(true)
  }, [])

  // Follow-up instruction handler
  const handleFollowUpSubmit = useCallback(async (data: {
    jobId: string
    cardId: string
    instructionType: FollowUpInstructionType
    content: string
    priority?: number
  }): Promise<void> => {
    await window.projectAPI.createFollowUpInstruction({
      jobId: data.jobId,
      cardId: data.cardId,
      instructionType: data.instructionType,
      content: data.content,
      priority: data.priority
    })
  }, [])

  // Plan approval handlers
  const handleApprovePlan = useCallback(async (approvalId: string, notes?: string): Promise<void> => {
    await window.projectAPI.approvePlan(approvalId, notes)
    setPendingApproval(null)
    setApprovalCard(null)
  }, [])

  const handleRejectPlan = useCallback(async (approvalId: string, notes?: string): Promise<void> => {
    await window.projectAPI.rejectPlan(approvalId, notes)
    setPendingApproval(null)
    setApprovalCard(null)
  }, [])

  const handleSkipApproval = useCallback(async (approvalId: string): Promise<void> => {
    await window.projectAPI.skipPlanApproval(approvalId)
    setPendingApproval(null)
    setApprovalCard(null)
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
            title="Open .flowpatch folder"
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

          <Button
            variant="outline"
            size="sm"
            onClick={() => setFollowUpDialogOpen(true)}
            disabled={!activeWorkerJob}
            title="Send instruction to worker"
          >
            <Send className="mr-2 h-4 w-4" />
            Instruct
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setFeatureSuggestionsOpen(true)}
            title="Feature Suggestions"
          >
            <Lightbulb className="mr-2 h-4 w-4" />
            Ideas
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setGraphViewOpen(true)}
            title="Dependency Graph"
          >
            <Network className="mr-2 h-4 w-4" />
            Graph
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
        {/* Pull Requests Section (when enabled) */}
        {showPullRequestsSection && (
          <PullRequestsSection
            cards={pullRequestCards}
            selectedCardId={selectedCardId}
            onSelectCard={setSelectedCardId}
          />
        )}

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
            onSplitCard={handleOpenSplitDialog}
            devServerStatusByCardId={devServerStatusByCardId}
          />
        </div>

        {/* Card Dialog */}
        <CardDialog
          card={selectedCard}
          linkedPRs={selectedCard ? cardLinksByCardId[selectedCard.id] ?? [] : []}
          events={[]} // TODO: Load events for card
          projectId={projectInfo?.projectId ?? null}
          onClose={handleCloseDrawer}
          onMoveCard={handleMoveCard}
          onRunWorker={(cardId) => window.projectAPI.runWorker(cardId)}
          onSplitCard={handleOpenSplitDialog}
        />
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

      <FollowUpInstructionDialog
        open={followUpDialogOpen}
        onOpenChange={setFollowUpDialogOpen}
        job={activeWorkerJob ?? null}
        card={cardForLogs}
        onSubmit={handleFollowUpSubmit}
      />

      <PlanApprovalDialog
        open={!!pendingApproval}
        onOpenChange={(open) => {
          if (!open) {
            setPendingApproval(null)
            setApprovalCard(null)
          }
        }}
        approval={pendingApproval}
        card={approvalCard}
        onApprove={handleApprovePlan}
        onReject={handleRejectPlan}
        onSkip={handleSkipApproval}
      />

      {splitDialogCard && (
        <SplitCardDialog
          open={splitDialogOpen}
          onOpenChange={(open) => {
            setSplitDialogOpen(open)
            if (!open) setSplitDialogCard(null)
          }}
          projectId={projectInfo?.projectId ?? ''}
          card={splitDialogCard}
        />
      )}

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

      {/* Feature Suggestions Dialog */}
      <FeatureSuggestionsDialog
        open={featureSuggestionsOpen}
        onOpenChange={setFeatureSuggestionsOpen}
        projectId={projectInfo.projectId}
        hasRemote={!!project?.remote_repo_key}
        remoteProvider={project?.provider_hint ?? null}
      />

      {/* Graph View Dialog */}
      <GraphViewDialog
        open={graphViewOpen}
        onOpenChange={setGraphViewOpen}
        onSelectCard={(cardId) => {
          setSelectedCardId(cardId)
          setGraphViewOpen(false)
        }}
      />

      <Toaster />
    </div>
  )
}
