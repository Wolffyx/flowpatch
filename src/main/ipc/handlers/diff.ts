/**
 * IPC handlers for git diff operations.
 * Handles: getFileDiff, getDiffStats, getDiffFiles, getFileContent
 */

import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getWorktree } from '../../db'
import { logAction } from '@shared/utils'

const execFileAsync = promisify(execFile)

/**
 * Get environment variables for git commands.
 */
function getGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: process.env.GIT_ASKPASS || 'echo'
  }
}

/**
 * Execute a git command and return stdout.
 */
async function gitExec(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: getGitEnv(),
    maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large diffs
  })
  return stdout.toString()
}

export interface FileDiff {
  filePath: string
  oldContent: string
  newContent: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

export interface DiffStats {
  filesChanged: number
  additions: number
  deletions: number
}

export interface DiffFile {
  path: string
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
  additions: number
  deletions: number
  oldPath?: string // For renames
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerDiffHandlers(): void {
  // Get list of changed files with stats
  ipcMain.handle(
    'diff:getFiles',
    async (_e, worktreeId: string): Promise<{ files: DiffFile[]; error?: string }> => {
      logAction('diff:getFiles', { worktreeId })

      const wt = getWorktree(worktreeId)
      if (!wt) {
        return { files: [], error: 'Worktree not found' }
      }

      try {
        // Get diff --numstat for additions/deletions
        const numstat = await gitExec(
          ['diff', '--numstat', wt.base_ref, 'HEAD'],
          wt.worktree_path
        )

        // Get diff --name-status for file status
        const nameStatus = await gitExec(
          ['diff', '--name-status', wt.base_ref, 'HEAD'],
          wt.worktree_path
        )

        const statusMap = new Map<string, { status: string; oldPath?: string }>()
        for (const line of nameStatus.trim().split('\n').filter(Boolean)) {
          const parts = line.split('\t')
          const status = parts[0]
          if (status.startsWith('R') || status.startsWith('C')) {
            // Rename or copy: R100\toldpath\tnewpath
            statusMap.set(parts[2], { status: status[0], oldPath: parts[1] })
          } else {
            statusMap.set(parts[1], { status: status[0] })
          }
        }

        const files: DiffFile[] = []
        for (const line of numstat.trim().split('\n').filter(Boolean)) {
          const [add, del, path] = line.split('\t')
          const info = statusMap.get(path) ?? { status: 'M' }
          files.push({
            path,
            status: info.status as DiffFile['status'],
            additions: add === '-' ? 0 : parseInt(add, 10),
            deletions: del === '-' ? 0 : parseInt(del, 10),
            oldPath: info.oldPath
          })
        }

        return { files }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { files: [], error: errorMsg }
      }
    }
  )

  // Get diff stats summary
  ipcMain.handle(
    'diff:getStats',
    async (_e, worktreeId: string): Promise<{ stats: DiffStats | null; error?: string }> => {
      logAction('diff:getStats', { worktreeId })

      const wt = getWorktree(worktreeId)
      if (!wt) {
        return { stats: null, error: 'Worktree not found' }
      }

      try {
        const shortstat = await gitExec(
          ['diff', '--shortstat', wt.base_ref, 'HEAD'],
          wt.worktree_path
        )

        // Parse "3 files changed, 10 insertions(+), 5 deletions(-)"
        const filesMatch = shortstat.match(/(\d+) files? changed/)
        const addMatch = shortstat.match(/(\d+) insertions?\(\+\)/)
        const delMatch = shortstat.match(/(\d+) deletions?\(-\)/)

        return {
          stats: {
            filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
            additions: addMatch ? parseInt(addMatch[1], 10) : 0,
            deletions: delMatch ? parseInt(delMatch[1], 10) : 0
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { stats: null, error: errorMsg }
      }
    }
  )

  // Get file content at a specific ref
  ipcMain.handle(
    'diff:getFileContent',
    async (
      _e,
      worktreeId: string,
      filePath: string,
      ref: 'base' | 'head'
    ): Promise<{ content: string; error?: string }> => {
      logAction('diff:getFileContent', { worktreeId, filePath, ref })

      const wt = getWorktree(worktreeId)
      if (!wt) {
        return { content: '', error: 'Worktree not found' }
      }

      try {
        const gitRef = ref === 'base' ? wt.base_ref : 'HEAD'
        const content = await gitExec(['show', `${gitRef}:${filePath}`], wt.worktree_path)
        return { content }
      } catch (err) {
        // File might not exist at this ref (new file or deleted file)
        const errorMsg = err instanceof Error ? err.message : String(err)
        if (errorMsg.includes('does not exist') || errorMsg.includes('fatal: path')) {
          return { content: '' }
        }
        return { content: '', error: errorMsg }
      }
    }
  )

  // Get full diff for a specific file
  ipcMain.handle(
    'diff:getFileDiff',
    async (
      _e,
      worktreeId: string,
      filePath: string
    ): Promise<{ diff: FileDiff | null; error?: string }> => {
      logAction('diff:getFileDiff', { worktreeId, filePath })

      const wt = getWorktree(worktreeId)
      if (!wt) {
        return { diff: null, error: 'Worktree not found' }
      }

      try {
        // Get file status
        const nameStatus = await gitExec(
          ['diff', '--name-status', wt.base_ref, 'HEAD', '--', filePath],
          wt.worktree_path
        )
        const statusLine = nameStatus.trim().split('\n')[0] ?? ''
        const statusChar = statusLine.split('\t')[0]?.[0] ?? 'M'

        let status: FileDiff['status'] = 'modified'
        if (statusChar === 'A') status = 'added'
        else if (statusChar === 'D') status = 'deleted'
        else if (statusChar === 'R') status = 'renamed'

        // Get old content (base)
        let oldContent = ''
        if (status !== 'added') {
          try {
            oldContent = await gitExec(['show', `${wt.base_ref}:${filePath}`], wt.worktree_path)
          } catch {
            // File doesn't exist at base
          }
        }

        // Get new content (HEAD)
        let newContent = ''
        if (status !== 'deleted') {
          try {
            newContent = await gitExec(['show', `HEAD:${filePath}`], wt.worktree_path)
          } catch {
            // File doesn't exist at HEAD
          }
        }

        // Count additions/deletions
        const numstat = await gitExec(
          ['diff', '--numstat', wt.base_ref, 'HEAD', '--', filePath],
          wt.worktree_path
        )
        const [add, del] = numstat.trim().split('\t')

        return {
          diff: {
            filePath,
            oldContent,
            newContent,
            status,
            additions: add === '-' ? 0 : parseInt(add ?? '0', 10),
            deletions: del === '-' ? 0 : parseInt(del ?? '0', 10)
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { diff: null, error: errorMsg }
      }
    }
  )

  // Get unified diff patch for a file
  ipcMain.handle(
    'diff:getUnifiedDiff',
    async (
      _e,
      worktreeId: string,
      filePath?: string
    ): Promise<{ patch: string; error?: string }> => {
      logAction('diff:getUnifiedDiff', { worktreeId, filePath })

      const wt = getWorktree(worktreeId)
      if (!wt) {
        return { patch: '', error: 'Worktree not found' }
      }

      try {
        const args = ['diff', wt.base_ref, 'HEAD']
        if (filePath) {
          args.push('--', filePath)
        }
        const patch = await gitExec(args, wt.worktree_path)
        return { patch }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return { patch: '', error: errorMsg }
      }
    }
  )
}
