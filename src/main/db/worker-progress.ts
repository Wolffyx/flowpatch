/**
 * Worker Progress Database Operations
 */

import { desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { workerProgress } from './schema'
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
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(workerProgress)
      .where(eq(workerProgress.card_id, cardId))
      .orderBy(desc(workerProgress.created_at))
      .limit(1)
      .get() as WorkerProgress) ?? null
  )
}

/**
 * Get worker progress for a job.
 */
export function getWorkerProgressByJob(jobId: string): WorkerProgress | null {
  const db = getDrizzle()
  return (
    (db.select().from(workerProgress).where(eq(workerProgress.job_id, jobId)).get() as WorkerProgress) ??
    null
  )
}

/**
 * Create worker progress.
 */
export function createWorkerProgress(data: WorkerProgressCreate): WorkerProgress {
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

  db.insert(workerProgress)
    .values({
      id,
      card_id: data.cardId,
      job_id: data.jobId ?? null,
      iteration: 1,
      total_iterations: data.totalIterations ?? 5,
      subtask_index: 0,
      subtasks_completed: 0,
      last_checkpoint: now,
      created_at: now,
      updated_at: now
    })
    .run()

  return db.select().from(workerProgress).where(eq(workerProgress.id, id)).get() as WorkerProgress
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
  const db = getDrizzle()
  const now = new Date().toISOString()
  const existing = db.select().from(workerProgress).where(eq(workerProgress.id, id)).get() as
    | WorkerProgress
    | undefined
  if (!existing) return null

  db.update(workerProgress)
    .set({
      iteration: data.iteration ?? existing.iteration,
      subtask_index: data.subtaskIndex ?? existing.subtask_index,
      subtasks_completed: data.subtasksCompleted ?? existing.subtasks_completed,
      files_modified_json: data.filesModified
        ? JSON.stringify(data.filesModified)
        : existing.files_modified_json,
      context_summary: data.contextSummary ?? existing.context_summary,
      progress_file_path: data.progressFilePath ?? existing.progress_file_path,
      last_checkpoint: now,
      updated_at: now
    })
    .where(eq(workerProgress.id, id))
    .run()

  return db.select().from(workerProgress).where(eq(workerProgress.id, id)).get() as WorkerProgress
}

/**
 * Clear worker progress for a card.
 */
export function clearWorkerProgress(cardId: string): void {
  const db = getDrizzle()
  db.delete(workerProgress).where(eq(workerProgress.card_id, cardId)).run()
}
