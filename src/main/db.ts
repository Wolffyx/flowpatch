import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type {
  Project,
  Card,
  CardLink,
  Event,
  Job,
  Worktree,
  Subtask,
  WorkerSlot,
  WorkerProgress,
  CardStatus,
  JobState,
  JobType,
  EventType,
  WorktreeStatus,
  SubtaskStatus,
  WorkerSlotStatus,
  PolicyConfig
} from '../shared/types'

export type { Project, Card, CardLink, Event, Job, Worktree, Subtask, WorkerSlot, WorkerProgress, CardStatus, WorktreeStatus, SubtaskStatus, WorkerSlotStatus }

let db: Database.Database | null = null

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

export function initDb(): Database.Database {
  const base = app.getPath('userData')
  const dir = join(base, 'kanban')
  ensureDir(dir)
  const file = join(dir, 'kanban.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      local_path TEXT NOT NULL,
      selected_remote_name TEXT,
      remote_repo_key TEXT,
      provider_hint TEXT NOT NULL DEFAULT 'auto',
      policy_json TEXT,
      worker_enabled INTEGER NOT NULL DEFAULT 0,
      last_sync_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  // Migration: Add missing columns to projects table
  const projectColumns = db.pragma('table_info(projects)') as { name: string }[]
  const projectColumnNames = projectColumns.map((c) => c.name)
  if (!projectColumnNames.includes('worker_enabled')) {
    db.exec('ALTER TABLE projects ADD COLUMN worker_enabled INTEGER NOT NULL DEFAULT 0')
  }
  if (!projectColumnNames.includes('last_sync_at')) {
    db.exec('ALTER TABLE projects ADD COLUMN last_sync_at TEXT')
  }

  // Cards table
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      status TEXT NOT NULL,
      ready_eligible INTEGER NOT NULL DEFAULT 0,
      assignees_json TEXT,
      labels_json TEXT,
      remote_url TEXT,
      remote_repo_key TEXT,
      remote_number_or_iid TEXT,
      remote_node_id TEXT,
      updated_remote_at TEXT,
      updated_local_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'ok',
      last_error TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cards_project_id ON cards(project_id);
    CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
    CREATE INDEX IF NOT EXISTS idx_cards_remote ON cards(remote_repo_key, remote_number_or_iid);
  `)

  // Migration: Add missing columns to cards table
  const cardColumns = db.pragma('table_info(cards)') as { name: string }[]
  const cardColumnNames = cardColumns.map((c) => c.name)
  if (!cardColumnNames.includes('remote_node_id')) {
    db.exec('ALTER TABLE cards ADD COLUMN remote_node_id TEXT')
  }

  // Card links table (for PR/MR associations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_links (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      linked_type TEXT NOT NULL,
      linked_url TEXT NOT NULL,
      linked_remote_repo_key TEXT,
      linked_number_or_iid TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_card_links_card_id ON card_links(card_id);
  `)

  // Events table (timeline/audit log)
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      card_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id);
    CREATE INDEX IF NOT EXISTS idx_events_card_id ON events(card_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  `)

  // Jobs table (for sync and worker tasks)
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      card_id TEXT,
      type TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      lease_until TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT,
      result_json TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_project_id ON jobs(project_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
  `)

  // Sync state table (for tracking sync cursors)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      cursor_type TEXT NOT NULL,
      cursor_value TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, provider, cursor_type)
    );
  `)

  // App settings table (for global app-level settings like theme)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  // Worktrees table (for tracking git worktree lifecycle)
  db.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      job_id TEXT,
      worktree_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      base_ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'creating',
      last_error TEXT,
      locked_by TEXT,
      lock_expires_at TEXT,
      cleanup_requested_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_worktrees_project ON worktrees(project_id);
    CREATE INDEX IF NOT EXISTS idx_worktrees_card ON worktrees(card_id);
    CREATE INDEX IF NOT EXISTS idx_worktrees_status ON worktrees(status);
    CREATE INDEX IF NOT EXISTS idx_worktrees_locked ON worktrees(locked_by, lock_expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_path ON worktrees(worktree_path);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_worktrees_branch ON worktrees(project_id, branch_name);
  `)

  // Migration: Add cleanup_requested_at column if it doesn't exist
  try {
    db.exec(`ALTER TABLE worktrees ADD COLUMN cleanup_requested_at TEXT`)
  } catch {
    // Column already exists
  }

  // Subtasks table (for decomposed tasks)
  db.exec(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      parent_card_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      estimated_minutes INTEGER,
      sequence INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      remote_issue_number TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (parent_card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_parent ON subtasks(parent_card_id);
    CREATE INDEX IF NOT EXISTS idx_subtasks_project ON subtasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_subtasks_status ON subtasks(status);
  `)

  // Worker slots table (for pool management)
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_slots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slot_number INTEGER NOT NULL,
      card_id TEXT,
      job_id TEXT,
      worktree_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      started_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
      FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE SET NULL,
      UNIQUE(project_id, slot_number)
    );
    CREATE INDEX IF NOT EXISTS idx_slots_project ON worker_slots(project_id);
    CREATE INDEX IF NOT EXISTS idx_slots_status ON worker_slots(status);
  `)

  // Worker progress table (for iterative AI sessions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_progress (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      job_id TEXT,
      iteration INTEGER NOT NULL DEFAULT 1,
      total_iterations INTEGER NOT NULL DEFAULT 1,
      subtask_index INTEGER NOT NULL DEFAULT 0,
      subtasks_completed INTEGER NOT NULL DEFAULT 0,
      files_modified_json TEXT,
      context_summary TEXT,
      progress_file_path TEXT,
      last_checkpoint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_progress_card ON worker_progress(card_id);
    CREATE INDEX IF NOT EXISTS idx_progress_job ON worker_progress(job_id);
  `)

  return db
}

export function getDb(): Database.Database {
  if (!db) return initDb()
  return db
}

// ==================== Projects ====================

export function listProjects(): Project[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM projects ORDER BY updated_at DESC')
  return stmt.all() as Project[]
}

export function getProject(id: string): Project | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM projects WHERE id = ?')
  return (stmt.get(id) as Project) ?? null
}

export function upsertProject(
  p: Omit<Project, 'created_at' | 'updated_at' | 'worker_enabled' | 'last_sync_at'> & {
    worker_enabled?: number
    last_sync_at?: string | null
  }
): Project {
  const d = getDb()
  const now = new Date().toISOString()
  const existing = d.prepare('SELECT * FROM projects WHERE id = ?').get(p.id) as Project | undefined
  if (existing) {
    d.prepare(
      `
      UPDATE projects SET
        name = ?,
        local_path = ?,
        selected_remote_name = ?,
        remote_repo_key = ?,
        provider_hint = ?,
        policy_json = ?,
        worker_enabled = ?,
        last_sync_at = ?,
        updated_at = ?
      WHERE id = ?
    `
    ).run(
      p.name,
      p.local_path,
      p.selected_remote_name,
      p.remote_repo_key,
      p.provider_hint,
      p.policy_json ?? null,
      p.worker_enabled ?? existing.worker_enabled,
      p.last_sync_at ?? existing.last_sync_at,
      now,
      p.id
    )
    return { ...existing, ...p, updated_at: now } as Project
  }
  d.prepare(
    `
    INSERT INTO projects (
      id, name, local_path, selected_remote_name, remote_repo_key,
      provider_hint, policy_json, worker_enabled, last_sync_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    p.id,
    p.name,
    p.local_path,
    p.selected_remote_name,
    p.remote_repo_key,
    p.provider_hint,
    p.policy_json ?? null,
    p.worker_enabled ?? 0,
    p.last_sync_at ?? null,
    now,
    now
  )
  const created = d.prepare('SELECT * FROM projects WHERE id = ?').get(p.id) as Project
  return created
}

export function deleteProject(id: string): boolean {
  const d = getDb()

  const deleteByIds = (table: string, column: string, ids: string[]): void => {
    // SQLite default max variables is 999
    const chunkSize = 900
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      const placeholders = chunk.map(() => '?').join(',')
      d.prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`).run(...chunk)
    }
  }

  try {
    const tx = d.transaction((): boolean => {
      const cardIds = (d.prepare('SELECT id FROM cards WHERE project_id = ?').all(id) as { id: string }[]).map(
        (r) => r.id
      )

      if (cardIds.length) {
        deleteByIds('worker_progress', 'card_id', cardIds)
        deleteByIds('card_links', 'card_id', cardIds)
        deleteByIds('events', 'card_id', cardIds)
        deleteByIds('subtasks', 'parent_card_id', cardIds)
      }

      d.prepare('DELETE FROM worker_slots WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM worktrees WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM jobs WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM sync_state WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM events WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM subtasks WHERE project_id = ?').run(id)
      d.prepare('DELETE FROM cards WHERE project_id = ?').run(id)

      const result = d.prepare('DELETE FROM projects WHERE id = ?').run(id)
      return result.changes > 0
    })

    return tx()
  } catch {
    return false
  }
}

export function updateProjectWorkerEnabled(projectId: string, enabled: boolean): Project | null {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE projects SET worker_enabled = ?, updated_at = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    now,
    projectId
  )
  return getProject(projectId)
}

export function updateProjectSyncTime(projectId: string): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE projects SET last_sync_at = ?, updated_at = ? WHERE id = ?').run(
    now,
    now,
    projectId
  )
}

export function updateProjectPolicyJson(projectId: string, policyJson: string | null): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE projects SET policy_json = ?, updated_at = ? WHERE id = ?').run(
    policyJson,
    now,
    projectId
  )
}

// ==================== Cards ====================

export function listCards(projectId: string): Card[] {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM cards WHERE project_id = ? ORDER BY updated_local_at DESC'
  )
  return stmt.all(projectId) as Card[]
}

export function getCard(id: string): Card | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM cards WHERE id = ?')
  return (stmt.get(id) as Card) ?? null
}

export function getCardByRemote(
  projectId: string,
  remoteRepoKey: string,
  remoteNumberOrIid: string
): Card | null {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM cards WHERE project_id = ? AND remote_repo_key = ? AND remote_number_or_iid = ?'
  )
  return (stmt.get(projectId, remoteRepoKey, remoteNumberOrIid) as Card) ?? null
}

export function upsertCard(
  c: Omit<Card, 'updated_local_at'> & { updated_local_at?: string }
): Card {
  const d = getDb()
  const now = new Date().toISOString()
  const existing = d.prepare('SELECT * FROM cards WHERE id = ?').get(c.id) as Card | undefined
  if (existing) {
    d.prepare(
      `
      UPDATE cards SET
        project_id = ?,
        provider = ?,
        type = ?,
        title = ?,
        body = ?,
        status = ?,
        ready_eligible = ?,
        assignees_json = ?,
        labels_json = ?,
        remote_url = ?,
        remote_repo_key = ?,
        remote_number_or_iid = ?,
        remote_node_id = ?,
        updated_remote_at = ?,
        updated_local_at = ?,
        sync_state = ?,
        last_error = ?
      WHERE id = ?
    `
    ).run(
      c.project_id,
      c.provider,
      c.type,
      c.title,
      c.body,
      c.status,
      c.ready_eligible,
      c.assignees_json,
      c.labels_json,
      c.remote_url,
      c.remote_repo_key,
      c.remote_number_or_iid,
      c.remote_node_id ?? null,
      c.updated_remote_at,
      c.updated_local_at ?? now,
      c.sync_state,
      c.last_error,
      c.id
    )
    return { ...existing, ...c, updated_local_at: c.updated_local_at ?? now }
  }
  d.prepare(
    `
    INSERT INTO cards (
      id, project_id, provider, type, title, body, status, ready_eligible,
      assignees_json, labels_json, remote_url, remote_repo_key, remote_number_or_iid,
      remote_node_id, updated_remote_at, updated_local_at, sync_state, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    c.id,
    c.project_id,
    c.provider,
    c.type,
    c.title,
    c.body,
    c.status,
    c.ready_eligible,
    c.assignees_json,
    c.labels_json,
    c.remote_url,
    c.remote_repo_key,
    c.remote_number_or_iid,
    c.remote_node_id ?? null,
    c.updated_remote_at,
    c.updated_local_at ?? now,
    c.sync_state,
    c.last_error
  )
  return d.prepare('SELECT * FROM cards WHERE id = ?').get(c.id) as Card
}

export function createLocalTestCard(projectId: string, title: string): Card {
  const id = cryptoRandomId()
  return upsertCard({
    id,
    project_id: projectId,
    provider: 'local',
    type: 'local',
    title,
    body: null,
    status: 'draft',
    ready_eligible: 0,
    assignees_json: null,
    labels_json: null,
    remote_url: null,
    remote_repo_key: null,
    remote_number_or_iid: null,
    remote_node_id: null,
    updated_remote_at: null,
    sync_state: 'ok',
    last_error: null
  })
}

export function updateCardStatus(cardId: string, status: CardStatus): Card | null {
  const d = getDb()
  const now = new Date().toISOString()
  const readyEligible = status === 'ready' ? 1 : 0
  d.prepare(
    'UPDATE cards SET status = ?, ready_eligible = ?, updated_local_at = ?, sync_state = ? WHERE id = ?'
  ).run(status, readyEligible, now, 'pending', cardId)
  return getCard(cardId)
}

export function updateCardLabels(cardId: string, labelsJson: string | null): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE cards SET labels_json = ?, updated_local_at = ? WHERE id = ?').run(
    labelsJson,
    now,
    cardId
  )
}

export function getStatusLabelFromPolicy(status: CardStatus, policy: PolicyConfig): string {
  const statusLabels = policy.sync?.statusLabels || {}
  const defaults: Record<CardStatus, string> = {
    draft: 'status::draft',
    ready: 'status::ready',
    in_progress: 'status::in-progress',
    in_review: 'status::in-review',
    testing: 'status::testing',
    done: 'status::done'
  }
  const keyMap: Record<CardStatus, keyof NonNullable<typeof statusLabels>> = {
    draft: 'draft',
    ready: 'ready',
    in_progress: 'inProgress',
    in_review: 'inReview',
    testing: 'testing',
    done: 'done'
  }
  return statusLabels[keyMap[status]] || defaults[status]
}

export function getAllStatusLabelsFromPolicy(policy: PolicyConfig): string[] {
  const statusLabels = policy.sync?.statusLabels || {}
  return [
    statusLabels.draft || 'status::draft',
    statusLabels.ready || 'status::ready',
    statusLabels.inProgress || 'status::in-progress',
    statusLabels.inReview || 'status::in-review',
    statusLabels.testing || 'status::testing',
    statusLabels.done || 'status::done'
  ]
}

export function updateCardSyncState(
  cardId: string,
  syncState: 'ok' | 'pending' | 'error',
  error?: string
): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE cards SET sync_state = ?, last_error = ?, updated_local_at = ? WHERE id = ?').run(
    syncState,
    error ?? null,
    now,
    cardId
  )
}

export function deleteCard(id: string): boolean {
  const d = getDb()
  const result = d.prepare('DELETE FROM cards WHERE id = ?').run(id)
  return result.changes > 0
}

// ==================== Card Links ====================

export function listCardLinks(cardId: string): CardLink[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM card_links WHERE card_id = ? ORDER BY created_at DESC')
  return stmt.all(cardId) as CardLink[]
}

export function listCardLinksByProject(projectId: string): CardLink[] {
  const d = getDb()
  const stmt = d.prepare(`
    SELECT cl.* FROM card_links cl
    INNER JOIN cards c ON cl.card_id = c.id
    WHERE c.project_id = ?
    ORDER BY cl.created_at DESC
  `)
  return stmt.all(projectId) as CardLink[]
}

export function createCardLink(
  cardId: string,
  linkedType: 'pr' | 'mr',
  linkedUrl: string,
  linkedRemoteRepoKey?: string,
  linkedNumberOrIid?: string
): CardLink {
  const d = getDb()
  const id = cryptoRandomId()
  const now = new Date().toISOString()
  d.prepare(
    `
    INSERT INTO card_links (id, card_id, linked_type, linked_url, linked_remote_repo_key, linked_number_or_iid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(id, cardId, linkedType, linkedUrl, linkedRemoteRepoKey ?? null, linkedNumberOrIid ?? null, now)
  return d.prepare('SELECT * FROM card_links WHERE id = ?').get(id) as CardLink
}

export function ensureCardLink(
  cardId: string,
  linkedType: 'pr' | 'mr',
  linkedUrl: string,
  linkedRemoteRepoKey?: string,
  linkedNumberOrIid?: string
): CardLink {
  const d = getDb()
  const existing = d
    .prepare('SELECT * FROM card_links WHERE card_id = ? AND linked_url = ? LIMIT 1')
    .get(cardId, linkedUrl) as CardLink | undefined

  if (!existing) {
    return createCardLink(cardId, linkedType, linkedUrl, linkedRemoteRepoKey, linkedNumberOrIid)
  }

  const shouldUpdateNumber = !existing.linked_number_or_iid && linkedNumberOrIid
  const shouldUpdateRepoKey = !existing.linked_remote_repo_key && linkedRemoteRepoKey
  if (shouldUpdateNumber || shouldUpdateRepoKey) {
    d.prepare('UPDATE card_links SET linked_remote_repo_key = ?, linked_number_or_iid = ? WHERE id = ?').run(
      linkedRemoteRepoKey ?? existing.linked_remote_repo_key,
      linkedNumberOrIid ?? existing.linked_number_or_iid,
      existing.id
    )
    return d.prepare('SELECT * FROM card_links WHERE id = ?').get(existing.id) as CardLink
  }

  return existing
}

// ==================== Events ====================

export function listEvents(projectId: string, limit = 100): Event[] {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
  )
  return stmt.all(projectId, limit) as Event[]
}

export function listCardEvents(cardId: string, limit = 50): Event[] {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM events WHERE card_id = ? ORDER BY created_at DESC LIMIT ?'
  )
  return stmt.all(cardId, limit) as Event[]
}

export function createEvent(
  projectId: string,
  type: EventType,
  cardId?: string,
  payload?: unknown
): Event {
  const d = getDb()
  const id = cryptoRandomId()
  const now = new Date().toISOString()
  d.prepare(
    `
    INSERT INTO events (id, project_id, card_id, type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(id, projectId, cardId ?? null, type, payload ? JSON.stringify(payload) : null, now)
  return d.prepare('SELECT * FROM events WHERE id = ?').get(id) as Event
}

// ==================== Jobs ====================

export function listJobs(projectId: string, limit = 50): Job[] {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
  )
  return stmt.all(projectId, limit) as Job[]
}

export function getJob(id: string): Job | null {
  const d = getDb()
  return (d.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job) ?? null
}

export function createJob(
  projectId: string,
  type: JobType,
  cardId?: string,
  payload?: unknown
): Job {
  const d = getDb()
  const id = cryptoRandomId()
  const now = new Date().toISOString()
  d.prepare(
    `
    INSERT INTO jobs (id, project_id, card_id, type, state, attempts, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)
  `
  ).run(id, projectId, cardId ?? null, type, payload ? JSON.stringify(payload) : null, now, now)
  return d.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job
}

export function updateJobState(
  jobId: string,
  state: JobState,
  result?: unknown,
  error?: string
): Job | null {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare(
    `
    UPDATE jobs SET
      state = ?,
      result_json = ?,
      last_error = ?,
      updated_at = ?
    WHERE id = ?
  `
  ).run(state, result ? JSON.stringify(result) : null, error ?? null, now, jobId)
  return getJob(jobId)
}

export function updateJobResult(jobId: string, result?: unknown): Job | null {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare(
    `
    UPDATE jobs SET
      result_json = ?,
      updated_at = ?
    WHERE id = ?
  `
  ).run(result ? JSON.stringify(result) : null, now, jobId)
  return getJob(jobId)
}

export function acquireJobLease(jobId: string, leaseSeconds = 300): boolean {
  const d = getDb()
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const result = d
    .prepare(
      `
    UPDATE jobs SET
      state = 'running',
      lease_until = ?,
      attempts = attempts + 1,
      updated_at = ?
    WHERE id = ? AND (state = 'queued' OR (state = 'running' AND lease_until < ?))
  `
    )
    .run(leaseUntil, now.toISOString(), jobId, now.toISOString())
  return result.changes > 0
}

export function renewJobLease(jobId: string, leaseSeconds = 300): boolean {
  const d = getDb()
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const result = d
    .prepare('UPDATE jobs SET lease_until = ?, updated_at = ? WHERE id = ? AND state = ?')
    .run(leaseUntil, now.toISOString(), jobId, 'running')
  return result.changes > 0
}

export function getNextQueuedJob(projectId: string, type?: JobType): Job | null {
  const d = getDb()
  if (type) {
    return (
      (d
        .prepare(
          'SELECT * FROM jobs WHERE project_id = ? AND type = ? AND state = ? ORDER BY created_at ASC LIMIT 1'
        )
        .get(projectId, type, 'queued') as Job) ?? null
    )
  }
  return (
    (d
      .prepare(
        'SELECT * FROM jobs WHERE project_id = ? AND state = ? ORDER BY created_at ASC LIMIT 1'
      )
      .get(projectId, 'queued') as Job) ?? null
  )
}

export function getRunningJobs(projectId: string): Job[] {
  const d = getDb()
  return d
    .prepare('SELECT * FROM jobs WHERE project_id = ? AND state = ?')
    .all(projectId, 'running') as Job[]
}

export function getNextReadyCard(projectId: string, retryCooldownMinutes = 30): Card | null {
  const d = getDb()
  const cooldownTime = new Date(Date.now() - retryCooldownMinutes * 60 * 1000).toISOString()

  // Find the oldest Ready card that:
  // 1. Has status = 'ready'
  // 2. Is not a local-only card (has remote)
  // 3. Has no active (queued/running) worker_run job
  // 4. Has no recently failed worker_run job (within cooldown period)
  const stmt = d.prepare(`
    SELECT c.* FROM cards c
    WHERE c.project_id = ?
      AND c.status = 'ready'
      AND c.provider != 'local'
      AND c.remote_repo_key IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.card_id = c.id
          AND j.type = 'worker_run'
          AND j.state IN ('queued', 'running')
      )
      AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.card_id = c.id
          AND j.type = 'worker_run'
          AND j.state = 'failed'
          AND j.updated_at > ?
      )
    ORDER BY c.updated_local_at ASC
    LIMIT 1
  `)

  return (stmt.get(projectId, cooldownTime) as Card) ?? null
}

export function hasActiveWorkerJob(projectId: string): boolean {
  const d = getDb()
  const stmt = d.prepare(`
    SELECT 1 FROM jobs
    WHERE project_id = ?
      AND type = 'worker_run'
      AND state IN ('queued', 'running')
    LIMIT 1
  `)
  return stmt.get(projectId) !== undefined
}

export function getActiveWorkerJob(projectId: string): Job | null {
  const d = getDb()
  const stmt = d.prepare(`
    SELECT * FROM jobs
    WHERE project_id = ?
      AND type = 'worker_run'
      AND state IN ('queued', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `)
  return (stmt.get(projectId) as Job) ?? null
}

export function getActiveWorkerJobForCard(cardId: string): Job | null {
  const d = getDb()
  const stmt = d.prepare(`
    SELECT * FROM jobs
    WHERE card_id = ?
      AND type = 'worker_run'
      AND state IN ('queued', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `)
  return (stmt.get(cardId) as Job) ?? null
}

export function cancelJob(jobId: string, error?: string): boolean {
  const d = getDb()
  const now = new Date().toISOString()
  const res = d
    .prepare(
      `
      UPDATE jobs SET
        state = 'canceled',
        lease_until = NULL,
        last_error = ?,
        updated_at = ?
      WHERE id = ? AND state IN ('queued', 'running')
    `
    )
    .run(error ?? 'Canceled', now, jobId)
  return res.changes > 0
}

// ==================== Sync State ====================

export function getSyncCursor(
  projectId: string,
  provider: string,
  cursorType: string
): string | null {
  const d = getDb()
  const row = d
    .prepare(
      'SELECT cursor_value FROM sync_state WHERE project_id = ? AND provider = ? AND cursor_type = ?'
    )
    .get(projectId, provider, cursorType) as { cursor_value: string | null } | undefined
  return row?.cursor_value ?? null
}

export function setSyncCursor(
  projectId: string,
  provider: string,
  cursorType: string,
  value: string | null
): void {
  const d = getDb()
  const now = new Date().toISOString()
  const id = `${projectId}:${provider}:${cursorType}`
  d.prepare(
    `
    INSERT INTO sync_state (id, project_id, provider, cursor_type, cursor_value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, provider, cursor_type) DO UPDATE SET
      cursor_value = excluded.cursor_value,
      updated_at = excluded.updated_at
  `
  ).run(id, projectId, provider, cursorType, value, now)
}

// ==================== Worktrees ====================

export interface WorktreeCreate {
  projectId: string
  cardId: string
  jobId?: string
  worktreePath: string
  branchName: string
  baseRef: string
  status?: WorktreeStatus
  lockedBy?: string
  lockExpiresAt?: string
}

export function listWorktrees(projectId: string): Worktree[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at DESC')
  return stmt.all(projectId) as Worktree[]
}

export function listWorktreesByStatus(projectId: string, status: WorktreeStatus): Worktree[] {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM worktrees WHERE project_id = ? AND status = ? ORDER BY created_at DESC'
  )
  return stmt.all(projectId, status) as Worktree[]
}

export function getWorktree(id: string): Worktree | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worktrees WHERE id = ?')
  return (stmt.get(id) as Worktree) ?? null
}

export function getWorktreeByPath(worktreePath: string): Worktree | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worktrees WHERE worktree_path = ?')
  return (stmt.get(worktreePath) as Worktree) ?? null
}

export function getWorktreeByBranch(projectId: string, branchName: string): Worktree | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worktrees WHERE project_id = ? AND branch_name = ?')
  return (stmt.get(projectId, branchName) as Worktree) ?? null
}

export function getWorktreeByCard(cardId: string): Worktree | null {
  const d = getDb()
  const stmt = d.prepare(
    "SELECT * FROM worktrees WHERE card_id = ? AND status NOT IN ('cleaned', 'error') ORDER BY created_at DESC LIMIT 1"
  )
  return (stmt.get(cardId) as Worktree) ?? null
}

export function getWorktreeByJob(jobId: string): Worktree | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worktrees WHERE job_id = ?')
  return (stmt.get(jobId) as Worktree) ?? null
}

export function createWorktree(data: WorktreeCreate): Worktree {
  const d = getDb()
  const id = cryptoRandomId()
  const now = new Date().toISOString()

  d.prepare(
    `
    INSERT INTO worktrees (
      id, project_id, card_id, job_id, worktree_path, branch_name, base_ref,
      status, locked_by, lock_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    data.projectId,
    data.cardId,
    data.jobId ?? null,
    data.worktreePath,
    data.branchName,
    data.baseRef,
    data.status ?? 'creating',
    data.lockedBy ?? null,
    data.lockExpiresAt ?? null,
    now,
    now
  )

  return d.prepare('SELECT * FROM worktrees WHERE id = ?').get(id) as Worktree
}

export function updateWorktreeStatus(
  id: string,
  status: WorktreeStatus,
  error?: string
): Worktree | null {
  const d = getDb()
  const now = new Date().toISOString()

  // Set cleanup_requested_at when transitioning to cleanup_pending
  if (status === 'cleanup_pending') {
    d.prepare(
      'UPDATE worktrees SET status = ?, last_error = ?, cleanup_requested_at = ?, updated_at = ? WHERE id = ?'
    ).run(status, error ?? null, now, now, id)
  } else {
    d.prepare('UPDATE worktrees SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(
      status,
      error ?? null,
      now,
      id
    )
  }
  return getWorktree(id)
}

export function updateWorktreeJob(id: string, jobId: string | null): Worktree | null {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare('UPDATE worktrees SET job_id = ?, updated_at = ? WHERE id = ?').run(jobId, now, id)
  return getWorktree(id)
}

export function deleteWorktree(id: string): boolean {
  const d = getDb()
  const result = d.prepare('DELETE FROM worktrees WHERE id = ?').run(id)
  return result.changes > 0
}

export function acquireWorktreeLock(
  id: string,
  lockedBy: string,
  ttlMinutes: number = 10
): boolean {
  const d = getDb()
  const now = new Date()
  const lockExpiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()

  // Only acquire if not locked or lock is expired
  const result = d
    .prepare(
      `
    UPDATE worktrees SET
      locked_by = ?,
      lock_expires_at = ?,
      updated_at = ?
    WHERE id = ? AND (locked_by IS NULL OR lock_expires_at < ?)
  `
    )
    .run(lockedBy, lockExpiresAt, now.toISOString(), id, now.toISOString())

  return result.changes > 0
}

export function renewWorktreeLock(
  id: string,
  lockedBy: string,
  ttlMinutes: number = 10
): boolean {
  const d = getDb()
  const now = new Date()
  const lockExpiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()

  const result = d
    .prepare(
      'UPDATE worktrees SET lock_expires_at = ?, updated_at = ? WHERE id = ? AND locked_by = ?'
    )
    .run(lockExpiresAt, now.toISOString(), id, lockedBy)

  return result.changes > 0
}

/**
 * Release a worktree lock. If lockedBy is provided, only releases if it matches the current lock holder.
 * If lockedBy is null, force releases the lock (use with caution, e.g., during reconciliation).
 */
export function releaseWorktreeLock(id: string, lockedBy?: string | null): boolean {
  const d = getDb()
  const now = new Date().toISOString()

  if (lockedBy) {
    // Only release if we own the lock
    const result = d
      .prepare(
        'UPDATE worktrees SET locked_by = NULL, lock_expires_at = NULL, updated_at = ? WHERE id = ? AND locked_by = ?'
      )
      .run(now, id, lockedBy)
    return result.changes > 0
  } else {
    // Force release (for reconciliation/cleanup)
    const result = d
      .prepare(
        'UPDATE worktrees SET locked_by = NULL, lock_expires_at = NULL, updated_at = ? WHERE id = ?'
      )
      .run(now, id)
    return result.changes > 0
  }
}

export function getExpiredWorktreeLocks(): Worktree[] {
  const d = getDb()
  const now = new Date().toISOString()
  const stmt = d.prepare(
    'SELECT * FROM worktrees WHERE locked_by IS NOT NULL AND lock_expires_at < ?'
  )
  return stmt.all(now) as Worktree[]
}

export function countActiveWorktrees(projectId: string): number {
  const d = getDb()
  const now = new Date().toISOString()
  const result = d
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM worktrees
      WHERE project_id = ?
        AND status IN ('creating', 'running')
        AND locked_by IS NOT NULL
        AND (lock_expires_at IS NULL OR lock_expires_at > ?)
    `
    )
    .get(projectId, now) as { count: number }
  return result.count
}

// ==================== App Settings ====================

export function getAppSetting(key: string): string | null {
  const d = getDb()
  const row = d.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setAppSetting(key: string, value: string): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `
  ).run(key, value, now)
}

export function deleteAppSetting(key: string): void {
  const d = getDb()
  d.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
}

// ==================== Subtasks ====================

export interface SubtaskCreate {
  parentCardId: string
  projectId: string
  title: string
  description?: string
  estimatedMinutes?: number
  sequence: number
  remoteIssueNumber?: string
}

export function listSubtasks(parentCardId: string): Subtask[] {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM subtasks WHERE parent_card_id = ? ORDER BY sequence ASC'
  )
  return stmt.all(parentCardId) as Subtask[]
}

export function listSubtasksByProject(projectId: string): Subtask[] {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM subtasks WHERE project_id = ? ORDER BY created_at DESC'
  )
  return stmt.all(projectId) as Subtask[]
}

export function getSubtask(id: string): Subtask | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM subtasks WHERE id = ?')
  return (stmt.get(id) as Subtask) ?? null
}

export function createSubtask(data: SubtaskCreate): Subtask {
  const d = getDb()
  const id = cryptoRandomId()
  const now = new Date().toISOString()

  d.prepare(
    `
    INSERT INTO subtasks (
      id, parent_card_id, project_id, title, description,
      estimated_minutes, sequence, status, remote_issue_number,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `
  ).run(
    id,
    data.parentCardId,
    data.projectId,
    data.title,
    data.description ?? null,
    data.estimatedMinutes ?? null,
    data.sequence,
    data.remoteIssueNumber ?? null,
    now,
    now
  )

  return d.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as Subtask
}

export function updateSubtaskStatus(
  id: string,
  status: SubtaskStatus
): Subtask | null {
  const d = getDb()
  const now = new Date().toISOString()
  const completedAt = status === 'completed' ? now : null

  d.prepare(
    'UPDATE subtasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?'
  ).run(status, completedAt, now, id)

  return getSubtask(id)
}

export function getNextPendingSubtask(parentCardId: string): Subtask | null {
  const d = getDb()
  const stmt = d.prepare(
    `SELECT * FROM subtasks
     WHERE parent_card_id = ? AND status = 'pending'
     ORDER BY sequence ASC LIMIT 1`
  )
  return (stmt.get(parentCardId) as Subtask) ?? null
}

export function deleteSubtask(id: string): boolean {
  const d = getDb()
  const result = d.prepare('DELETE FROM subtasks WHERE id = ?').run(id)
  return result.changes > 0
}

export function deleteSubtasksByCard(cardId: string): number {
  const d = getDb()
  const result = d.prepare('DELETE FROM subtasks WHERE parent_card_id = ?').run(cardId)
  return result.changes
}

// ==================== Worker Slots ====================

export function listWorkerSlots(projectId: string): WorkerSlot[] {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM worker_slots WHERE project_id = ? ORDER BY slot_number ASC'
  )
  return stmt.all(projectId) as WorkerSlot[]
}

export function getWorkerSlot(id: string): WorkerSlot | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worker_slots WHERE id = ?')
  return (stmt.get(id) as WorkerSlot) ?? null
}

export function initializeWorkerSlots(projectId: string, count: number): void {
  const d = getDb()
  const now = new Date().toISOString()

  // Delete existing slots for this project
  d.prepare('DELETE FROM worker_slots WHERE project_id = ?').run(projectId)

  // Create new slots
  const insertStmt = d.prepare(
    `INSERT INTO worker_slots (id, project_id, slot_number, status, updated_at)
     VALUES (?, ?, ?, 'idle', ?)`
  )

  for (let i = 0; i < count; i++) {
    const id = cryptoRandomId()
    insertStmt.run(id, projectId, i, now)
  }
}

export function acquireWorkerSlot(projectId: string): WorkerSlot | null {
  const d = getDb()
  const now = new Date().toISOString()

  // Find first idle slot
  const slot = d
    .prepare(
      `SELECT * FROM worker_slots
       WHERE project_id = ? AND status = 'idle'
       ORDER BY slot_number ASC LIMIT 1`
    )
    .get(projectId) as WorkerSlot | undefined

  if (!slot) return null

  // Mark as running
  d.prepare(
    `UPDATE worker_slots SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`
  ).run(now, now, slot.id)

  return getWorkerSlot(slot.id)
}

export function updateWorkerSlot(
  id: string,
  data: {
    cardId?: string | null
    jobId?: string | null
    worktreeId?: string | null
    status?: WorkerSlotStatus
    startedAt?: string | null
  }
): WorkerSlot | null {
  const d = getDb()
  const now = new Date().toISOString()
  const existing = getWorkerSlot(id)
  if (!existing) return null

  d.prepare(
    `UPDATE worker_slots SET
      card_id = ?, job_id = ?, worktree_id = ?, status = ?, started_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    data.cardId !== undefined ? data.cardId : existing.card_id,
    data.jobId !== undefined ? data.jobId : existing.job_id,
    data.worktreeId !== undefined ? data.worktreeId : existing.worktree_id,
    data.status ?? existing.status,
    data.startedAt !== undefined ? data.startedAt : existing.started_at,
    now,
    id
  )

  return getWorkerSlot(id)
}

export function releaseWorkerSlot(id: string): WorkerSlot | null {
  const d = getDb()
  const now = new Date().toISOString()

  d.prepare(
    `UPDATE worker_slots SET
      card_id = NULL, job_id = NULL, worktree_id = NULL,
      status = 'idle', started_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(now, id)

  return getWorkerSlot(id)
}

export function getIdleSlotCount(projectId: string): number {
  const d = getDb()
  const result = d
    .prepare(
      `SELECT COUNT(*) as count FROM worker_slots
       WHERE project_id = ? AND status = 'idle'`
    )
    .get(projectId) as { count: number }
  return result.count
}

export function getRunningSlotCount(projectId: string): number {
  const d = getDb()
  const result = d
    .prepare(
      `SELECT COUNT(*) as count FROM worker_slots
       WHERE project_id = ? AND status = 'running'`
    )
    .get(projectId) as { count: number }
  return result.count
}

// ==================== Worker Progress ====================

export interface WorkerProgressCreate {
  cardId: string
  jobId?: string
  totalIterations?: number
}

export function getWorkerProgress(cardId: string): WorkerProgress | null {
  const d = getDb()
  const stmt = d.prepare(
    'SELECT * FROM worker_progress WHERE card_id = ? ORDER BY created_at DESC LIMIT 1'
  )
  return (stmt.get(cardId) as WorkerProgress) ?? null
}

export function getWorkerProgressByJob(jobId: string): WorkerProgress | null {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM worker_progress WHERE job_id = ?')
  return (stmt.get(jobId) as WorkerProgress) ?? null
}

export function createWorkerProgress(data: WorkerProgressCreate): WorkerProgress {
  const d = getDb()
  const id = cryptoRandomId()
  const now = new Date().toISOString()

  d.prepare(
    `INSERT INTO worker_progress (
      id, card_id, job_id, iteration, total_iterations,
      subtask_index, subtasks_completed, last_checkpoint,
      created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, 0, 0, ?, ?, ?)`
  ).run(
    id,
    data.cardId,
    data.jobId ?? null,
    data.totalIterations ?? 5,
    now,
    now,
    now
  )

  return d.prepare('SELECT * FROM worker_progress WHERE id = ?').get(id) as WorkerProgress
}

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
  const existing = d.prepare('SELECT * FROM worker_progress WHERE id = ?').get(id) as WorkerProgress | undefined
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

export function clearWorkerProgress(cardId: string): void {
  const d = getDb()
  d.prepare('DELETE FROM worker_progress WHERE card_id = ?').run(cardId)
}

// ==================== Extended Card Queries ====================

/**
 * Get multiple ready cards for parallel processing.
 * Used by worker pool to acquire multiple cards at once.
 */
export function getNextReadyCards(
  projectId: string,
  limit: number,
  retryCooldownMinutes = 30
): Card[] {
  const d = getDb()
  const cooldownTime = new Date(Date.now() - retryCooldownMinutes * 60 * 1000).toISOString()

  const stmt = d.prepare(`
    SELECT c.* FROM cards c
    WHERE c.project_id = ?
      AND c.status = 'ready'
      AND c.provider != 'local'
      AND c.remote_repo_key IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.card_id = c.id
          AND j.type = 'worker_run'
          AND j.state IN ('queued', 'running')
      )
      AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.card_id = c.id
          AND j.type = 'worker_run'
          AND j.state = 'failed'
          AND j.updated_at > ?
      )
    ORDER BY c.updated_local_at ASC
    LIMIT ?
  `)

  return stmt.all(projectId, cooldownTime, limit) as Card[]
}

/**
 * Get count of active worker jobs for a project.
 * Used by worker pool to check capacity.
 */
export function getActiveWorkerJobCount(projectId: string): number {
  const d = getDb()
  const result = d
    .prepare(
      `SELECT COUNT(*) as count FROM jobs
       WHERE project_id = ?
         AND type = 'worker_run'
         AND state IN ('queued', 'running')`
    )
    .get(projectId) as { count: number }
  return result.count
}

// ==================== Utilities ====================

export function cryptoRandomId(): string {
  const buf = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}
