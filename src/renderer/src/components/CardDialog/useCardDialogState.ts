import { useState, useEffect, useCallback } from 'react'
import type { Card, Worktree, Job } from '../../../../shared/types'

interface TestInfo {
  success: boolean
  hasWorktree?: boolean
  worktreePath?: string
  branchName?: string | null
  repoPath?: string
  projectType?: { type: string; hasPackageJson: boolean; port?: number }
  commands?: { install?: string; dev?: string; build?: string }
  error?: string
}

export function useCardDialogState(card: Card | null, projectId: string | null) {
  const [worktree, setWorktree] = useState<Worktree | null>(null)
  const [worktreeLoading, setWorktreeLoading] = useState(false)
  const [latestJob, setLatestJob] = useState<Job | null>(null)
  const [activeTab, setActiveTab] = useState('details')

  // Description editor state
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [isSavingDescription, setIsSavingDescription] = useState(false)

  // Delete state
  const [isDeletingCard, setIsDeletingCard] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Test dialog state
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testInfo, setTestInfo] = useState<TestInfo | null>(null)
  const [checkingTestInfo, setCheckingTestInfo] = useState(false)

  // Dialog state
  const [diffDialogOpen, setDiffDialogOpen] = useState(false)
  const [chatDialogOpen, setChatDialogOpen] = useState(false)

  // Load worktree and job data
  useEffect(() => {
    if (!card || !projectId) {
      setWorktree(null)
      setLatestJob(null)
      return
    }

    const loadData = async (): Promise<void> => {
      try {
        const worktrees = (await window.electron.ipcRenderer.invoke(
          'listWorktrees',
          projectId
        )) as Worktree[]
        const cardWorktree = worktrees.find(
          (wt) => wt.card_id === card.id && wt.status !== 'cleaned'
        )
        setWorktree(cardWorktree ?? null)

        const jobs = (await window.projectAPI.getJobs()) as Job[]
        const cardJobs = jobs.filter((j) => j.card_id === card.id)
        if (cardJobs.length > 0) {
          cardJobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          setLatestJob(cardJobs[0])
        } else {
          setLatestJob(null)
        }
      } catch {
        setWorktree(null)
        setLatestJob(null)
      }
    }

    loadData()
  }, [card?.id, projectId])

  // Reset state when card changes
  useEffect(() => {
    setIsEditingDescription(false)
    setShowDeleteConfirm(false)
    setActiveTab('details')
  }, [card?.id])

  // Worktree actions
  const handleOpenWorktreeFolder = useCallback(async () => {
    if (!worktree) return
    await window.electron.ipcRenderer.invoke('openWorktreeFolder', worktree.worktree_path)
  }, [worktree])

  const handleRemoveWorktree = useCallback(async () => {
    if (!worktree) return
    setWorktreeLoading(true)
    try {
      await window.electron.ipcRenderer.invoke('removeWorktree', worktree.id)
      setWorktree(null)
    } finally {
      setWorktreeLoading(false)
    }
  }, [worktree])

  const handleRecreateWorktree = useCallback(async () => {
    if (!worktree || !projectId || !card) return
    setWorktreeLoading(true)
    try {
      await window.electron.ipcRenderer.invoke('recreateWorktree', worktree.id)
      const worktrees = (await window.electron.ipcRenderer.invoke(
        'listWorktrees',
        projectId
      )) as Worktree[]
      const cardWorktree = worktrees.find((wt) => wt.card_id === card.id && wt.status !== 'cleaned')
      setWorktree(cardWorktree ?? null)
    } finally {
      setWorktreeLoading(false)
    }
  }, [worktree, projectId, card])

  // Test dialog
  const handleOpenTestDialog = useCallback(async () => {
    if (!card || !projectId) return

    setCheckingTestInfo(true)
    try {
      if (worktree) {
        setTestInfo({
          success: true,
          hasWorktree: true,
          worktreePath: worktree.worktree_path,
          branchName: worktree.branch_name
        })
        setTestDialogOpen(true)
      } else {
        setTestInfo({
          success: false,
          error: 'No worktree found for this card'
        })
      }
    } catch (error) {
      console.error('Failed to load test info:', error)
      setTestInfo({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setCheckingTestInfo(false)
    }
  }, [card, projectId, worktree])

  // Description editing
  const handleSaveDescription = useCallback(
    async (newDescription: string) => {
      if (!card) return
      setIsSavingDescription(true)
      try {
        const result = await window.projectAPI.editCardBody(card.id, newDescription || null)
        if (result.error) {
          console.error('Failed to save description:', result.error)
        } else {
          setIsEditingDescription(false)
        }
      } catch (error) {
        console.error('Failed to save description:', error)
      } finally {
        setIsSavingDescription(false)
      }
    },
    [card]
  )

  // Delete card
  const handleDeleteCard = useCallback(
    async (onClose: () => void, onCardDeleted?: () => void) => {
      if (!card) return
      setIsDeletingCard(true)
      try {
        const result = await window.projectAPI.deleteCard(card.id)
        if (result.error) {
          console.error('Failed to delete card:', result.error)
        } else {
          setShowDeleteConfirm(false)
          onClose()
          onCardDeleted?.()
        }
      } catch (error) {
        console.error('Failed to delete card:', error)
      } finally {
        setIsDeletingCard(false)
      }
    },
    [card]
  )

  return {
    // State
    worktree,
    worktreeLoading,
    latestJob,
    activeTab,
    isEditingDescription,
    isSavingDescription,
    isDeletingCard,
    showDeleteConfirm,
    testDialogOpen,
    testInfo,
    checkingTestInfo,
    diffDialogOpen,
    chatDialogOpen,

    // Setters
    setActiveTab,
    setIsEditingDescription,
    setShowDeleteConfirm,
    setTestDialogOpen,
    setDiffDialogOpen,
    setChatDialogOpen,

    // Actions
    handleOpenWorktreeFolder,
    handleRemoveWorktree,
    handleRecreateWorktree,
    handleOpenTestDialog,
    handleSaveDescription,
    handleDeleteCard
  }
}
