export type WorkerState = 'idle' | 'processing' | 'waiting' | 'error'

export interface WorkerStatus {
  state: WorkerState
  activeCardId?: string
  activeCardTitle?: string
  activeJobId?: string
  lastError?: string
  lastRunAt?: string
}

export interface WorkerLogMessage {
  projectId: string
  jobId: string
  cardId?: string
  ts: string
  line: string
  source?: string
  stream?: 'stdout' | 'stderr'
}
