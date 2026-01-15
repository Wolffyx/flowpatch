/**
 * Shell Tabs Hook
 *
 * Manages tab state and operations
 */

import { useState, useEffect, useCallback } from 'react'
import type { TabData } from '../components/TabBar'

interface UseShellTabsReturn {
  /** Current tabs */
  tabs: TabData[]
  /** ID of the currently active tab */
  activeTabId: string | null
  /** Whether the home view is shown */
  showHome: boolean
  /** Set whether the home view is shown */
  setShowHome: (show: boolean) => void
  /** Load tabs from the shell API */
  loadTabs: () => Promise<void>
  /** Handle tab click */
  handleTabClick: (tabId: string) => Promise<void>
  /** Handle tab close */
  handleTabClose: (tabId: string) => Promise<void>
  /** Handle new tab button click (shows home view) */
  handleNewTab: () => Promise<void>
  /** Handle tab move (drag and drop) */
  handleTabMove: (tabId: string, newIndex: number) => Promise<void>
  /** Close all other tabs */
  handleCloseOthers: (tabId: string) => Promise<void>
  /** Close tabs to the right */
  handleCloseToRight: (tabId: string) => Promise<void>
  /** Duplicate a tab */
  handleDuplicateTab: (tabId: string) => Promise<void>
}

export function useShellTabs(): UseShellTabsReturn {
  const [tabs, setTabs] = useState<TabData[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showHome, setShowHome] = useState(true)

  const loadTabs = useCallback(async (): Promise<void> => {
    try {
      const state = await window.shellAPI.getTabs()
      setTabs(
        state.tabs.map((t) => ({
          id: t.id,
          projectId: t.projectId,
          projectName: t.projectName
        }))
      )
      setActiveTabId(state.activeTabId)
      // Show home if no tabs
      if (state.tabs.length === 0) {
        setShowHome(true)
      }
    } catch (error) {
      console.error('Failed to load tabs:', error)
    }
  }, [])

  const handleTabClick = useCallback(async (tabId: string): Promise<void> => {
    try {
      await window.shellAPI.activateTab(tabId)
      setShowHome(false)
    } catch (error) {
      console.error('Failed to activate tab:', error)
    }
  }, [])

  const handleTabClose = useCallback(async (tabId: string): Promise<void> => {
    try {
      await window.shellAPI.closeTab(tabId)
    } catch (error) {
      console.error('Failed to close tab:', error)
    }
  }, [])

  const handleNewTab = useCallback(async (): Promise<void> => {
    await window.shellAPI.deactivateAllTabs()
    setShowHome(true)
  }, [])

  const handleTabMove = useCallback(async (tabId: string, newIndex: number): Promise<void> => {
    try {
      await window.shellAPI.moveTab(tabId, newIndex)
    } catch (error) {
      console.error('Failed to move tab:', error)
    }
  }, [])

  const handleCloseOthers = useCallback(async (tabId: string): Promise<void> => {
    try {
      await window.shellAPI.closeOtherTabs(tabId)
    } catch (error) {
      console.error('Failed to close other tabs:', error)
    }
  }, [])

  const handleCloseToRight = useCallback(async (tabId: string): Promise<void> => {
    try {
      await window.shellAPI.closeTabsToRight(tabId)
    } catch (error) {
      console.error('Failed to close tabs to right:', error)
    }
  }, [])

  const handleDuplicateTab = useCallback(async (tabId: string): Promise<void> => {
    try {
      await window.shellAPI.duplicateTab(tabId)
    } catch (error) {
      console.error('Failed to duplicate tab:', error)
    }
  }, [])

  // Subscribe to tab changes
  useEffect(() => {
    const unsubscribe = window.shellAPI.onTabsChanged((state) => {
      setTabs(
        state.tabs.map((t) => ({
          id: t.id,
          projectId: t.projectId,
          projectName: t.projectName
        }))
      )
      setActiveTabId(state.activeTabId)
      // Hide home when a tab is activated
      if (state.activeTabId) {
        setShowHome(false)
      }
    })
    return unsubscribe
  }, [])

  return {
    tabs,
    activeTabId,
    showHome,
    setShowHome,
    loadTabs,
    handleTabClick,
    handleTabClose,
    handleNewTab,
    handleTabMove,
    handleCloseOthers,
    handleCloseToRight,
    handleDuplicateTab
  }
}
