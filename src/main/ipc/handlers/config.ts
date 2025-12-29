/**
 * IPC handlers for configuration sync operations.
 * Handles: config sync, feature updates, config priority settings
 */

import { ipcMain } from 'electron'
import type { ConfigSyncPriority, FeaturesConfig } from '../../../shared/types'
import { getProject } from '../../db/projects'
import {
  syncProjectConfig,
  updateFeatureConfig,
  getConfigSyncPriority,
  setConfigSyncPriority,
  getProjectConfig,
  startConfigFileWatcher,
  stopConfigFileWatcher
} from '../../services/config-sync'
import { sendToTab } from '../../tabManager'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerConfigHandlers(notifyRenderer: () => void): void {
  /**
   * Sync project configuration between database and YAML file.
   */
  ipcMain.handle(
    'syncProjectConfig',
    async (
      _e,
      payload: { projectId: string; priorityOverride?: ConfigSyncPriority }
    ) => {
      const project = getProject(payload.projectId)
      if (!project) {
        return { success: false, error: 'Project not found' }
      }

      const result = syncProjectConfig(
        payload.projectId,
        project.local_path,
        payload.priorityOverride
      )

      if (result.success) {
        notifyRenderer()
      }

      return {
        success: result.success,
        source: result.source,
        policy: result.policy,
        errors: result.diagnostics.errors,
        warnings: result.diagnostics.warnings
      }
    }
  )

  /**
   * Get the current configuration for a project.
   */
  ipcMain.handle('getProjectConfig', (_e, payload: { projectId: string }) => {
    return getProjectConfig(payload.projectId)
  })

  /**
   * Update a specific feature configuration.
   */
  ipcMain.handle(
    'updateFeatureConfig',
    (
      _e,
      payload: {
        projectId: string
        featureKey: keyof FeaturesConfig
        config: Partial<FeaturesConfig[keyof FeaturesConfig]>
      }
    ) => {
      const project = getProject(payload.projectId)
      if (!project) {
        return { success: false, error: 'Project not found' }
      }

      const result = updateFeatureConfig(
        payload.projectId,
        project.local_path,
        payload.featureKey,
        payload.config as any
      )

      if (result.success) {
        notifyRenderer()
      }

      return {
        success: result.success,
        policy: result.policy,
        errors: result.diagnostics.errors,
        warnings: result.diagnostics.warnings
      }
    }
  )

  /**
   * Get configuration sync priority for a project.
   */
  ipcMain.handle('getConfigSyncPriority', (_e, payload: { projectId: string }) => {
    return getConfigSyncPriority(payload.projectId)
  })

  /**
   * Set configuration sync priority for a project.
   */
  ipcMain.handle(
    'setConfigSyncPriority',
    (_e, payload: { projectId: string; priority: ConfigSyncPriority }) => {
      const project = getProject(payload.projectId)
      if (!project) {
        return { success: false, error: 'Project not found' }
      }

      const result = setConfigSyncPriority(
        payload.projectId,
        project.local_path,
        payload.priority
      )

      if (result.success) {
        notifyRenderer()
      }

      return {
        success: result.success,
        policy: result.policy,
        errors: result.diagnostics.errors,
        warnings: result.diagnostics.warnings
      }
    }
  )

  /**
   * Start watching config file for changes.
   */
  ipcMain.handle(
    'startConfigFileWatcher',
    (_e, payload: { projectId: string }) => {
      const project = getProject(payload.projectId)
      if (!project) {
        return { success: false, error: 'Project not found' }
      }

      const success = startConfigFileWatcher(
        payload.projectId,
        project.local_path,
        (result) => {
          // Notify the specific project tab about config changes
          sendToTab(payload.projectId, 'configChanged', {
            policy: result.policy,
            source: result.source
          })
          notifyRenderer()
        }
      )

      return { success }
    }
  )

  /**
   * Stop watching config file for changes.
   */
  ipcMain.handle('stopConfigFileWatcher', (_e, payload: { projectId: string }) => {
    stopConfigFileWatcher(payload.projectId)
    return { success: true }
  })
}
