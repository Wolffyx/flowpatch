/**
 * Worker Progress Database Operations
 *
 * Supports both central database (legacy) and project-local database.
 */

import { desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { workerProgress } from './schema'
import { workerProgress as projectWorkerProgress } from './schema/project'
import { generateId } from '@shared/utils'
import type { WorkerProgress } from '@shared/types'
import { resolveProjectDb } from './db-resolver'

export type { WorkerProgress }

export interface WorkerProgressCreate {
  cardId: string
  jobId?: string
  projectId: string
  totalIterations?: number
}

/**
 * Get worker progress for a card.
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getWorkerProgress(cardId: string, projectId?: string): WorkerProgress | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectWorkerProgress)
        .where(eq(projectWorkerProgress.card_id, cardId))
        .orderBy(desc(projectWorkerProgress.created_at))
        .limit(1)
        .get()
      return row ? (row as WorkerProgress) : null
    }
  }

  // Central DB fallback
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
 * @param jobId - The job ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getWorkerProgressByJob(jobId: string, projectId?: string): WorkerProgress | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectWorkerProgress)
        .where(eq(projectWorkerProgress.job_id, jobId))
        .get()
      return row ? (row as WorkerProgress) : null
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  return (
    (db
      .select()
      .from(workerProgress)
      .where(eq(workerProgress.job_id, jobId))
      .get() as WorkerProgress) ?? null
  )
}

/**
 * Create worker progress.
 */
export function createWorkerProgress(data: WorkerProgressCreate): WorkerProgress {
  const { db, isLocalDb } = resolveProjectDb(data.projectId)
  const id = generateId()
  const now = new Date().toISOString()

  if (isLocalDb) {
    db.insert(projectWorkerProgress)
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

    return db
      .select()
      .from(projectWorkerProgress)
      .where(eq(projectWorkerProgress.id, id))
      .get() as WorkerProgress
  }

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
 * @param id - The progress record ID
 * @param data - The update data
 * @param projectId - Optional project ID for direct DB resolution
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
  },
  projectId?: string
): WorkerProgress | null {
  const now = new Date().toISOString()

  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const existing = db
        .select()
        .from(projectWorkerProgress)
        .where(eq(projectWorkerProgress.id, id))
        .get() as WorkerProgress | undefined
      if (!existing) return null

      db.update(projectWorkerProgress)
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
        .where(eq(projectWorkerProgress.id, id))
        .run()

      return db
        .select()
        .from(projectWorkerProgress)
        .where(eq(projectWorkerProgress.id, id))
        .get() as WorkerProgress
    }
  }

  // Central DB fallback
  const db = getDrizzle()
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
 * @param cardId - The card ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function clearWorkerProgress(cardId: string, projectId?: string): void {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      db.delete(projectWorkerProgress).where(eq(projectWorkerProgress.card_id, cardId)).run()
      return
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  db.delete(workerProgress).where(eq(workerProgress.card_id, cardId)).run()
}
