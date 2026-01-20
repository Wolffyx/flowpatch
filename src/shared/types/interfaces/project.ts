export interface LogEntry {
  id: string
  ts: string
  projectKey: string
  projectId?: string
  jobId?: string
  cardId?: string
  source: string
  stream: 'stdout' | 'stderr' | 'info' | 'error' | 'warn'
  line: string
}

export interface ProjectActivity {
  projectId: string
  activeRuns: number
  isBusy: boolean
  lastUpdated: string
}

export interface GlobalActivity {
  totalActiveRuns: number
  isBusy: boolean
  busyProjects: string[]
}

export interface OpenProjectSummary {
  projectId: string
  projectKey: string
  projectPath: string
  projectName: string
}

export interface Project {
  id: string
  name: string
  local_path: string
  local_path_exists?: boolean
  selected_remote_name: string | null
  remote_repo_key: string | null
  provider_hint: 'auto' | 'github' | 'gitlab'
  policy_json: string | null
  worker_enabled: number
  last_sync_at: string | null
  created_at: string
  updated_at: string
}
