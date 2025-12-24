/**
 * Projects Hook
 *
 * Manages project list state and project-level operations.
 */

import { useState, useCallback, useEffect } from 'react'
import type {
  Project,
  Card,
  CardLink,
  Event,
  Job,
  RemoteInfo,
  CreateRepoPayload
} from '../../../shared/types'
import type { AppState } from '../../../shared/types/ipc'

export interface ProjectData {
  project: Project
  cards: Card[]
  cardLinks: CardLink[]
  events: Event[]
  jobs: Job[]
}

export interface PendingRemoteSelection {
  project: Project
  remotes: RemoteInfo[]
}

export interface UseProjectsResult {
  // State
  projects: ProjectData[]
  selectedProjectId: string | null
  isLoading: boolean
  error: string | null
  cardLinksByCardId: Record<string, CardLink[]>
  pendingRemoteSelection: PendingRemoteSelection | null

  // Actions
  loadState: () => Promise<void>
  selectProject: (id: string | null) => void
  setSelectedProjectId: (id: string | null) => void
  openRepo: () => Promise<void>
  createRepo: (payload: CreateRepoPayload) => Promise<void>
  selectRemote: (remoteName: string, remoteUrl: string, repoKey: string) => Promise<void>
  cancelRemoteSelection: () => void
  deleteProject: (id: string) => Promise<void>
  setError: (error: string | null) => void
  setIsLoading: (loading: boolean) => void
  setProjects: React.Dispatch<React.SetStateAction<ProjectData[]>>

  // Getters
  getSelectedProject: () => ProjectData | null
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardLinksByCardId, setCardLinksByCardId] = useState<Record<string, CardLink[]>>({})
  const [pendingRemoteSelection, setPendingRemoteSelection] =
    useState<PendingRemoteSelection | null>(null)

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
      // Use functional update to avoid dependency on selectedProjectId
      setSelectedProjectId((current) => {
        if (!current && result.projects.length > 0) {
          return result.projects[0].project.id
        }
        return current
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load state')
    } finally {
      setIsLoading(false)
    }
  }, []) // No dependencies - stable callback reference

  const selectProject = useCallback((id: string | null) => {
    setSelectedProjectId(id)
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
    isLoading,
    error,
    cardLinksByCardId,
    pendingRemoteSelection,
    loadState,
    selectProject,
    setSelectedProjectId,
    openRepo,
    createRepo,
    selectRemote,
    cancelRemoteSelection,
    deleteProject,
    setError,
    setIsLoading,
    setProjects,
    getSelectedProject
  }
}
