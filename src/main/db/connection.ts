/**
 * Database Connection and Initialization
 *
 * Handles SQLite database setup, migrations, and connection management.
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

let db: Database.Database | null = null

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

/**
 * Initialize the database connection and run migrations.
 */
export function initDb(): Database.Database {
  const base = app.getPath('userData')
  const dir = join(base, 'kanban')
  ensureDir(dir)
  const file = join(dir, 'kanban.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Run table creation and migrations
  createTables(db)
  runMigrations(db)

  return db
}

/**
 * Get the database connection. Initializes if not already done.
 */
export function getDb(): Database.Database {
  if (!db) return initDb()
  return db
}

/**
 * Create all required tables.
 */
function createTables(database: Database.Database): void {
  // Projects table
  database.exec(`
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

  // Cards table
  database.exec(`
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

  // Card links table (for PR/MR associations)
  database.exec(`
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
  database.exec(`
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
  database.exec(`
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
  database.exec(`
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
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  // Worktrees table (for tracking git worktree lifecycle)
  database.exec(`
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

  // Subtasks table (for decomposed tasks)
  database.exec(`
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
  database.exec(`
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
  database.exec(`
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
}

/**
 * Run database migrations for schema changes.
 */
function runMigrations(database: Database.Database): void {
  // Migration: Add missing columns to projects table
  const projectColumns = database.pragma('table_info(projects)') as { name: string }[]
  const projectColumnNames = projectColumns.map((c) => c.name)
  if (!projectColumnNames.includes('worker_enabled')) {
    database.exec('ALTER TABLE projects ADD COLUMN worker_enabled INTEGER NOT NULL DEFAULT 0')
  }
  if (!projectColumnNames.includes('last_sync_at')) {
    database.exec('ALTER TABLE projects ADD COLUMN last_sync_at TEXT')
  }

  // Migration: Add missing columns to cards table
  const cardColumns = database.pragma('table_info(cards)') as { name: string }[]
  const cardColumnNames = cardColumns.map((c) => c.name)
  if (!cardColumnNames.includes('remote_node_id')) {
    database.exec('ALTER TABLE cards ADD COLUMN remote_node_id TEXT')
  }

  // Migration: Add cleanup_requested_at column to worktrees
  try {
    database.exec('ALTER TABLE worktrees ADD COLUMN cleanup_requested_at TEXT')
  } catch {
    // Column already exists
  }
}
