import { useState, useCallback, useEffect } from 'react'
import type {
  Project,
  Card,
  CardLink,
  Event,
  Job,
  CardStatus,
  RemoteInfo,
  AppState,
  PolicyConfig,
  WorkerLogMessage,
  CreateRepoPayload
} from '../../../shared/types'

export interface ProjectData {
  project: Project
  cards: Card[]
  cardLinks: CardLink[]
  events: Event[]
  jobs: Job[]
}

export interface AppStore {
  projects: ProjectData[]
  selectedProjectId: string | null
  selectedCardId: string | null
  isLoading: boolean
  error: string | null
  workerLogsByJobId: Record<string, string[]>
  cardLinksByCardId: Record<string, CardLink[]>

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
  createRepo: (payload: CreateRepoPayload) => Promise<void>
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

export function useAppStore(): AppStore {
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workerLogsByJobId, setWorkerLogsByJobId] = useState<Record<string, string[]>>({})
  const [cardLinksByCardId, setCardLinksByCardId] = useState<Record<string, CardLink[]>>({})
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

      // Build card links lookup map for O(1) access
      const linkMap: Record<string, CardLink[]> = {}
      for (const project of result.projects) {
        const links = project.cardLinks ?? []
        for (const link of links) {
          if (!linkMap[link.card_id]) linkMap[link.card_id] = []
          linkMap[link.card_id].push(link)
        }
      }
      setCardLinksByCardId(linkMap)

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

  const createRepo = useCallback(
    async (payload: CreateRepoPayload) => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await window.electron.ipcRenderer.invoke('createRepo', payload)
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
        setError(err instanceof Error ? err.message : 'Failed to create repo')
      } finally {
        setIsLoading(false)
      }
    },
    [loadState]
  )

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

  const setWorkerToolPreference = useCallback(
    async (toolPreference: 'auto' | 'claude' | 'codex') => {
      if (!selectedProjectId) return
      try {
        const currentProject = projects.find((p) => p.project.id === selectedProjectId)?.project
        let policy: PolicyConfig | null = null
        if (currentProject?.policy_json) {
          try {
            policy = JSON.parse(currentProject.policy_json) as PolicyConfig
          } catch {
            policy = null
          }
        }

        const existingPreference = policy?.worker?.toolPreference ?? 'auto'
        if (existingPreference === toolPreference) return

        const result = await window.electron.ipcRenderer.invoke('setWorkerToolPreference', {
          projectId: selectedProjectId,
          toolPreference
        })
        if (result?.error) {
          setError(result.error)
          return
        }
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update worker settings')
      }
    },
    [selectedProjectId, projects, loadState]
  )

  const setWorkerRollbackOnCancel = useCallback(
    async (rollbackOnCancel: boolean) => {
      if (!selectedProjectId) return
      try {
        const currentProject = projects.find((p) => p.project.id === selectedProjectId)?.project
        let policy: PolicyConfig | null = null
        if (currentProject?.policy_json) {
          try {
            policy = JSON.parse(currentProject.policy_json) as PolicyConfig
          } catch {
            policy = null
          }
        }

        const existingValue = policy?.worker?.rollbackOnCancel ?? false
        if (existingValue === rollbackOnCancel) return

        const result = await window.electron.ipcRenderer.invoke('setWorkerRollbackOnCancel', {
          projectId: selectedProjectId,
          rollbackOnCancel
        })
        if (result?.error) {
          setError(result.error)
          return
        }
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update worker settings')
      }
    },
    [selectedProjectId, projects, loadState]
  )

  const setShowPullRequestsSection = useCallback(
    async (showPullRequestsSection: boolean) => {
      if (!selectedProjectId) return
      try {
        const currentProject = projects.find((p) => p.project.id === selectedProjectId)?.project
        let policy: PolicyConfig | null = null
        if (currentProject?.policy_json) {
          try {
            policy = JSON.parse(currentProject.policy_json) as PolicyConfig
          } catch {
            policy = null
          }
        }

        const existingValue = policy?.ui?.showPullRequestsSection ?? false
        if (existingValue === showPullRequestsSection) return

        const result = await window.electron.ipcRenderer.invoke('setShowPullRequestsSection', {
          projectId: selectedProjectId,
          showPullRequestsSection
        })
        if (result?.error) {
          setError(result.error)
          return
        }
        await loadState()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update board settings')
      }
    },
    [selectedProjectId, projects, loadState]
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

  const clearWorkerLogs = useCallback((jobId: string) => {
    setWorkerLogsByJobId((prev) => {
      if (!(jobId in prev)) return prev
      const next = { ...prev }
      delete next[jobId]
      return next
    })
  }, [])

  // Listen for updates from main process
  useEffect(() => {
    const handleStateUpdate = (): void => {
      loadState()
    }

    const handleWorkerLog = (_event: unknown, payload: WorkerLogMessage): void => {
      if (!payload?.jobId || !payload?.line) return
      setWorkerLogsByJobId((prev) => {
        const existing = prev[payload.jobId] ?? []
        const nextLines = [...existing, payload.line].slice(-1000)
        return { ...prev, [payload.jobId]: nextLines }
      })
    }

    window.electron.ipcRenderer.on('stateUpdated', handleStateUpdate)
    window.electron.ipcRenderer.on('workerLog', handleWorkerLog)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('stateUpdated')
      window.electron.ipcRenderer.removeAllListeners('workerLog')
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
    workerLogsByJobId,
    cardLinksByCardId,
    pendingRemoteSelection,
    loadState,
    selectProject,
    selectCard,
    openRepo,
    createRepo,
    selectRemote,
    cancelRemoteSelection,
    moveCard,
    createTestCard,
    createCard,
    syncProject,
    toggleWorker,
    setWorkerToolPreference,
    setWorkerRollbackOnCancel,
    setShowPullRequestsSection,
    runWorker,
    deleteProject,
    clearWorkerLogs,
    getSelectedProject,
    getSelectedCard
  }
}
