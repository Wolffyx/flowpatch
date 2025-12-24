/**
 * Worker Progress Database Operations
 */

import { getDb } from './connection'
import { generateId } from '@shared/utils'
import type { WorkerProgress } from '@shared/types'

export type { WorkerProgress }

export interface WorkerProgressCreate {
  cardId: string
  jobId?: string
  totalIterations?: number
}

/**
 * Get worker progress for a card.
 */
export function getWorkerProgress(cardId: string): WorkerProgress | null {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM worker_progress WHERE card_id = ? ORDER BY created_at DESC LIMIT 1'
  )
  return (stmt.get(cardId) as WorkerProgress) ?? null
}

/**
 * Get worker progress for a job.
 */
export function getWorkerProgressByJob(jobId: string): WorkerProgress | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worker_progress WHERE job_id = ?')
  return (stmt.get(jobId) as WorkerProgress) ?? null
}

/**
 * Create worker progress.
 */
export function createWorkerProgress(data: WorkerProgressCreate): WorkerProgress {
  const d = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  d.prepare(
    `INSERT INTO worker_progress (
      id, card_id, job_id, iteration, total_iterations,
      subtask_index, subtasks_completed, last_checkpoint,
      created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, 0, 0, ?, ?, ?)`
  ).run(id, data.cardId, data.jobId ?? null, data.totalIterations ?? 5, now, now, now)

  return d.prepare('SELECT * FROM worker_progress WHERE id = ?').get(id) as WorkerProgress
}

/**
 * Update worker progress.
 */
export function updateWorkerProgress(
  id: string,
  data: {
    iteration?: number
    subtaskIndex?: number
    subtasksCompleted?: number
    filesModified?: string[]
    contextSummary?: string
    progressFilePath?: string
  }
): WorkerProgress | null {
  const d = getDb()
  const now = new Date().toISOString()
  const existing = d.prepare('SELECT * FROM worker_progress WHERE id = ?').get(id) as
    | WorkerProgress
    | undefined
  if (!existing) return null

  d.prepare(
    `UPDATE worker_progress SET
      iteration = ?,
      subtask_index = ?,
      subtasks_completed = ?,
      files_modified_json = ?,
      context_summary = ?,
      progress_file_path = ?,
      last_checkpoint = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    data.iteration ?? existing.iteration,
    data.subtaskIndex ?? existing.subtask_index,
    data.subtasksCompleted ?? existing.subtasks_completed,
    data.filesModified ? JSON.stringify(data.filesModified) : existing.files_modified_json,
    data.contextSummary ?? existing.context_summary,
    data.progressFilePath ?? existing.progress_file_path,
    now,
    now,
    id
  )

  return d.prepare('SELECT * FROM worker_progress WHERE id = ?').get(id) as WorkerProgress
}

/**
 * Clear worker progress for a card.
 */
export function clearWorkerProgress(cardId: string): void {
  const d = getDb()
  d.prepare('DELETE FROM worker_progress WHERE card_id = ?').run(cardId)
}
