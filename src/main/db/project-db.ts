/**
 * Project Database Manager
 *
 * Manages per-project SQLite database connections in .flowpatch/project.db.
 * Each project has its own database containing cards, jobs, events, etc.
 *
 * Features:
 * - Connection pooling with automatic cleanup
 * - Lazy initialization on first access
 * - Automatic table creation for new projects
 */

import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as projectSchema from './schema/project'

// Connection cache entry
interface ProjectDbEntry {
  db: BetterSQLite3Database<typeof projectSchema>
  sqlite: Database.Database
  lastAccess: number
}

// Cache of open project database connections
const projectDbs = new Map<string, ProjectDbEntry>()

// Idle timeout for auto-closing connections (5 minutes)
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

// Cleanup interval (1 minute)
const CLEANUP_INTERVAL_MS = 60 * 1000

// Cleanup timer reference
let cleanupTimer: ReturnType<typeof setInterval> | null = null

/**
 * Ensure a directory exists.
 */
function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

/**
 * Get the path to the project database file.
 */
export function getProjectDbPath(projectPath: string): string {
  return join(projectPath, '.flowpatch', 'project.db')
}

/**
 * Check if a project has a local database.
 */
export function hasProjectDb(projectPath: string): boolean {
  return existsSync(getProjectDbPath(projectPath))
}

/**
 * Create tables in a project database.
 */
function createProjectTables(sqlite: Database.Database): void {
  // Cards table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
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
      has_conflicts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
    CREATE INDEX IF NOT EXISTS idx_cards_remote ON cards(remote_repo_key, remote_number_or_iid);
  `)

  // Card links table
  sqlite.exec(`
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

  // Card dependencies table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS card_dependencies (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      depends_on_card_id TEXT NOT NULL,
      blocking_statuses_json TEXT NOT NULL DEFAULT '["ready","in_progress"]',
      required_status TEXT NOT NULL DEFAULT 'done',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_card_id) REFERENCES cards(id) ON DELETE CASCADE,
      UNIQUE(card_id, depends_on_card_id)
    );
    CREATE INDEX IF NOT EXISTS idx_card_deps_card ON card_dependencies(card_id);
    CREATE INDEX IF NOT EXISTS idx_card_deps_depends_on ON card_dependencies(depends_on_card_id);
    CREATE INDEX IF NOT EXISTS idx_card_deps_active ON card_dependencies(card_id, is_active);
  `)

  // Events table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_events_card_id ON events(card_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  `)

  // Jobs table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
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
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
  `)

  // Worktrees table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
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
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
      UNIQUE(worktree_path),
      UNIQUE(branch_name)
    );
    CREATE INDEX IF NOT EXISTS idx_worktrees_card ON worktrees(card_id);
    CREATE INDEX IF NOT EXISTS idx_worktrees_status ON worktrees(status);
    CREATE INDEX IF NOT EXISTS idx_worktrees_locked ON worktrees(locked_by, lock_expires_at);
  `)

  // Subtasks table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      parent_card_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      estimated_minutes INTEGER,
      sequence INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      remote_issue_number TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (parent_card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_parent ON subtasks(parent_card_id);
    CREATE INDEX IF NOT EXISTS idx_subtasks_status ON subtasks(status);
  `)

  // Worker slots table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS worker_slots (
      id TEXT PRIMARY KEY,
      slot_number INTEGER NOT NULL UNIQUE,
      card_id TEXT,
      job_id TEXT,
      worktree_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      started_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
      FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_slots_status ON worker_slots(status);
  `)

  // Worker progress table
  sqlite.exec(`
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

  // Plan approvals table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS plan_approvals (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      planning_mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewer_notes TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plan_approvals_job ON plan_approvals(job_id);
    CREATE INDEX IF NOT EXISTS idx_plan_approvals_card ON plan_approvals(card_id);
    CREATE INDEX IF NOT EXISTS idx_plan_approvals_status ON plan_approvals(status);
  `)

  // Follow-up instructions table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS follow_up_instructions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      instruction_type TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      processed_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_follow_up_job ON follow_up_instructions(job_id);
    CREATE INDEX IF NOT EXISTS idx_follow_up_card ON follow_up_instructions(card_id);
    CREATE INDEX IF NOT EXISTS idx_follow_up_status ON follow_up_instructions(status);
  `)

  // Usage records table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      card_id TEXT,
      tool_type TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_job ON usage_records(job_id);
    CREATE INDEX IF NOT EXISTS idx_usage_tool ON usage_records(tool_type);
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
  `)

  // Agent chat messages table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_chat_messages (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_chat_job ON agent_chat_messages(job_id);
    CREATE INDEX IF NOT EXISTS idx_agent_chat_card ON agent_chat_messages(card_id);
    CREATE INDEX IF NOT EXISTS idx_agent_chat_role ON agent_chat_messages(role);
    CREATE INDEX IF NOT EXISTS idx_agent_chat_created ON agent_chat_messages(created_at);
  `)

  // AI profiles table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ai_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      model_provider TEXT NOT NULL DEFAULT 'auto',
      model_name TEXT,
      temperature REAL,
      max_tokens INTEGER,
      top_p REAL,
      system_prompt TEXT,
      thinking_enabled INTEGER,
      thinking_mode TEXT,
      thinking_budget_tokens INTEGER,
      planning_enabled INTEGER,
      planning_mode TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_profiles_default ON ai_profiles(is_default);
  `)

  // Feature suggestions table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS feature_suggestions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'feature',
      priority INTEGER NOT NULL DEFAULT 0,
      vote_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feature_suggestions_status ON feature_suggestions(status);
    CREATE INDEX IF NOT EXISTS idx_feature_suggestions_category ON feature_suggestions(category);
    CREATE INDEX IF NOT EXISTS idx_feature_suggestions_votes ON feature_suggestions(vote_count);
  `)

  // Feature suggestion votes table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS feature_suggestion_votes (
      id TEXT PRIMARY KEY,
      suggestion_id TEXT NOT NULL,
      voter_id TEXT,
      vote_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (suggestion_id) REFERENCES feature_suggestions(id) ON DELETE CASCADE,
      UNIQUE(suggestion_id, voter_id)
    );
    CREATE INDEX IF NOT EXISTS idx_feature_votes_suggestion ON feature_suggestion_votes(suggestion_id);
  `)

  // Sync state table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      cursor_type TEXT NOT NULL,
      cursor_value TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, cursor_type)
    );
  `)

  // Card comments table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS card_comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      remote_comment_id TEXT,
      author TEXT,
      body TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      sync_state TEXT NOT NULL DEFAULT 'ok',
      priority TEXT NOT NULL DEFAULT 'normal',
      resolution TEXT NOT NULL DEFAULT 'open',
      resolved_at TEXT,
      resolved_by_job_id TEXT,
      include_in_next_run INTEGER NOT NULL DEFAULT 1,
      processed_for_job_id TEXT,
      processed_at TEXT,
      created_at TEXT NOT NULL,
      remote_created_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_comment_card ON card_comments(card_id);
    CREATE INDEX IF NOT EXISTS idx_comment_remote ON card_comments(remote_comment_id);
    CREATE INDEX IF NOT EXISTS idx_comment_resolution ON card_comments(resolution);
    CREATE INDEX IF NOT EXISTS idx_comment_sync_state ON card_comments(sync_state);
  `)
}

/**
 * Initialize or get a project database connection.
 */
export function initProjectDb(projectPath: string): BetterSQLite3Database<typeof projectSchema> {
  // Check cache first
  const cached = projectDbs.get(projectPath)
  if (cached) {
    cached.lastAccess = Date.now()
    return cached.db
  }

  // Ensure .flowpatch directory exists
  const flowpatchDir = join(projectPath, '.flowpatch')
  ensureDir(flowpatchDir)

  // Create/open database
  const dbPath = getProjectDbPath(projectPath)
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  // Create tables if this is a new database
  createProjectTables(sqlite)

  // Create Drizzle instance
  const db = drizzle(sqlite, { schema: projectSchema })

  // Cache the connection
  projectDbs.set(projectPath, {
    db,
    sqlite,
    lastAccess: Date.now()
  })

  // Start cleanup timer if not already running
  startCleanupTimer()

  return db
}

/**
 * Get a project database connection. Initializes if not already done.
 */
export function getProjectDrizzle(
  projectPath: string
): BetterSQLite3Database<typeof projectSchema> {
  return initProjectDb(projectPath)
}

/**
 * Get the underlying better-sqlite3 instance for a project.
 */
export function getProjectSqlite(projectPath: string): Database.Database {
  const entry = projectDbs.get(projectPath)
  if (entry) {
    entry.lastAccess = Date.now()
    return entry.sqlite
  }

  // Initialize and return
  initProjectDb(projectPath)
  return projectDbs.get(projectPath)!.sqlite
}

/**
 * Close a specific project database connection.
 */
export function closeProjectDb(projectPath: string): void {
  const entry = projectDbs.get(projectPath)
  if (entry) {
    try {
      entry.sqlite.close()
    } catch {
      // Ignore errors when closing
    }
    projectDbs.delete(projectPath)
  }
}

/**
 * Close all project database connections.
 */
export function closeAllProjectDbs(): void {
  for (const [, entry] of projectDbs) {
    try {
      entry.sqlite.close()
    } catch {
      // Ignore errors when closing
    }
  }
  projectDbs.clear()
  stopCleanupTimer()
}

/**
 * Start the cleanup timer for idle connections.
 */
function startCleanupTimer(): void {
  if (cleanupTimer) return

  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [projectPath, entry] of projectDbs) {
      if (now - entry.lastAccess > IDLE_TIMEOUT_MS) {
        closeProjectDb(projectPath)
      }
    }

    // Stop timer if no connections remain
    if (projectDbs.size === 0) {
      stopCleanupTimer()
    }
  }, CLEANUP_INTERVAL_MS)
}

/**
 * Stop the cleanup timer.
 */
function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

/**
 * Get the number of open project database connections.
 */
export function getOpenConnectionCount(): number {
  return projectDbs.size
}

/**
 * Get paths of all open project databases.
 */
export function getOpenProjectPaths(): string[] {
  return Array.from(projectDbs.keys())
}

// Re-export project schema for convenience
export { projectSchema }
