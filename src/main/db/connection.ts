/**
 * Database Connection and Initialization
 *
 * This module provides backward compatibility with the old raw SQL interface
 * while the codebase transitions to Drizzle ORM.
 *
 * For new code, use `getDrizzle()` from './drizzle' instead.
 * The schema is defined in schema/*.ts files.
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { initDrizzle, getSqlite } from './drizzle'

let initialized = false

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

/**
 * Initialize the database connection and run migrations.
 */
export function initDb(): Database.Database {
  if (!initialized) {
    const base = app.getPath('userData')
    const dir = join(base, 'kanban')
    ensureDir(dir)

    // Initialize Drizzle (which creates the underlying better-sqlite3 connection)
    initDrizzle()

    // Create tables and run migrations using raw sqlite
    createTables(getSqlite())
    runMigrations(getSqlite())

    initialized = true
  }
  return getSqlite()
}

/**
 * Get the database connection. Initializes if not already done.
 * @deprecated Use getDrizzle() from './drizzle' for new code
 */
export function getDb(): Database.Database {
  if (!initialized) return initDb()
  return getSqlite()
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

  // Plan approvals table (for review before AI execution)
  database.exec(`
    CREATE TABLE IF NOT EXISTS plan_approvals (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      planning_mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewer_notes TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plan_approvals_job ON plan_approvals(job_id);
    CREATE INDEX IF NOT EXISTS idx_plan_approvals_card ON plan_approvals(card_id);
    CREATE INDEX IF NOT EXISTS idx_plan_approvals_project ON plan_approvals(project_id);
    CREATE INDEX IF NOT EXISTS idx_plan_approvals_status ON plan_approvals(status);
  `)

  // Follow-up instructions table (for providing feedback to running/paused workers)
  database.exec(`
    CREATE TABLE IF NOT EXISTS follow_up_instructions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      instruction_type TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      processed_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_follow_up_job ON follow_up_instructions(job_id);
    CREATE INDEX IF NOT EXISTS idx_follow_up_card ON follow_up_instructions(card_id);
    CREATE INDEX IF NOT EXISTS idx_follow_up_project ON follow_up_instructions(project_id);
    CREATE INDEX IF NOT EXISTS idx_follow_up_status ON follow_up_instructions(status);
  `)

  // Usage records table (for tracking AI tool usage)
  database.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
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
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_records(project_id);
    CREATE INDEX IF NOT EXISTS idx_usage_job ON usage_records(job_id);
    CREATE INDEX IF NOT EXISTS idx_usage_tool ON usage_records(tool_type);
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
  `)

  // AI tool limits table (for configuring usage limits per tool)
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_tool_limits (
      id TEXT PRIMARY KEY,
      tool_type TEXT NOT NULL UNIQUE,
      daily_token_limit INTEGER,
      monthly_token_limit INTEGER,
      daily_cost_limit_usd REAL,
      monthly_cost_limit_usd REAL,
      updated_at TEXT NOT NULL
    );
  `)

  // Agent chat messages table (for interactive chat during worker execution)
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_chat_messages (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_chat_job ON agent_chat_messages(job_id);
    CREATE INDEX IF NOT EXISTS idx_agent_chat_card ON agent_chat_messages(card_id);
    CREATE INDEX IF NOT EXISTS idx_agent_chat_project ON agent_chat_messages(project_id);
    CREATE INDEX IF NOT EXISTS idx_agent_chat_role ON agent_chat_messages(role);
    CREATE INDEX IF NOT EXISTS idx_agent_chat_created ON agent_chat_messages(created_at);
  `)

  // AI profiles table (for storing different AI configuration profiles)
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,

      -- Model configuration
      model_provider TEXT NOT NULL DEFAULT 'auto',
      model_name TEXT,

      -- Model parameters
      temperature REAL,
      max_tokens INTEGER,
      top_p REAL,

      -- Custom instructions
      system_prompt TEXT,

      -- AI Features
      thinking_enabled INTEGER,
      thinking_mode TEXT,
      thinking_budget_tokens INTEGER,
      planning_enabled INTEGER,
      planning_mode TEXT,

      -- Timestamps
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,

      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_profiles_project ON ai_profiles(project_id);
    CREATE INDEX IF NOT EXISTS idx_ai_profiles_default ON ai_profiles(project_id, is_default);
  `)

  // Feature suggestions table (for user-submitted feature ideas)
  database.exec(`
    CREATE TABLE IF NOT EXISTS feature_suggestions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'feature',
      priority INTEGER NOT NULL DEFAULT 0,
      vote_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_feature_suggestions_project ON feature_suggestions(project_id);
    CREATE INDEX IF NOT EXISTS idx_feature_suggestions_status ON feature_suggestions(status);
    CREATE INDEX IF NOT EXISTS idx_feature_suggestions_category ON feature_suggestions(category);
    CREATE INDEX IF NOT EXISTS idx_feature_suggestions_votes ON feature_suggestions(vote_count);
  `)

  // Feature suggestion votes table (for tracking votes on suggestions)
  database.exec(`
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

  // Card dependencies table (for dependency blocking feature)
  database.exec(`
    CREATE TABLE IF NOT EXISTS card_dependencies (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      depends_on_card_id TEXT NOT NULL,
      blocking_statuses_json TEXT NOT NULL DEFAULT '["ready","in_progress"]',
      required_status TEXT NOT NULL DEFAULT 'done',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_card_id) REFERENCES cards(id) ON DELETE CASCADE,
      UNIQUE(card_id, depends_on_card_id)
    );
    CREATE INDEX IF NOT EXISTS idx_card_deps_project ON card_dependencies(project_id);
    CREATE INDEX IF NOT EXISTS idx_card_deps_card ON card_dependencies(card_id);
    CREATE INDEX IF NOT EXISTS idx_card_deps_depends_on ON card_dependencies(depends_on_card_id);
    CREATE INDEX IF NOT EXISTS idx_card_deps_active ON card_dependencies(card_id, is_active);
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
  if (!cardColumnNames.includes('has_conflicts')) {
    database.exec('ALTER TABLE cards ADD COLUMN has_conflicts INTEGER NOT NULL DEFAULT 0')
  }

  // Migration: Add cleanup_requested_at column to worktrees
  try {
    database.exec('ALTER TABLE worktrees ADD COLUMN cleanup_requested_at TEXT')
  } catch {
    // Column already exists
  }
}
