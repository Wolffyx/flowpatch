/**
 * Cards Hook
 *
 * Manages card operations: selection, creation, and movement.
 */

import { useState, useCallback } from 'react'
import type { Card, CardStatus } from '../../../shared/types'
import type { ProjectData } from './useProjects'

export interface UseCardsOptions {
  selectedProjectId: string | null
  projects: ProjectData[]
  setProjects: React.Dispatch<React.SetStateAction<ProjectData[]>>
  setError: (error: string | null) => void
  loadState: () => Promise<void>
}

export interface UseCardsResult {
  // State
  selectedCardId: string | null

  // Actions
  selectCard: (id: string | null) => void
  moveCard: (cardId: string, status: CardStatus) => void
  createTestCard: (title: string) => Promise<void>
  createCard: (data: {
    title: string
    body: string
    createType: 'local' | 'github_issue'
  }) => Promise<void>
  createCardsBatch: (items: Array<{ title: string; body: string }>) => Promise<void>

  // Getters
  getSelectedCard: () => Card | null
}

export function useCards(options: UseCardsOptions): UseCardsResult {
  const { selectedProjectId, projects, setProjects, setError, loadState } = options
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)

  const selectCard = useCallback((id: string | null) => {
    setSelectedCardId(id)
  }, [])

  const moveCard = useCallback(
    (cardId: string, status: CardStatus) => {
      // Optimistic update - update local state immediately for instant UI feedback
      setProjects((prevProjects) =>
        prevProjects.map((projectData) => ({
          ...projectData,
          cards: projectData.cards.map((card) =>
            card.id === cardId
              ? { ...card, status, updated_local_at: new Date().toISOString() }
              : card
          )
        }))
      )

      // Fire-and-forget IPC call - don't block UI, backend syncs asynchronously
      window.electron.ipcRenderer.invoke('moveCard', { cardId, status }).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to sync card move')
      })
    },
    [setProjects, setError]
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
    [selectedProjectId, loadState, setError]
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

  const createCardsBatch = useCallback(
    async (items: Array<{ title: string; body: string }>) => {
      if (!selectedProjectId) {
        throw new Error('No project selected')
      }
      for (const item of items) {
        const result = await window.electron.ipcRenderer.invoke('createCard', {
          projectId: selectedProjectId,
          title: item.title,
          body: item.body || undefined,
          createType: 'local'
        })
        if (result?.error) {
          throw new Error(result.error)
        }
      }
      await loadState()
    },
    [loadState, selectedProjectId]
  )

  const getSelectedCard = useCallback((): Card | null => {
    if (!selectedCardId || !selectedProjectId) return null
    const project = projects.find((p) => p.project.id === selectedProjectId)
    if (!project) return null
    return project.cards.find((c) => c.id === selectedCardId) || null
  }, [projects, selectedProjectId, selectedCardId])

  return {
    selectedCardId,
    selectCard,
    moveCard,
    createTestCard,
    createCard,
    createCardsBatch,
    getSelectedCard
  }
}
