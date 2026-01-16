/**
 * Shell API Type Declarations
 *
 * Global type definitions for the shell renderer's IPC API
 */

import type { Project, Job } from '@shared/types'
import type { TabState, TabManagerState } from './tab'
import type { LogEntry } from './log'

declare global {
  interface Window {
    shellAPI: {
      // Tab operations
      createTab: (projectId: string, projectPath: string) => Promise<TabState>
      closeTab: (tabId: string) => Promise<void>
      activateTab: (tabId: string) => Promise<void>
      deactivateAllTabs: () => Promise<void>
      getTabs: () => Promise<TabManagerState>
      moveTab: (tabId: string, newIndex: number) => Promise<void>
      closeOtherTabs: (tabId: string) => Promise<void>
      closeTabsToRight: (tabId: string) => Promise<void>
      duplicateTab: (tabId: string) => Promise<TabState | null>
      onTabsChanged: (callback: (state: TabManagerState) => void) => () => void

      // Project operations
      openProject: (projectRoot: string) => Promise<{
        canceled?: boolean
        error?: string
        project?: Project
        tabId?: string
        needSelection?: boolean
      }>
      getProjects: () => Promise<Project[]>
      deleteProject: (projectId: string) => Promise<{ deleted: boolean }>
      selectDirectory: () => Promise<{
        canceled?: boolean
        error?: string
        path?: string
      }>

      // Activity
      getActivity: () => Promise<{
        totalActiveRuns: number
        isBusy: boolean
        busyProjects: string[]
      }>
      onActivityUpdate: (
        callback: (activity: {
          projectId: string
          activeRuns: number
          isBusy: boolean
          lastUpdated: string
        }) => void
      ) => () => void

      // Jobs (Activity feed)
      getRecentJobs: (limit?: number) => Promise<Job[]>
      onStateUpdated: (callback: () => void) => () => void

      // Logs
      getLogs: (projectKey?: string) => Promise<LogEntry[]>
      onLogEntry: (callback: (entry: LogEntry) => void) => () => void
      exportLogs: (projectKey?: string) => Promise<string>

      // Settings
      getDefaults: () => Promise<Record<string, string | null>>
      setDefaults: (patch: Record<string, string | null>) => Promise<void>
      getProjectSettings: (projectKey: string) => Promise<Record<string, string | null>>
      setProjectOverride: (
        projectKey: string,
        patch: Record<string, string | null>
      ) => Promise<void>

      // Shortcuts
      getShortcuts: () => Promise<import('@shared/shortcuts').ShortcutBinding[]>
      setShortcuts: (patch: Record<string, string | null>) => Promise<void>
      onShortcutsUpdated: (callback: () => void) => () => void

      // Window controls
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void

      // UI Layer Management
      setLogsPanelHeight: (height: number) => void
      setModalOpen: (open: boolean) => void

      // Theme
      getThemePreference: () => Promise<'light' | 'dark' | 'system'>
      setThemePreference: (theme: 'light' | 'dark' | 'system') => Promise<void>
      getSystemTheme: () => Promise<'light' | 'dark'>

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
        projectId: string
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

      // App Reset (Dev only)
      resetEverything: () => Promise<{ success: boolean; error?: string }>
      onDevResetTrigger: (callback: () => void) => () => void

      // Auto-Updater
      getUpdateStatus: () => Promise<UpdateStatus>
      getAppVersion: () => Promise<string>
      checkForUpdates: () => Promise<{ success: boolean }>
      downloadUpdate: () => Promise<{ success: boolean }>
      installUpdate: () => Promise<{ success: boolean }>
      onUpdateStatusChanged: (callback: (status: UpdateStatus) => void) => () => void
    }
  }
}

// Auto-Updater types
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  releaseDate?: string
  downloadProgress?: number
  error?: string
}

export {}
