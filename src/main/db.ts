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
  CardStatus,
  JobState,
  JobType,
  EventType
} from '../shared/types'

export type { Project, Card, CardLink, Event, Job, CardStatus }

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
  const result = d.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return result.changes > 0
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

// ==================== Utilities ====================

export function cryptoRandomId(): string {
  const buf = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}
