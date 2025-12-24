/**
 * App Store Hook
 *
 * Composes domain-specific hooks into a single unified store.
 * This is the main entry point for components to access app state.
 *
 * For new code, consider using the domain-specific hooks directly:
 * - useProjects: Project list and selection
 * - useCards: Card operations
 * - useWorker: Worker state and logs
 * - useSync: Sync operations
 * - useUISettings: UI preferences
 */

import { useProjects, type ProjectData } from './useProjects'
import { useCards } from './useCards'
import { useWorker } from './useWorker'
import { useSync } from './useSync'
import { useUISettings } from './useUISettings'
import type {
  Card,
  CardLink,
  CardStatus,
  CreateRepoPayload,
  RemoteInfo
} from '../../../shared/types'

// Re-export ProjectData for backward compatibility
export type { ProjectData } from './useProjects'

export interface AppStore {
  // State
  projects: ProjectData[]
  selectedProjectId: string | null
  selectedCardId: string | null
  isLoading: boolean
  error: string | null
  workerLogsByJobId: Record<string, string[]>
  cardLinksByCardId: Record<string, CardLink[]>

  // Remote selection dialog state
  pendingRemoteSelection: {
    project: { id: string; name: string; local_path: string }
    remotes: RemoteInfo[]
  } | null

  // Actions
  loadState: () => Promise<void>
  selectProject: (id: string | null) => void
  selectCard: (id: string | null) => void
  openRepo: () => Promise<void>
  createRepo: (payload: CreateRepoPayload) => Promise<void>
  selectRemote: (remoteName: string, remoteUrl: string, repoKey: string) => Promise<void>
  cancelRemoteSelection: () => void
  moveCard: (cardId: string, status: CardStatus) => void
  createTestCard: (title: string) => Promise<void>
  createCard: (data: {
    title: string
    body: string
    createType: 'local' | 'github_issue'
  }) => Promise<void>
  createCardsBatch: (items: Array<{ title: string; body: string }>) => Promise<void>
  syncProject: () => Promise<void>
  toggleWorker: (enabled: boolean) => Promise<void>
  setWorkerToolPreference: (toolPreference: 'auto' | 'claude' | 'codex') => Promise<void>
  setWorkerRollbackOnCancel: (rollbackOnCancel: boolean) => Promise<void>
  setShowPullRequestsSection: (showPullRequestsSection: boolean) => Promise<void>
  runWorker: (cardId?: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  clearWorkerLogs: (jobId: string) => void

  // Getters
  getSelectedProject: () => ProjectData | null
  getSelectedCard: () => Card | null
}

/**
 * Main app store hook that composes domain-specific hooks.
 */
export function useAppStore(): AppStore {
  // Use domain-specific hooks
  const projectsHook = useProjects()

  const cardsHook = useCards({
    selectedProjectId: projectsHook.selectedProjectId,
    projects: projectsHook.projects,
    setProjects: projectsHook.setProjects,
    setError: projectsHook.setError,
    loadState: projectsHook.loadState
  })

  const workerHook = useWorker({
    selectedProjectId: projectsHook.selectedProjectId,
    projects: projectsHook.projects,
    setError: projectsHook.setError,
    loadState: projectsHook.loadState
  })

  const syncHook = useSync({
    selectedProjectId: projectsHook.selectedProjectId,
    setIsLoading: projectsHook.setIsLoading,
    setError: projectsHook.setError,
    loadState: projectsHook.loadState
  })

  const uiSettingsHook = useUISettings({
    selectedProjectId: projectsHook.selectedProjectId,
    projects: projectsHook.projects,
    setError: projectsHook.setError,
    loadState: projectsHook.loadState
  })

  // Clear selected card when project changes
  const selectProject = (id: string | null): void => {
    projectsHook.selectProject(id)
    cardsHook.selectCard(null)
  }

  return {
    // State from projects hook
    projects: projectsHook.projects,
    selectedProjectId: projectsHook.selectedProjectId,
    isLoading: projectsHook.isLoading,
    error: projectsHook.error,
    cardLinksByCardId: projectsHook.cardLinksByCardId,
    pendingRemoteSelection: projectsHook.pendingRemoteSelection,

    // State from cards hook
    selectedCardId: cardsHook.selectedCardId,

    // State from worker hook
    workerLogsByJobId: workerHook.workerLogsByJobId,

    // Actions from projects hook
    loadState: projectsHook.loadState,
    selectProject,
    openRepo: projectsHook.openRepo,
    createRepo: projectsHook.createRepo,
    selectRemote: projectsHook.selectRemote,
    cancelRemoteSelection: projectsHook.cancelRemoteSelection,
    deleteProject: projectsHook.deleteProject,

    // Actions from cards hook
    selectCard: cardsHook.selectCard,
    moveCard: cardsHook.moveCard,
    createTestCard: cardsHook.createTestCard,
    createCard: cardsHook.createCard,
    createCardsBatch: cardsHook.createCardsBatch,

    // Actions from worker hook
    toggleWorker: workerHook.toggleWorker,
    setWorkerToolPreference: workerHook.setWorkerToolPreference,
    setWorkerRollbackOnCancel: workerHook.setWorkerRollbackOnCancel,
    runWorker: workerHook.runWorker,
    clearWorkerLogs: workerHook.clearWorkerLogs,

    // Actions from sync hook
    syncProject: syncHook.syncProject,

    // Actions from UI settings hook
    setShowPullRequestsSection: uiSettingsHook.setShowPullRequestsSection,

    // Getters
    getSelectedProject: projectsHook.getSelectedProject,
    getSelectedCard: cardsHook.getSelectedCard
  }
}
