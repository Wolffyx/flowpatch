/**
 * Tab Interfaces
 *
 * Type definitions for tab state management
 */

export interface TabState {
  id: string
  projectId: string
  projectKey: string
  projectPath: string
  projectName: string
}

export interface TabManagerState {
  tabs: TabState[]
  activeTabId: string | null
}
