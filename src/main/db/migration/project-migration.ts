/**
 * Project Data Migration Service
 *
 * Handles migration of project-specific data from the central database
 * to project-local databases in .flowpatch/project.db.
 *
 * Migration flow:
 * 1. Check if project has data in central DB
 * 2. Create .flowpatch/project.db if not exists
 * 3. Copy all project data from central to project DB
 * 4. Mark project as migrated in central DB
 * 5. (Optional) Clean up central DB data
 */

import { getDrizzle, getSqlite } from '../drizzle'
import { initProjectDb, getProjectSqlite, hasProjectDb } from '../project-db'
import { eq } from 'drizzle-orm'
import * as centralSchema from '../schema'

export interface MigrationResult {
  success: boolean
  tablesMigrated: string[]
  recordsCopied: Record<string, number>
  errors: string[]
  duration_ms: number
}

export type MigrationStatus = 'not_started' | 'migrated' | 'error'

/**
 * Check if a project has been migrated to local storage.
 */
export function isProjectMigrated(projectPath: string): boolean {
  return hasProjectDb(projectPath)
}

/**
 * Get migration status for a project.
 */
export function getMigrationStatus(projectId: string): MigrationStatus {
  const db = getDrizzle()
  const project = db
    .select({ local_db_migrated: centralSchema.projects.local_db_migrated })
    .from(centralSchema.projects)
    .where(eq(centralSchema.projects.id, projectId))
    .get()

  if (!project) return 'not_started'
  return project.local_db_migrated === 1 ? 'migrated' : 'not_started'
}

/**
 * Migrate project data from central DB to project-local DB.
 *
 * Migration order respects foreign key constraints:
 * 1. cards (no dependencies in project DB)
 * 2. card_links, card_dependencies, subtasks (depend on cards)
 * 3. events, jobs (depend on cards)
 * 4. worktrees (depends on cards, jobs)
 * 5. worker_slots, worker_progress (depend on cards, jobs, worktrees)
 * 6. plan_approvals, follow_up_instructions (depend on cards, jobs)
 * 7. usage_records, agent_chat_messages (depend on cards, jobs)
 * 8. ai_profiles, feature_suggestions, feature_suggestion_votes
 * 9. sync_state
 */
export function migrateProjectToLocalDb(projectId: string, projectPath: string): MigrationResult {
  const startTime = Date.now()
  const result: MigrationResult = {
    success: false,
    tablesMigrated: [],
    recordsCopied: {},
    errors: [],
    duration_ms: 0
  }

  try {
    // Initialize project DB (creates tables)
    initProjectDb(projectPath)

    const centralSqlite = getSqlite()
    const projectSqlite = getProjectSqlite(projectPath)

    // Migration table order (respecting foreign keys)
    const migrations = [
      { table: 'cards', columns: getCardColumns() },
      { table: 'card_links', columns: getCardLinkColumns() },
      { table: 'card_dependencies', columns: getCardDependencyColumns() },
      { table: 'subtasks', columns: getSubtaskColumns() },
      { table: 'events', columns: getEventColumns() },
      { table: 'jobs', columns: getJobColumns() },
      { table: 'worktrees', columns: getWorktreeColumns() },
      { table: 'worker_slots', columns: getWorkerSlotColumns() },
      { table: 'worker_progress', columns: getWorkerProgressColumns() },
      { table: 'plan_approvals', columns: getPlanApprovalColumns() },
      { table: 'follow_up_instructions', columns: getFollowUpInstructionColumns() },
      { table: 'usage_records', columns: getUsageRecordColumns() },
      { table: 'agent_chat_messages', columns: getAgentChatMessageColumns() },
      { table: 'ai_profiles', columns: getAiProfileColumns() },
      { table: 'feature_suggestions', columns: getFeatureSuggestionColumns() },
      { table: 'feature_suggestion_votes', columns: getFeatureSuggestionVoteColumns() },
      { table: 'sync_state', columns: getSyncStateColumns() }
    ]

    // Run migrations in a transaction
    projectSqlite.exec('BEGIN TRANSACTION')

    try {
      for (const { table, columns } of migrations) {
        const count = migrateTable(centralSqlite, projectSqlite, table, columns, projectId)
        result.recordsCopied[table] = count
        if (count > 0) {
          result.tablesMigrated.push(table)
        }
      }

      projectSqlite.exec('COMMIT')
    } catch (err) {
      projectSqlite.exec('ROLLBACK')
      throw err
    }

    // Mark project as migrated in central DB
    centralSqlite.exec(
      `UPDATE projects SET local_db_migrated = 1, updated_at = datetime('now') WHERE id = '${projectId}'`
    )

    result.success = true
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err))
  }

  result.duration_ms = Date.now() - startTime
  return result
}

/**
 * Migrate a single table from central to project DB.
 */
function migrateTable(
  centralSqlite: import('better-sqlite3').Database,
  projectSqlite: import('better-sqlite3').Database,
  table: string,
  columns: { central: string[]; project: string[] },
  projectId: string
): number {
  // Build SELECT query for central DB
  const selectColumns = columns.central.join(', ')
  const selectQuery = `SELECT ${selectColumns} FROM ${table} WHERE project_id = ?`

  // Get rows from central DB
  const rows = centralSqlite.prepare(selectQuery).all(projectId) as Record<string, unknown>[]

  if (rows.length === 0) {
    return 0
  }

  // Build INSERT query for project DB
  const insertColumns = columns.project.join(', ')
  const placeholders = columns.project.map(() => '?').join(', ')
  const insertQuery = `INSERT OR REPLACE INTO ${table} (${insertColumns}) VALUES (${placeholders})`

  const insertStmt = projectSqlite.prepare(insertQuery)

  // Insert each row
  for (const row of rows) {
    const values = columns.project.map((col) => {
      // Map central column to project column value
      const centralCol = columns.central[columns.project.indexOf(col)]
      return row[centralCol]
    })
    insertStmt.run(...values)
  }

  return rows.length
}

// Column mappings for each table
// Central columns include project_id, project columns exclude it

function getCardColumns() {
  const common = [
    'id',
    'provider',
    'type',
    'title',
    'body',
    'status',
    'ready_eligible',
    'assignees_json',
    'labels_json',
    'remote_url',
    'remote_repo_key',
    'remote_number_or_iid',
    'remote_node_id',
    'updated_remote_at',
    'updated_local_at',
    'sync_state',
    'last_error',
    'has_conflicts'
  ]
  return { central: common, project: common }
}

function getCardLinkColumns() {
  const common = [
    'id',
    'card_id',
    'linked_type',
    'linked_url',
    'linked_remote_repo_key',
    'linked_number_or_iid',
    'created_at'
  ]
  return { central: common, project: common }
}

function getCardDependencyColumns() {
  const common = [
    'id',
    'card_id',
    'depends_on_card_id',
    'blocking_statuses_json',
    'required_status',
    'is_active',
    'created_at',
    'updated_at'
  ]
  return { central: common, project: common }
}

function getSubtaskColumns() {
  const common = [
    'id',
    'parent_card_id',
    'title',
    'description',
    'estimated_minutes',
    'sequence',
    'status',
    'remote_issue_number',
    'created_at',
    'updated_at',
    'completed_at'
  ]
  return { central: common, project: common }
}

function getEventColumns() {
  const common = ['id', 'card_id', 'type', 'payload_json', 'created_at']
  return { central: common, project: common }
}

function getJobColumns() {
  const common = [
    'id',
    'card_id',
    'type',
    'state',
    'lease_until',
    'attempts',
    'payload_json',
    'result_json',
    'last_error',
    'created_at',
    'updated_at'
  ]
  return { central: common, project: common }
}

function getWorktreeColumns() {
  const common = [
    'id',
    'card_id',
    'job_id',
    'worktree_path',
    'branch_name',
    'base_ref',
    'status',
    'last_error',
    'locked_by',
    'lock_expires_at',
    'cleanup_requested_at',
    'created_at',
    'updated_at'
  ]
  return { central: common, project: common }
}

function getWorkerSlotColumns() {
  const common = [
    'id',
    'slot_number',
    'card_id',
    'job_id',
    'worktree_id',
    'status',
    'started_at',
    'updated_at'
  ]
  return { central: common, project: common }
}

function getWorkerProgressColumns() {
  const common = [
    'id',
    'card_id',
    'job_id',
    'iteration',
    'total_iterations',
    'subtask_index',
    'subtasks_completed',
    'files_modified_json',
    'context_summary',
    'progress_file_path',
    'last_checkpoint',
    'created_at',
    'updated_at'
  ]
  return { central: common, project: common }
}

function getPlanApprovalColumns() {
  const common = [
    'id',
    'job_id',
    'card_id',
    'plan',
    'planning_mode',
    'status',
    'reviewer_notes',
    'created_at',
    'reviewed_at'
  ]
  return { central: common, project: common }
}

function getFollowUpInstructionColumns() {
  const common = [
    'id',
    'job_id',
    'card_id',
    'instruction_type',
    'content',
    'status',
    'priority',
    'created_at',
    'processed_at'
  ]
  return { central: common, project: common }
}

function getUsageRecordColumns() {
  const common = [
    'id',
    'job_id',
    'card_id',
    'tool_type',
    'input_tokens',
    'output_tokens',
    'total_tokens',
    'cost_usd',
    'duration_ms',
    'model',
    'created_at'
  ]
  return { central: common, project: common }
}

function getAgentChatMessageColumns() {
  const common = [
    'id',
    'job_id',
    'card_id',
    'role',
    'content',
    'status',
    'metadata_json',
    'created_at',
    'updated_at'
  ]
  return { central: common, project: common }
}

function getAiProfileColumns() {
  const common = [
    'id',
    'name',
    'description',
    'is_default',
    'model_provider',
    'model_name',
    'temperature',
    'max_tokens',
    'top_p',
    'system_prompt',
    'thinking_enabled',
    'thinking_mode',
    'thinking_budget_tokens',
    'planning_enabled',
    'planning_mode',
    'created_at',
    'updated_at'
  ]
  return { central: common, project: common }
}

function getFeatureSuggestionColumns() {
  const common = [
    'id',
    'title',
    'description',
    'category',
    'priority',
    'vote_count',
    'status',
    'created_by',
    'created_at',
    'updated_at'
  ]
  return { central: common, project: common }
}

function getFeatureSuggestionVoteColumns() {
  // This table doesn't have project_id, it links to feature_suggestions
  // We need to join to get the project_id
  const common = ['id', 'suggestion_id', 'voter_id', 'vote_type', 'created_at']
  return { central: common, project: common }
}

function getSyncStateColumns() {
  const common = ['id', 'provider', 'cursor_type', 'cursor_value', 'updated_at']
  return { central: common, project: common }
}

/**
 * Clean up project data from central DB after migration.
 * This is optional and should be called explicitly by the user.
 */
export function cleanupCentralData(projectId: string): void {
  const sqlite = getSqlite()

  // Delete in reverse order of foreign key dependencies
  const tables = [
    'feature_suggestion_votes',
    'feature_suggestions',
    'sync_state',
    'ai_profiles',
    'agent_chat_messages',
    'usage_records',
    'follow_up_instructions',
    'plan_approvals',
    'worker_progress',
    'worker_slots',
    'worktrees',
    'jobs',
    'events',
    'subtasks',
    'card_dependencies',
    'card_links',
    'cards'
  ]

  sqlite.exec('BEGIN TRANSACTION')

  try {
    for (const table of tables) {
      sqlite.exec(`DELETE FROM ${table} WHERE project_id = '${projectId}'`)
    }
    sqlite.exec('COMMIT')
  } catch {
    sqlite.exec('ROLLBACK')
    throw new Error(`Failed to cleanup central data for project ${projectId}`)
  }
}

/**
 * Check if a project has data in the central database.
 */
export function hasDataInCentralDb(projectId: string): boolean {
  const sqlite = getSqlite()
  const result = sqlite
    .prepare('SELECT COUNT(*) as count FROM cards WHERE project_id = ?')
    .get(projectId) as { count: number }
  return result.count > 0
}

/**
 * Get count of records in central DB for a project.
 */
export function getCentralDataCounts(projectId: string): Record<string, number> {
  const sqlite = getSqlite()
  const tables = [
    'cards',
    'card_links',
    'card_dependencies',
    'events',
    'jobs',
    'worktrees',
    'subtasks',
    'worker_slots',
    'worker_progress',
    'plan_approvals',
    'follow_up_instructions',
    'usage_records',
    'agent_chat_messages',
    'ai_profiles',
    'feature_suggestions',
    'sync_state'
  ]

  const counts: Record<string, number> = {}

  for (const table of tables) {
    try {
      const result = sqlite
        .prepare(`SELECT COUNT(*) as count FROM ${table} WHERE project_id = ?`)
        .get(projectId) as { count: number }
      counts[table] = result.count
    } catch {
      counts[table] = 0
    }
  }

  return counts
}
