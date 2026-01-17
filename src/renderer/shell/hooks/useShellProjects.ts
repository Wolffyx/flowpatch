/**
 * Shell Projects Hook
 *
 * Manages projects state and operations
 */

import { useState, useCallback } from 'react'
import type { Project, CreateRepoPayload } from '@shared/types'

interface UseShellProjectsReturn {
  /** List of projects */
  projects: Project[]
  /** Load projects from the shell API */
  loadProjects: () => Promise<void>
  /** Open an existing project */
  handleOpenExistingProject: (project: Project) => Promise<void>
  /** Remove a project from recents */
  handleRemoveRecentProject: (project: Project) => Promise<void>
  /** Open a repo via directory picker */
  handleOpenRepo: () => Promise<void>
  /** Create a new repo */
  handleCreateRepo: (payload: CreateRepoPayload) => Promise<void>
}

export function useShellProjects(
  setShowHome: (show: boolean) => void,
  loadTabs: () => Promise<void>
): UseShellProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([])

  const loadProjects = useCallback(async (): Promise<void> => {
    try {
      const projectList = await window.shellAPI.getProjects()
      setProjects(projectList)
    } catch (error) {
      console.error('Failed to load projects:', error)
    }
  }, [])

  const handleOpenExistingProject = useCallback(async (project: Project): Promise<void> => {
    try {
      await window.shellAPI.createTab(project.id, project.local_path)
      setShowHome(false)
    } catch (error) {
      console.error('Failed to open project:', error)
    }
  }, [setShowHome])

  const handleRemoveRecentProject = useCallback(async (project: Project): Promise<void> => {
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
  }, [loadProjects, loadTabs])

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
  }, [loadProjects, setShowHome])

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
  }, [loadProjects, setShowHome])

  return {
    projects,
    loadProjects,
    handleOpenExistingProject,
    handleRemoveRecentProject,
    handleOpenRepo,
    handleCreateRepo
  }
}
