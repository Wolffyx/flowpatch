/**
 * IPC handlers for project operations.
 * Handles: getState, getProject, deleteProject, updateProjectPolicy, unlinkProject
 */

import { ipcMain } from 'electron'
import {
  listProjects,
  listCards,
  listCardLinksByProject,
  listEvents,
  listJobs,
  getProject,
  deleteProject as dbDeleteProject,
  updateProjectPolicyJson,
  createEvent
} from '../../db'
import { stopWorkerLoop } from '../../worker/loop'
import { getTabByProjectId, closeTab } from '../../tabManager'
import { parsePolicyJson, mergePolicyUpdate, logAction } from '@shared/utils'
import type { PolicyConfig } from '@shared/types'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerProjectHandlers(notifyRenderer: () => void): void {
  // Get full app state
  ipcMain.handle('getState', () => {
    logAction('getState')
    const projects = listProjects()
    const data = projects.map((p) => ({
      project: p,
      cards: listCards(p.id),
      cardLinks: listCardLinksByProject(p.id),
      events: listEvents(p.id),
      jobs: listJobs(p.id)
    }))
    return { projects: data }
  })

  // Get project by ID
  ipcMain.handle('getProject', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return null
    return getProject(payload.projectId)
  })

  // Delete project
  ipcMain.handle('deleteProject', (_e, payload: { projectId: string }) => {
    logAction('deleteProject', payload)
    const success = dbDeleteProject(payload.projectId)
    logAction('deleteProject:result', { projectId: payload.projectId, success })
    notifyRenderer()
    return { success }
  })

  // Unlink project (removes from app but keeps files)
  ipcMain.handle('unlinkProject', async (_e, payload: { projectId: string }) => {
    logAction('unlinkProject', payload)
    if (!payload?.projectId) return { error: 'Project ID required' }

    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }

    // Stop worker loop if running
    stopWorkerLoop(payload.projectId)

    // Close the tab for this project if open
    const tab = getTabByProjectId(payload.projectId)
    if (tab) {
      await closeTab(tab.id)
    }

    // Delete project from database (this also deletes associated cards, events, jobs, etc.)
    try {
      const success = dbDeleteProject(payload.projectId)
      if (!success) {
        return { error: 'Failed to unlink project' }
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }

    logAction('unlinkProject:success', { projectId: payload.projectId, name: project.name })
    notifyRenderer()
    return { success: true }
  })

  // Generic updateProjectPolicy handler (merges partial policy updates)
  ipcMain.handle(
    'updateProjectPolicy',
    (_e, payload: { projectId: string; policy: Partial<PolicyConfig> }) => {
      logAction('updateProjectPolicy', payload)

      if (!payload?.projectId) return { error: 'Project ID required' }
      if (!payload?.policy) return { error: 'Policy patch required' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      const currentPolicy = parsePolicyJson(project.policy_json)
      const updatedPolicy = mergePolicyUpdate(currentPolicy, payload.policy)

      updateProjectPolicyJson(payload.projectId, JSON.stringify(updatedPolicy))
      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )

  // Set show pull requests section
  ipcMain.handle(
    'setShowPullRequestsSection',
    (_e, payload: { projectId: string; showPullRequestsSection: boolean }) => {
      logAction('setShowPullRequestsSection', payload)

      if (!payload?.projectId) return { error: 'Project not found' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      const policy = parsePolicyJson(project.policy_json)

      policy.ui = {
        ...policy.ui,
        showPullRequestsSection: !!payload.showPullRequestsSection
      }

      updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))
      createEvent(payload.projectId, 'status_changed', undefined, {
        action: 'ui_show_pull_requests_section',
        showPullRequestsSection: !!payload.showPullRequestsSection
      })

      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )
}
