/**
 * IPC handlers for project operations.
 * Handles: getState, getProject, deleteProject, updateProjectPolicy, unlinkProject
 */

import { ipcMain } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import YAML from 'yaml'
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
import type { PolicyConfig, E2ETestConfig } from '@shared/types'
import type { PatchworkConfig } from '../../services/patchwork-config'

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

  // Update E2E settings (saves to both database and .patchwork/config.yml)
  ipcMain.handle(
    'updateE2ESettings',
    (_e, payload: { projectId: string; e2eConfig: Partial<E2ETestConfig> }) => {
      logAction('updateE2ESettings', payload)

      if (!payload?.projectId) return { error: 'Project ID required' }
      if (!payload?.e2eConfig) return { error: 'E2E config required' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      // 1. Update database (policy_json)
      const currentPolicy = parsePolicyJson(project.policy_json)
      const updatedPolicy = mergePolicyUpdate(currentPolicy, {
        worker: { e2e: payload.e2eConfig as E2ETestConfig }
      })
      updateProjectPolicyJson(payload.projectId, JSON.stringify(updatedPolicy))

      // 2. Update .patchwork/config.yml
      const repoRoot = project.local_path
      const configPath = join(repoRoot, '.patchwork', 'config.yml')

      if (existsSync(configPath)) {
        try {
          const configContent = readFileSync(configPath, 'utf-8')
          const config = YAML.parse(configContent) as PatchworkConfig

          // Merge E2E settings
          config.e2e = {
            ...config.e2e,
            enabled: payload.e2eConfig.enabled ?? config.e2e?.enabled,
            framework: payload.e2eConfig.framework ?? config.e2e?.framework,
            maxRetries: payload.e2eConfig.maxRetries ?? config.e2e?.maxRetries,
            timeoutMinutes: payload.e2eConfig.timeoutMinutes ?? config.e2e?.timeoutMinutes,
            createTestsIfMissing:
              payload.e2eConfig.createTestsIfMissing ?? config.e2e?.createTestsIfMissing,
            testCommand: payload.e2eConfig.testCommand ?? config.e2e?.testCommand,
            testDirectories: payload.e2eConfig.testDirectories ?? config.e2e?.testDirectories
          }

          // Write back
          writeFileSync(configPath, YAML.stringify(config), 'utf-8')
          logAction('updateE2ESettings:configWritten', { configPath })
        } catch (error) {
          logAction('updateE2ESettings:configWriteError', {
            error: error instanceof Error ? error.message : String(error)
          })
          // Don't fail - database update succeeded
        }
      }

      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )

  // Update Unit Test settings
  ipcMain.handle(
    'updateUnitTestSettings',
    (
      _e,
      payload: {
        projectId: string
        unitTestConfig: Partial<{ enabled: boolean; command: string; runOnSave: boolean }>
      }
    ) => {
      logAction('updateUnitTestSettings', payload)

      if (!payload?.projectId) return { error: 'Project ID required' }
      if (!payload?.unitTestConfig) return { error: 'Unit test config required' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      // Update database (policy_json)
      const currentPolicy = parsePolicyJson(project.policy_json)
      const currentUnitTest = currentPolicy.worker?.unitTest ?? {
        enabled: false,
        command: '',
        runOnSave: false
      }
      const updatedPolicy = mergePolicyUpdate(currentPolicy, {
        worker: {
          unitTest: {
            ...currentUnitTest,
            ...payload.unitTestConfig
          }
        }
      })
      updateProjectPolicyJson(payload.projectId, JSON.stringify(updatedPolicy))

      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )

  // Update Pre-commit Hooks settings
  ipcMain.handle(
    'updatePreCommitSettings',
    (
      _e,
      payload: {
        projectId: string
        preCommitConfig: Partial<{
          enabled: boolean
          lint: boolean
          test: boolean
          typecheck: boolean
        }>
      }
    ) => {
      logAction('updatePreCommitSettings', payload)

      if (!payload?.projectId) return { error: 'Project ID required' }
      if (!payload?.preCommitConfig) return { error: 'Pre-commit config required' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }

      // Update database (policy_json)
      const currentPolicy = parsePolicyJson(project.policy_json)
      const currentPreCommit = currentPolicy.worker?.preCommit ?? {
        enabled: false,
        lint: true,
        test: true,
        typecheck: false
      }
      const updatedPolicy = mergePolicyUpdate(currentPolicy, {
        worker: {
          preCommit: {
            ...currentPreCommit,
            ...payload.preCommitConfig
          }
        }
      })
      updateProjectPolicyJson(payload.projectId, JSON.stringify(updatedPolicy))

      notifyRenderer()
      return { success: true, project: getProject(payload.projectId) }
    }
  )
}
