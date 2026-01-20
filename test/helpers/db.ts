/**
 * Database Test Utilities
 *
 * Provides isolated in-memory SQLite databases for testing.
 * Each test suite gets its own database instance to ensure complete isolation.
 */
import Database from 'better-sqlite3'

let testSqlite: Database.Database | null = null

/**
 * Create an isolated in-memory database for testing.
 * Runs all table creation SQL to match production schema.
 */
export function createTestDatabase(): Database.Database {
  // Use in-memory SQLite
  testSqlite = new Database(':memory:')
  testSqlite.pragma('journal_mode = WAL')
  testSqlite.pragma('foreign_keys = ON')

  // Create all tables
  createTestTables(testSqlite)

  return testSqlite
}

/**
 * Get the current test database instance.
 * Throws if no database has been created.
 */
export function getTestDatabase(): Database.Database {
  if (!testSqlite) {
    throw new Error('Test database not initialized. Call createTestDatabase() first.')
  }
  return testSqlite
}

/**
 * Reset database state between tests by clearing all tables.
 */
export function resetTestDatabase(): void {
  if (!testSqlite) return

  // Clear all tables in reverse dependency order
  const tables = [
    'feature_suggestion_votes',
    'feature_suggestions',
    'card_dependencies',
    'agent_chat_messages',
    'ai_profiles',
    'usage_records',
    'ai_tool_limits',
    'follow_up_instructions',
    'plan_approvals',
    'worker_progress',
    'worker_slots',
    'subtasks',
    'worktrees',
    'events',
    'card_links',
    'jobs',
    'cards',
    'sync_state',
    'projects',
    'app_settings'
  ]

  for (const table of tables) {
    try {
      testSqlite.exec(`DELETE FROM ${table}`)
    } catch {
      // Table may not exist in some test scenarios
    }
  }
}

/**
 * Close and cleanup test database.
 */
export function closeTestDatabase(): void {
  if (testSqlite) {
    testSqlite.close()
    testSqlite = null
  }
}

/**
 * Create all required tables matching production schema.
 */
function createTestTables(database: Database.Database): void {
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
      has_conflicts INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cards_project_id ON cards(project_id);
    CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
  `)

  // Card links table
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
  `)

  // Events table
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
  `)

  // Jobs table
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
  `)

  // Sync state table
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

  // App settings table
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  // Worktrees table
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
  `)

  // Subtasks table
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
  `)

  // Worker slots table
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
      UNIQUE(project_id, slot_number)
    );
  `)

  // Worker progress table
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
  `)

  // Plan approvals table
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
  `)

  // Follow-up instructions table
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
  `)

  // Usage records table
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
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `)

  // AI tool limits table
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_tool_limits (
      id TEXT PRIMARY KEY,
      tool_type TEXT NOT NULL UNIQUE,
      hourly_token_limit INTEGER,
      daily_token_limit INTEGER,
      monthly_token_limit INTEGER,
      hourly_cost_limit_usd REAL,
      daily_cost_limit_usd REAL,
      monthly_cost_limit_usd REAL,
      updated_at TEXT NOT NULL
    );
  `)

  // Agent chat messages table
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
  `)

  // AI profiles table
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
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
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, name)
    );
  `)

  // Feature suggestions table
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
  `)

  // Feature suggestion votes table
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
  `)

  // Card dependencies table
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
  `)
}

/**
 * Create a test project in the database.
 */
export function createTestProject(
  db: Database.Database,
  overrides: Partial<{
    id: string
    name: string
    local_path: string
    policy_json: string
  }> = {}
): string {
  const id = overrides.id ?? `test-project-${Date.now()}`
  const now = new Date().toISOString()

  db.prepare(
    `
    INSERT INTO projects (id, name, local_path, policy_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    overrides.name ?? 'Test Project',
    overrides.local_path ?? '/tmp/test-project',
    overrides.policy_json ?? '{}',
    now,
    now
  )

  return id
}

/**
 * Create a test card in the database.
 */
export function createTestCard(
  db: Database.Database,
  projectId: string,
  overrides: Partial<{
    id: string
    title: string
    status: string
    type: string
    provider: string
  }> = {}
): string {
  const id = overrides.id ?? `test-card-${Date.now()}`
  const now = new Date().toISOString()

  db.prepare(
    `
    INSERT INTO cards (id, project_id, provider, type, title, status, updated_local_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    projectId,
    overrides.provider ?? 'local',
    overrides.type ?? 'issue',
    overrides.title ?? 'Test Card',
    overrides.status ?? 'draft',
    now
  )

  return id
}
