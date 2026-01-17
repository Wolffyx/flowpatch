/**
 * Dialog State Hook
 *
 * Manages open/close state for all shell dialogs and panels
 */

import { useState, useEffect } from 'react'

interface UseDialogStateReturn {
  /** Whether the logs panel is open */
  logsPanelOpen: boolean
  setLogsPanelOpen: (open: boolean) => void
  /** Whether the settings modal is open */
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  /** Whether the activity dialog is open */
  activityOpen: boolean
  setActivityOpen: (open: boolean) => void
  /** Whether the chat dialog is open */
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  /** Whether the history dialog is open */
  historyOpen: boolean
  setHistoryOpen: (open: boolean) => void
  /** Whether the repo start dialog is open */
  repoDialogOpen: boolean
  setRepoDialogOpen: (open: boolean) => void
  /** Whether the reset confirm dialog is open */
  resetDialogOpen: boolean
  setResetDialogOpen: (open: boolean) => void
}

export function useDialogState(): UseDialogStateReturn {
  const [logsPanelOpen, setLogsPanelOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [repoDialogOpen, setRepoDialogOpen] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)

  // Notify main process when modal dialogs open/close
  useEffect(() => {
    const anyModalOpen = settingsOpen || repoDialogOpen || activityOpen || chatOpen || historyOpen
    window.shellAPI.setModalOpen(anyModalOpen)
  }, [settingsOpen, repoDialogOpen, activityOpen, chatOpen, historyOpen])

  // Subscribe to dev reset trigger (Ctrl+Shift+R)
  useEffect(() => {
    const unsubscribe = window.shellAPI.onDevResetTrigger(() => {
      setResetDialogOpen(true)
    })
    return unsubscribe
  }, [])

  return {
    logsPanelOpen,
    setLogsPanelOpen,
    settingsOpen,
    setSettingsOpen,
    activityOpen,
    setActivityOpen,
    chatOpen,
    setChatOpen,
    historyOpen,
    setHistoryOpen,
    repoDialogOpen,
    setRepoDialogOpen,
    resetDialogOpen,
    setResetDialogOpen
  }
}
