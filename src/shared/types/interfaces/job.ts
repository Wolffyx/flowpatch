export type JobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'blocked'
  | 'pending_approval'

export type JobType =
  | 'sync_poll'
  | 'sync_push'
  | 'worker_run'
  | 'webhook_ingest'
  | 'workspace_ensure'
  | 'index_build'
  | 'index_refresh'
  | 'index_watch_start'
  | 'index_watch_stop'
  | 'docs_refresh'
  | 'config_validate'
  | 'context_preview'
  | 'repair'
  | 'migrate'

export interface JobProgress {
  percent?: number
  stage?: string
  detail?: string
}

export interface JobResultEnvelope {
  summary?: string
  progress?: JobProgress
  artifacts?: unknown
}

export interface Job {
  id: string
  project_id: string
  card_id: string | null
  type: JobType
  state: JobState
  lease_until: string | null
  attempts: number
  payload_json: string | null
  result_json: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}
