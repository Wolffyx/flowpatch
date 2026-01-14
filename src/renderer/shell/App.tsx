/**
 * Shell Application with Chrome-like Tabs
 *
 * The main shell renderer that hosts:
 * - Tab bar for multiple open projects
 * - Home view with recent projects and Open/Create dialog
 * - Logs panel (collapsible)
 * - Settings modal
 * - Area for WebContentsView (project renderers)
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { ShellToaster } from './components/ShellToaster'
import { TabBar, type TabData } from './components/TabBar'
import { LogsPanel } from './components/LogsPanel'
import { SettingsModal } from './components/settings'
import { ResetConfirmDialog } from './components/settings/ResetConfirmDialog'
import { ActivityDialog } from './components/ActivityDialog'
import { RepoStartDialog } from '../src/components/RepoStartDialog'
import { HomeView } from './components/HomeView'
import { Settings, Terminal, Minus, Square, X, Home, ListChecks, MessageSquare, History } from 'lucide-react'
import { Button } from '../src/components/ui/button'
import { Badge } from '../src/components/ui/badge'
import { GlobalAgentChatDialog } from './components/GlobalAgentChatDialog'
import { SessionHistoryDialog } from './components/SessionHistoryDialog'
import type { Project, CreateRepoPayload, Job } from '@shared/types'

// Declare the shell API type
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
    }

  }
}

interface TabState {
  id: string
  projectId: string
  projectKey: string
  projectPath: string
  projectName: string
}

interface TabManagerState {
  tabs: TabState[]
  activeTabId: string | null
}

interface LogEntry {
  id: string
  ts: string
  projectKey: string
  source: string
  stream: 'stdout' | 'stderr' | 'info' | 'error' | 'warn'
  line: string
}

interface ActivityState {
  totalActiveRuns: number
  isBusy: boolean
  busyProjects: string[]
}

export default function App(): React.JSX.Element {
  const [tabs, setTabs] = useState<TabData[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showHome, setShowHome] = useState(true) // Show home by default
  const [projects, setProjects] = useState<Project[]>([])
  const [activity, setActivity] = useState<ActivityState>({
    totalActiveRuns: 0,
    isBusy: false,
    busyProjects: []
  })
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsPanelOpen, setLogsPanelOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [repoDialogOpen, setRepoDialogOpen] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [projectWorkerStatus, setProjectWorkerStatus] = useState<Record<string, {
    workerEnabled: boolean
    activeRuns: number
    lastJobState: 'running' | 'completed' | 'failed' | null
  }>>({})

  // Get active tab info
  const activeTab = tabs.find((t) => t.id === activeTabId)

  // Get the active project (for settings modal)
  const activeProject = activeTab
    ? (projects.find((p) => p.id === activeTab.projectId) ?? null)
    : null

  // Show home when no tabs or explicitly requested
  const isHomeVisible = showHome || tabs.length === 0
  const isMacOS = /Mac|Macintosh|MacIntel|MacPPC/.test(navigator.userAgent)

  // Compute per-project worker status from projects and jobs
  const computedWorkerStatus = useMemo(() => {
    const statusMap: Record<string, {
      workerEnabled: boolean
      activeRuns: number
      lastJobState: 'running' | 'completed' | 'failed' | null
    }> = {}

    // Initialize from projects (worker_enabled field)
    for (const project of projects) {
      const workerJobs = recentJobs.filter(
        j => j.project_id === project.id && j.type === 'worker_run'
      )
      const activeWorkerJobs = workerJobs.filter(
        j => j.state === 'running' || j.state === 'queued'
      )
      const latestWorkerJob = workerJobs.length > 0
        ? workerJobs.reduce((latest, job) => {
            const latestTime = latest.updated_at || latest.created_at
            const jobTime = job.updated_at || job.created_at
            return jobTime > latestTime ? job : latest
          })
        : null

      let lastJobState: 'running' | 'completed' | 'failed' | null = null
      if (activeWorkerJobs.length > 0) {
        lastJobState = 'running'
      } else if (latestWorkerJob?.state === 'succeeded') {
        lastJobState = 'completed'
      } else if (latestWorkerJob?.state === 'failed') {
        lastJobState = 'failed'
      }

      statusMap[project.id] = {
        workerEnabled: project.worker_enabled === 1,
        activeRuns: activeWorkerJobs.length,
        lastJobState
      }
    }

    // Merge with activity updates (they take precedence for active runs)
    for (const [projectId, status] of Object.entries(projectWorkerStatus)) {
      if (statusMap[projectId]) {
        // Activity updates override for activeRuns
        if (status.activeRuns > 0) {
          statusMap[projectId].activeRuns = status.activeRuns
          statusMap[projectId].lastJobState = 'running'
        }
      }
    }

    return statusMap
  }, [projects, recentJobs, projectWorkerStatus])

  // Enrich tabs with worker status for tab indicators
  const tabsWithStatus = useMemo(() =>
    tabs.map(tab => {
      const status = computedWorkerStatus[tab.projectId]
      let workerStatus: 'idle' | 'running' | 'ready' | 'error' | null = null

      if (status?.activeRuns > 0) {
        workerStatus = 'running'
      } else if (status?.lastJobState === 'failed') {
        workerStatus = 'error'
      } else if (status?.lastJobState === 'completed') {
        workerStatus = 'ready'
      } else if (status?.workerEnabled) {
        workerStatus = 'idle'
      }

      return {
        ...tab,
        workerStatus,
        activeRuns: status?.activeRuns ?? 0
      }
    }),
    [tabs, computedWorkerStatus]
  )

  // Load initial state
  useEffect(() => {
    loadProjects()
    loadTabs()
    loadActivity()
    loadLogs()
    loadRecentJobs()
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

  // Subscribe to activity updates and track per-project worker status
  useEffect(() => {
    const unsubscribe = window.shellAPI.onActivityUpdate((activityData) => {
      // Update per-project worker status for tab indicators
      setProjectWorkerStatus(prev => ({
        ...prev,
        [activityData.projectId]: {
          workerEnabled: true, // If we get updates, worker is enabled
          activeRuns: activityData.activeRuns,
          lastJobState: activityData.activeRuns > 0 ? 'running' : 'completed'
        }
      }))
      loadActivity()
    })
    return unsubscribe
  }, [])

  // Subscribe to log entries
  useEffect(() => {
    const unsubscribe = window.shellAPI.onLogEntry((entry) => {
      setLogs((prev) => [...prev.slice(-499), entry])
    })
    return unsubscribe
  }, [])

  // Subscribe to global state updates (jobs/projects, etc.)
  useEffect(() => {
    const unsubscribe = window.shellAPI.onStateUpdated(() => {
      loadProjects()
      loadActivity()
      loadRecentJobs()
    })
    return unsubscribe
  }, [])

  // Subscribe to dev reset trigger (Ctrl+Shift+R)
  useEffect(() => {
    const unsubscribe = window.shellAPI.onDevResetTrigger(() => {
      setResetDialogOpen(true)
    })
    return unsubscribe
  }, [])

  // Notify main process when logs panel opens/closes
  useEffect(() => {
    // LogsPanel is 192px (h-48) when open
    window.shellAPI.setLogsPanelHeight(logsPanelOpen ? 192 : 0)
  }, [logsPanelOpen])

  // Notify main process when modal dialogs open/close
  useEffect(() => {
    const anyModalOpen = settingsOpen || repoDialogOpen || activityOpen || chatOpen || historyOpen
    window.shellAPI.setModalOpen(anyModalOpen)
  }, [settingsOpen, repoDialogOpen, activityOpen, chatOpen, historyOpen])

  const loadProjects = async (): Promise<void> => {
    try {
      const projectList = await window.shellAPI.getProjects()
      setProjects(projectList)
    } catch (error) {
      console.error('Failed to load projects:', error)
    }
  }

  const loadTabs = async (): Promise<void> => {
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
  }

  const handleRemoveRecentProject = async (project: Project): Promise<void> => {
    const confirmed = window.confirm(
      `Remove "${project.name}" from recent projects?\n\nThis deletes FlowPatch's local data for this project (cards, jobs, settings) but does not delete files on disk.`
    )
    if (!confirmed) return

    try {
      await window.shellAPI.deleteProject(project.id)
      await loadProjects()
      await loadTabs()
    } catch (error) {
      console.error('Failed to delete project:', error)
    }
  }

  const loadActivity = async (): Promise<void> => {
    try {
      const activityState = await window.shellAPI.getActivity()
      setActivity(activityState)
    } catch (error) {
      console.error('Failed to load activity:', error)
    }
  }

  const loadLogs = async (): Promise<void> => {
    try {
      const logEntries = await window.shellAPI.getLogs()
      setLogs(logEntries.slice(-500))
    } catch (error) {
      console.error('Failed to load logs:', error)
    }
  }

  const loadRecentJobs = async (): Promise<void> => {
    try {
      const jobs = await window.shellAPI.getRecentJobs(200)
      setRecentJobs(jobs)
    } catch (error) {
      console.error('Failed to load recent jobs:', error)
      setRecentJobs([])
    }
  }

  // Tab handlers
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

  // + button shows home view (deactivate all tabs to hide WebContentsViews)
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

  const handleExportLogs = useCallback(async (): Promise<void> => {
    try {
      const filepath = await window.shellAPI.exportLogs()
      console.log('Logs exported to:', filepath)
    } catch (error) {
      console.error('Failed to export logs:', error)
    }
  }, [])

  const handleOpenExistingProject = useCallback(async (project: Project): Promise<void> => {
    try {
      await window.shellAPI.createTab(project.id, project.local_path)
      setShowHome(false)
    } catch (error) {
      console.error('Failed to open project:', error)
    }
  }, [])

  // RepoStartDialog handlers
  const handleOpenRepo = useCallback(async (): Promise<void> => {
    const result = await window.shellAPI.selectDirectory()
    if (result.canceled || result.error || !result.path) {
      if (result.error) throw new Error(result.error)
      return
    }

    const openResult = await window.shellAPI.openProject(result.path)
    if (openResult.error) {
      throw new Error(openResult.error)
    }
    if (openResult.project) {
      await window.shellAPI.createTab(openResult.project.id, result.path)
      await loadProjects()
      setShowHome(false)
    }
  }, [])

  const handleCreateRepo = useCallback(async (payload: CreateRepoPayload): Promise<void> => {
    // Use the existing createRepo IPC handler
    const result = await window.electron.ipcRenderer.invoke('createRepo', payload)
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error(result.error as string)
    }
    if (result && typeof result === 'object' && 'project' in result) {
      const project = result.project as Project
      await window.shellAPI.createTab(project.id, project.local_path)
      await loadProjects()
      setShowHome(false)
    }
  }, [])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Title Bar with Tabs */}
      <div
        className="flex items-center bg-muted/50 border-b shrink-0 h-11"
        style={
          {
            WebkitAppRegion: 'drag',
            paddingLeft: isMacOS ? 72 : 0
          } as React.CSSProperties
        }
      >
        {/* Home button */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Button
            variant={isHomeVisible ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 mx-2"
            onClick={handleNewTab}
            title="Home"
          >
            <Home className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs strip - allow dragging on empty space */}
        <div className="flex-1">
          <TabBar
            tabs={tabsWithStatus}
            activeTabId={isHomeVisible ? null : activeTabId}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onNewTab={handleNewTab}
            onTabMove={handleTabMove}
            onCloseOthers={handleCloseOthers}
            onCloseToRight={handleCloseToRight}
            onDuplicateTab={handleDuplicateTab}
          />
        </div>

        {/* Right side controls - not draggable */}
        <div
          className="flex items-center gap-1 px-2 h-9"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Busy indicator */}
          {activity.isBusy && (
            <Badge variant="secondary" className="text-xs mr-2">
              {activity.totalActiveRuns} running
            </Badge>
          )}

          {/* Logs toggle */}
          <Button
            variant={logsPanelOpen ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2"
            onClick={() => setLogsPanelOpen(!logsPanelOpen)}
            title="Logs"
          >
            <Terminal className="h-4 w-4" />
          </Button>

          {/* Activity */}
          <Button
            variant={activityOpen ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              setActivityOpen(true)
              loadRecentJobs()
            }}
            title="Activity"
          >
            <ListChecks className="h-4 w-4" />
          </Button>

          {/* Agent Chat */}
          <Button
            variant={chatOpen ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              setChatOpen(true)
              loadRecentJobs()
            }}
            title="Agent Chat"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>

          {/* Session History */}
          <Button
            variant={historyOpen ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              setHistoryOpen(true)
              loadRecentJobs()
            }}
            title="Session History"
          >
            <History className="h-4 w-4" />
          </Button>

          {/* Settings */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>

          {/* Window Controls */}
          {!isMacOS && (
            <div className="flex items-center ml-2 border-l pl-2">
              <button
                onClick={() => window.shellAPI.minimizeWindow()}
                className="p-1.5 hover:bg-muted rounded transition-colors"
                title="Minimize"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                onClick={() => window.shellAPI.maximizeWindow()}
                className="p-1.5 hover:bg-muted rounded transition-colors"
                title="Maximize"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => window.shellAPI.closeWindow()}
                className="p-1.5 hover:bg-destructive hover:text-destructive-foreground rounded transition-colors"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Home View - shown above WebContentsViews when active */}
        {isHomeVisible && (
          <HomeView
            projects={projects}
            onOpenProject={handleOpenExistingProject}
            onRemoveProject={handleRemoveRecentProject}
            onOpenCreateDialog={() => setRepoDialogOpen(true)}
          />
        )}

        {/* WebContentsViews are positioned here by main process */}
        {/* They render below the home view when home is visible */}
      </div>

      {/* Logs Panel - Fixed at bottom, above everything */}
      {logsPanelOpen && (
        <div className="shrink-0 border-t bg-background z-20">
          <LogsPanel
            logs={logs}
            onClose={() => setLogsPanelOpen(false)}
            onExport={handleExportLogs}
            onClear={() => setLogs([])}
          />
        </div>
      )}

      <ActivityDialog
        open={activityOpen}
        onOpenChange={setActivityOpen}
        jobs={recentJobs}
        projectNameById={Object.fromEntries(projects.map((p) => [p.id, p.name]))}
      />

      {/* Agent Chat Dialog */}
      <GlobalAgentChatDialog
        open={chatOpen}
        onOpenChange={setChatOpen}
        jobs={recentJobs}
        projectNameById={Object.fromEntries(projects.map((p) => [p.id, p.name]))}
      />

      {/* Session History Dialog */}
      <SessionHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        jobs={recentJobs}
        projectNameById={Object.fromEntries(projects.map((p) => [p.id, p.name]))}
      />

      {/* Settings Modal */}
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} project={activeProject} />

      {/* Repo Start Dialog (Open/Create) */}
      <RepoStartDialog
        open={repoDialogOpen}
        onOpenChange={setRepoDialogOpen}
        onOpenRepo={handleOpenRepo}
        onCreateRepo={handleCreateRepo}
      />

      {/* Reset Confirm Dialog (Dev only - triggered by Ctrl+Shift+R) */}
      <ResetConfirmDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen} />

      <ShellToaster />
    </div>
  )
}
