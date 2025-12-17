// Shared types between main and renderer processes

export type CardStatus = 'draft' | 'ready' | 'in_progress' | 'in_review' | 'testing' | 'done'

export type Provider = 'github' | 'gitlab' | 'local'

export type CardType = 'issue' | 'pr' | 'draft' | 'mr' | 'local'

export type SyncState = 'ok' | 'pending' | 'error'

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export type JobType = 'sync_poll' | 'sync_push' | 'worker_run' | 'webhook_ingest'

export type EventType =
  | 'status_changed'
  | 'synced'
  | 'worker_plan'
  | 'worker_run'
  | 'pr_created'
  | 'error'
  | 'card_created'
  | 'card_linked'

export interface Project {
  id: string
  name: string
  local_path: string
  selected_remote_name: string | null
  remote_repo_key: string | null
  provider_hint: 'auto' | 'github' | 'gitlab'
  policy_json: string | null
  worker_enabled: number
  last_sync_at: string | null
  created_at: string
  updated_at: string
}

export interface Card {
  id: string
  project_id: string
  provider: Provider
  type: CardType
  title: string
  body: string | null
  status: CardStatus
  ready_eligible: number
  assignees_json: string | null
  labels_json: string | null
  remote_url: string | null
  remote_repo_key: string | null
  remote_number_or_iid: string | null
  remote_node_id: string | null
  updated_remote_at: string | null
  updated_local_at: string
  sync_state: SyncState
  last_error: string | null
}

export interface CardLink {
  id: string
  card_id: string
  linked_type: 'pr' | 'mr'
  linked_url: string
  linked_remote_repo_key: string | null
  linked_number_or_iid: string | null
  created_at: string
}

export interface Event {
  id: string
  project_id: string
  card_id: string | null
  type: EventType
  payload_json: string | null
  created_at: string
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

export interface RemoteInfo {
  name: string
  url: string
  provider: 'github' | 'gitlab' | 'unknown'
  repoKey: string
}

export interface PolicyConfig {
  version: number
  repo?: {
    provider?: 'auto' | 'github' | 'gitlab'
    gitlab?: {
      host?: string
    }
  }
  sync?: {
    webhookPreferred?: boolean
    pollingFallbackMinutes?: number
    readyLabel?: string
    statusLabels?: {
      draft?: string
      ready?: string
      inProgress?: string
      inReview?: string
      testing?: string
      done?: string
    }
    githubProjectsV2?: {
      enabled?: boolean
      projectId?: string
      statusFieldName?: string
      statusValues?: {
        draft?: string
        ready?: string
        inProgress?: string
        inReview?: string
        testing?: string
        done?: string
      }
    }
  }
  worker?: {
    enabled?: boolean
    toolPreference?: 'auto' | 'claude' | 'codex'
    planFirst?: boolean
    maxMinutes?: number
    allowNetwork?: boolean
    branchPattern?: string
    commitMessage?: string
    allowedCommands?: string[]
    lintCommand?: string
    testCommand?: string
    buildCommand?: string
    forbidPaths?: string[]
  }
}

// IPC Request/Response types
export interface OpenRepoResult {
  canceled?: boolean
  error?: string
  project?: Project
  remotes?: RemoteInfo[]
  needSelection?: boolean
}

export interface SelectRemotePayload {
  projectId: string
  remoteName: string
  remoteUrl: string
  repoKey: string
}

export interface MoveCardPayload {
  cardId: string
  status: CardStatus
}

export interface CreateTestCardPayload {
  projectId: string
  title: string
}

export interface SyncPayload {
  projectId: string
}

export interface ToggleWorkerPayload {
  projectId: string
  enabled: boolean
}

export interface RunWorkerPayload {
  projectId: string
  cardId?: string
}

export interface AppState {
  projects: {
    project: Project
    cards: Card[]
    events: Event[]
    jobs: Job[]
  }[]
}

// Column configuration for the Kanban board
export const KANBAN_COLUMNS: { id: CardStatus; label: string; color: string }[] = [
  { id: 'draft', label: 'Draft', color: 'bg-muted-foreground' },
  { id: 'ready', label: 'Ready', color: 'bg-chart-1' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-chart-4' },
  { id: 'in_review', label: 'In Review', color: 'bg-chart-5' },
  { id: 'testing', label: 'Testing', color: 'bg-chart-3' },
  { id: 'done', label: 'Done', color: 'bg-chart-2' }
]

// Utility functions
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

// Default policy configuration
export const DEFAULT_POLICY: PolicyConfig = {
  version: 1,
  sync: {
    webhookPreferred: true,
    pollingFallbackMinutes: 3,
    readyLabel: 'ready',
    statusLabels: {
      draft: 'status::draft',
      ready: 'status::ready',
      inProgress: 'status::in-progress',
      inReview: 'status::in-review',
      testing: 'status::testing',
      done: 'status::done'
    },
    githubProjectsV2: {
      enabled: false
    }
  },
  worker: {
    enabled: true,
    toolPreference: 'auto',
    planFirst: true,
    maxMinutes: 25,
    allowNetwork: false,
    branchPattern: 'kanban/{id}-{slug}',
    commitMessage: '#{issue} {title}',
    allowedCommands: ['pnpm install', 'pnpm lint', 'pnpm test', 'pnpm build'],
    lintCommand: 'pnpm lint',
    testCommand: 'pnpm test',
    buildCommand: 'pnpm build',
    forbidPaths: ['.github/workflows/', '.gitlab-ci.yml']
  }
}
