import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface WorkerRunCheckpoint {
  jobId: string
  cardId: string
  projectId: string
  phase: string
  iteration?: number
  updatedAt: string
  contextSummaryPath?: string
  lastContextPath?: string
}

export function getRunDir(repoRoot: string, jobId: string): string {
  return join(repoRoot, '.flowpatch', 'state', 'runs', jobId)
}

export function ensureRunDir(repoRoot: string, jobId: string): string {
  const dir = getRunDir(repoRoot, jobId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getCheckpointPath(repoRoot: string, jobId: string): string {
  return join(getRunDir(repoRoot, jobId), 'checkpoint.json')
}

export function writeCheckpoint(repoRoot: string, checkpoint: WorkerRunCheckpoint): string {
  const dir = ensureRunDir(repoRoot, checkpoint.jobId)
  const path = join(dir, 'checkpoint.json')
  writeFileSync(path, JSON.stringify(checkpoint, null, 2), { encoding: 'utf-8' })
  return path
}

export function readCheckpoint(repoRoot: string, jobId: string): WorkerRunCheckpoint | null {
  const path = getCheckpointPath(repoRoot, jobId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as WorkerRunCheckpoint
  } catch {
    return null
  }
}
