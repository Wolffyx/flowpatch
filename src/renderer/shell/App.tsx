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

import { useEffect, useMemo } from 'react'
import { ShellToaster } from './components/ShellToaster'
import { LogsPanel } from './components/LogsPanel'
import { SettingsModal } from './components/settings'
import { ResetConfirmDialog } from './components/settings/ResetConfirmDialog'
import { ActivityDialog } from './components/ActivityDialog'
import { RepoStartDialog } from '../src/components/RepoStartDialog'
import { HomeView } from './components/HomeView'
import { GlobalAgentChatDialog } from './components/GlobalAgentChatDialog'
import { SessionHistoryDialog } from './components/SessionHistoryDialog'
import { ShellLayout, TitleBar } from './components/layout'

// Import hooks
import {
  useDialogState,
  useShellLogs,
  useShellTabs,
  useShellActivity,
  useShellProjects,
  useWorkerStatus,
  useAutoUpdater
} from './hooks'

// Import interfaces (shell-api is imported for side effects)
import './interfaces'

export default function App(): React.JSX.Element {
  // Dialog state
  const dialogs = useDialogState()

  // Logs
  const { logs, loadLogs, handleExportLogs, clearLogs } = useShellLogs()

  // Tabs
  const {
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
  } = useShellTabs()

  // Projects
  const {
    projects,
    loadProjects,
    handleOpenExistingProject,
    handleRemoveRecentProject,
    handleOpenRepo,
    handleCreateRepo
  } = useShellProjects(setShowHome, loadTabs)

  // Activity
  const { activity, recentJobs, projectWorkerStatus, loadActivity, loadRecentJobs } =
    useShellActivity(loadProjects)

  // Worker status
  const { tabsWithStatus } = useWorkerStatus(projects, recentJobs, projectWorkerStatus, tabs)

  // Auto-updater (initializes toast notifications for updates)
  useAutoUpdater()

  // Derived state
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeProject = activeTab
    ? (projects.find((p) => p.id === activeTab.projectId) ?? null)
    : null
  const isHomeVisible = showHome || tabs.length === 0
  const projectNameById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects]
  )

  // Load initial state
  useEffect(() => {
    loadProjects()
    loadTabs()
    loadActivity()
    loadLogs()
    loadRecentJobs()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Notify main process when logs panel opens/closes
  useEffect(() => {
    window.shellAPI.setLogsPanelHeight(dialogs.logsPanelOpen ? 192 : 0)
  }, [dialogs.logsPanelOpen])

  return (
    <ShellLayout
      titleBar={
        <TitleBar
          tabs={tabsWithStatus}
          activeTabId={activeTabId}
          isHomeVisible={isHomeVisible}
          activity={activity}
          logsPanelOpen={dialogs.logsPanelOpen}
          activityOpen={dialogs.activityOpen}
          chatOpen={dialogs.chatOpen}
          historyOpen={dialogs.historyOpen}
          onNewTab={handleNewTab}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
          onTabMove={handleTabMove}
          onCloseOthers={handleCloseOthers}
          onCloseToRight={handleCloseToRight}
          onDuplicateTab={handleDuplicateTab}
          onToggleLogs={() => dialogs.setLogsPanelOpen(!dialogs.logsPanelOpen)}
          onOpenActivity={() => {
            dialogs.setActivityOpen(true)
            loadRecentJobs()
          }}
          onOpenChat={() => {
            dialogs.setChatOpen(true)
            loadRecentJobs()
          }}
          onOpenHistory={() => {
            dialogs.setHistoryOpen(true)
            loadRecentJobs()
          }}
          onOpenSettings={() => dialogs.setSettingsOpen(true)}
        />
      }
      logsPanel={
        dialogs.logsPanelOpen ? (
          <LogsPanel
            logs={logs}
            onClose={() => dialogs.setLogsPanelOpen(false)}
            onExport={handleExportLogs}
            onClear={clearLogs}
          />
        ) : undefined
      }
    >
      {/* Main Content - Home View */}
      {isHomeVisible && (
        <HomeView
          projects={projects}
          onOpenProject={handleOpenExistingProject}
          onRemoveProject={handleRemoveRecentProject}
          onOpenCreateDialog={() => dialogs.setRepoDialogOpen(true)}
        />
      )}

      {/* Dialogs */}
      <ActivityDialog
        open={dialogs.activityOpen}
        onOpenChange={dialogs.setActivityOpen}
        jobs={recentJobs}
        projectNameById={projectNameById}
      />

      <GlobalAgentChatDialog
        open={dialogs.chatOpen}
        onOpenChange={dialogs.setChatOpen}
        jobs={recentJobs}
        projectNameById={projectNameById}
      />

      <SessionHistoryDialog
        open={dialogs.historyOpen}
        onOpenChange={dialogs.setHistoryOpen}
        jobs={recentJobs}
        projectNameById={projectNameById}
      />

      <SettingsModal
        open={dialogs.settingsOpen}
        onOpenChange={dialogs.setSettingsOpen}
        project={activeProject}
      />

      <RepoStartDialog
        open={dialogs.repoDialogOpen}
        onOpenChange={dialogs.setRepoDialogOpen}
        onOpenRepo={handleOpenRepo}
        onCreateRepo={handleCreateRepo}
      />

      <ResetConfirmDialog
        open={dialogs.resetDialogOpen}
        onOpenChange={dialogs.setResetDialogOpen}
      />

      <ShellToaster />
    </ShellLayout>
  )
}
