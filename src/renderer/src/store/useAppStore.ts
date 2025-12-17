import { useState, useCallback, useEffect } from 'react'
import type {
  Project,
  Card,
  Event,
  Job,
  CardStatus,
  RemoteInfo,
  AppState
} from '../../../shared/types'

export interface ProjectData {
  project: Project
  cards: Card[]
  events: Event[]
  jobs: Job[]
}

export interface AppStore {
  projects: ProjectData[]
  selectedProjectId: string | null
  selectedCardId: string | null
  isLoading: boolean
  error: string | null

  // Remote selection dialog state
  pendingRemoteSelection: {
    project: Project
    remotes: RemoteInfo[]
  } | null

  // Actions
  loadState: () => Promise<void>
  selectProject: (id: string | null) => void
  selectCard: (id: string | null) => void
  openRepo: () => Promise<void>
  selectRemote: (remoteName: string, remoteUrl: string, repoKey: string) => Promise<void>
  cancelRemoteSelection: () => void
  moveCard: (cardId: string, status: CardStatus) => Promise<void>
  createTestCard: (title: string) => Promise<void>
  createCard: (data: {
    title: string
    body: string
    createType: 'local' | 'github_issue'
  }) => Promise<void>
  syncProject: () => Promise<void>
  toggleWorker: (enabled: boolean) => Promise<void>
  runWorker: (cardId?: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>

  // Getters
  getSelectedProject: () => ProjectData | null
  getSelectedCard: () => Card | null
}

export function useAppStore(): AppStore {
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingRemoteSelection, setPendingRemoteSelection] = useState<{
    project: Project
    remotes: RemoteInfo[]
  } | null>(null)

  const loadState = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = (await window.electron.ipcRenderer.invoke('getState')) as AppState
      setProjects(result.projects)
      // Auto-select first project if none selected
      if (!selectedProjectId && result.projects.length > 0) {
        setSelectedProjectId(result.projects[0].project.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load state')
    } finally {
      setIsLoading(false)
    }
  }, [selectedProjectId])

  const selectProject = useCallback((id: string | null) => {
    setSelectedProjectId(id)
    setSelectedCardId(null)
  }, [])

  const selectCard = useCallback((id: string | null) => {
    setSelectedCardId(id)
  }, [])

  const openRepo = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.electron.ipcRenderer.invoke('openRepo')
      if (result.canceled) {
        return
      }
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.needSelection && result.remotes) {
        setPendingRemoteSelection({
          project: result.project,
          remotes: result.remotes
        })
      } else {
        await loadState()
        if (result.project) {
          setSelectedProjectId(result.project.id)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open repo')
    } finally {
      setIsLoading(false)
    }
  }, [loadState])

  const selectRemote = useCallback(
    async (remoteName: string, remoteUrl: string, repoKey: string) => {
      if (!pendingRemoteSelection) return
      setIsLoading(true)
      setError(null)
      try {
        const result = await window.electron.ipcRenderer.invoke('selectRemote', {
          projectId: pendingRemoteSelection.project.id,
          remoteName,
          remoteUrl,
          repoKey
        })
        if (result.error) {
          setError(result.error)
          return
        }
        setPendingRemoteSelection(null)
        await loadState()
        if (result.project) {
          setSelectedProjectId(result.project.id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to select remote')
      } finally {
        setIsLoading(false)
      }
    },
    [pendingRemoteSelection, loadState]
  )

  const cancelRemoteSelection = useCallback(() => {
    setPendingRemoteSelection(null)
  }, [])

  const moveCard = useCallback(
    async (cardId: string, status: CardStatus) => {
      try {
        await window.electron.ipcRenderer.invoke('moveCard', { cardId, status })
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to move card')
      }
    },
    [loadState]
  )

  const createTestCard = useCallback(
    async (title: string) => {
      if (!selectedProjectId) return
      try {
        await window.electron.ipcRenderer.invoke('createTestCard', {
          projectId: selectedProjectId,
          title
        })
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create card')
      }
    },
    [selectedProjectId, loadState]
  )

  const createCard = useCallback(
    async (data: { title: string; body: string; createType: 'local' | 'github_issue' }) => {
      if (!selectedProjectId) {
        throw new Error('No project selected')
      }
      const result = await window.electron.ipcRenderer.invoke('createCard', {
        projectId: selectedProjectId,
        title: data.title,
        body: data.body || undefined,
        createType: data.createType
      })
      if (result.error) {
        throw new Error(result.error)
      }
      await loadState()
    },
    [selectedProjectId, loadState]
  )

  const syncProject = useCallback(async () => {
    if (!selectedProjectId) return
    setIsLoading(true)
    try {
      await window.electron.ipcRenderer.invoke('syncProject', { projectId: selectedProjectId })
      await loadState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync project')
    } finally {
      setIsLoading(false)
    }
  }, [selectedProjectId, loadState])

  const toggleWorker = useCallback(
    async (enabled: boolean) => {
      if (!selectedProjectId) return
      try {
        await window.electron.ipcRenderer.invoke('toggleWorker', {
          projectId: selectedProjectId,
          enabled
        })
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to toggle worker')
      }
    },
    [selectedProjectId, loadState]
  )

  const runWorker = useCallback(
    async (cardId?: string) => {
      if (!selectedProjectId) return
      try {
        await window.electron.ipcRenderer.invoke('runWorker', {
          projectId: selectedProjectId,
          cardId
        })
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to run worker')
      }
    },
    [selectedProjectId, loadState]
  )

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        await window.electron.ipcRenderer.invoke('deleteProject', { projectId: id })
        if (selectedProjectId === id) {
          setSelectedProjectId(null)
        }
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete project')
      }
    },
    [selectedProjectId, loadState]
  )

  const getSelectedProject = useCallback((): ProjectData | null => {
    if (!selectedProjectId) return null
    return projects.find((p) => p.project.id === selectedProjectId) || null
  }, [projects, selectedProjectId])

  const getSelectedCard = useCallback((): Card | null => {
    if (!selectedCardId || !selectedProjectId) return null
    const project = projects.find((p) => p.project.id === selectedProjectId)
    if (!project) return null
    return project.cards.find((c) => c.id === selectedCardId) || null
  }, [projects, selectedProjectId, selectedCardId])

  // Listen for updates from main process
  useEffect(() => {
    const handleStateUpdate = (): void => {
      loadState()
    }

    window.electron.ipcRenderer.on('stateUpdated', handleStateUpdate)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('stateUpdated')
    }
  }, [loadState])

  // Load state on mount
  useEffect(() => {
    loadState()
  }, [loadState])

  return {
    projects,
    selectedProjectId,
    selectedCardId,
    isLoading,
    error,
    pendingRemoteSelection,
    loadState,
    selectProject,
    selectCard,
    openRepo,
    selectRemote,
    cancelRemoteSelection,
    moveCard,
    createTestCard,
    createCard,
    syncProject,
    toggleWorker,
    runWorker,
    deleteProject,
    getSelectedProject,
    getSelectedCard
  }
}
