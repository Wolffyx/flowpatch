/**
 * IPC handlers for worktree operations.
 * Handles: listWorktrees, getWorktree, removeWorktree, recreateWorktree, etc.
 */

import { ipcMain, shell } from 'electron'
import { getProject, listWorktrees, getWorktree, updateWorktreeStatus } from '../../db'
import { GitWorktreeManager } from '../../services/git-worktree-manager'
import { WorktreeReconciler } from '../../services/worktree-reconciler'
import { logAction } from '@shared/utils'
import type { PolicyConfig } from '@shared/types'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerWorktreeHandlers(notifyRenderer: () => void): void {
  // List worktrees
  ipcMain.handle('listWorktrees', async (_e, projectId: string) => {
    logAction('listWorktrees', { projectId })
    return listWorktrees(projectId)
  })

  // Get worktree
  ipcMain.handle('getWorktree', async (_e, worktreeId: string) => {
    logAction('getWorktree', { worktreeId })
    return getWorktree(worktreeId)
  })

  // Remove worktree
  ipcMain.handle('removeWorktree', async (_e, worktreeId: string) => {
    logAction('removeWorktree', { worktreeId })
    const wt = getWorktree(worktreeId)
    if (!wt) return { error: 'Worktree not found' }

    const project = getProject(wt.project_id)
    if (!project) return { error: 'Project not found' }

    let policy: PolicyConfig | undefined
    try {
      policy = project.policy_json ? JSON.parse(project.policy_json) : undefined
    } catch {
      // Use defaults
    }

    const manager = new GitWorktreeManager(project.local_path)
    const config = {
      root: policy?.worker?.worktree?.root ?? 'repo',
      customPath: policy?.worker?.worktree?.customPath
    }

    try {
      await manager.removeWorktree(wt.worktree_path, { force: true, config })
      updateWorktreeStatus(worktreeId, 'cleaned')
      notifyRenderer()
      return { success: true }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      updateWorktreeStatus(worktreeId, 'error', errorMsg)
      notifyRenderer()
      return { error: errorMsg }
    }
  })

  // Recreate worktree
  ipcMain.handle('recreateWorktree', async (_e, worktreeId: string) => {
    logAction('recreateWorktree', { worktreeId })
    const wt = getWorktree(worktreeId)
    if (!wt) return { error: 'Worktree not found' }

    const project = getProject(wt.project_id)
    if (!project) return { error: 'Project not found' }

    let policy: PolicyConfig | undefined
    try {
      policy = project.policy_json ? JSON.parse(project.policy_json) : undefined
    } catch {
      // Use defaults
    }

    const manager = new GitWorktreeManager(project.local_path)
    const config = {
      root: policy?.worker?.worktree?.root ?? 'repo',
      customPath: policy?.worker?.worktree?.customPath
    }

    try {
      // Force remove if exists
      try {
        await manager.removeWorktree(wt.worktree_path, { force: true, config })
      } catch {
        // Ignore removal errors
      }

      // Recreate
      const baseBranch = wt.base_ref.replace(/^origin\//, '')
      await manager.ensureWorktree(wt.worktree_path, wt.branch_name, baseBranch, {
        fetchFirst: true,
        force: true,
        config
      })

      updateWorktreeStatus(worktreeId, 'ready')
      notifyRenderer()
      return { success: true }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      updateWorktreeStatus(worktreeId, 'error', errorMsg)
      notifyRenderer()
      return { error: errorMsg }
    }
  })

  // Open worktree folder
  ipcMain.handle('openWorktreeFolder', async (_e, worktreePath: string) => {
    logAction('openWorktreeFolder', { worktreePath })
    shell.openPath(worktreePath)
    return { success: true }
  })

  // Cleanup stale worktrees
  ipcMain.handle('cleanupStaleWorktrees', async (_e, projectId: string) => {
    logAction('cleanupStaleWorktrees', { projectId })
    const project = getProject(projectId)
    if (!project) return { error: 'Project not found' }

    let policy: PolicyConfig | undefined
    try {
      policy = project.policy_json ? JSON.parse(project.policy_json) : undefined
    } catch {
      // Use defaults
    }

    try {
      const reconciler = new WorktreeReconciler(projectId, project.local_path, policy)
      const result = await reconciler.reconcile()
      notifyRenderer()
      return { success: true, result }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { error: errorMsg }
    }
  })
}
