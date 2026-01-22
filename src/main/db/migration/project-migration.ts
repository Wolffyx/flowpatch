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
import { migrateProjectSettingsToConfig } from './settings-migration'
import { logAction } from '@shared/utils'
import { clearProjectPathCache } from '../db-resolver'

export interface MigrationResult {
  success: boolean
  tablesMigrated: string[]
  recordsCopied: Record<string, number>
  errors: string[]
  warnings: string[]
  duration_ms: number
  verification?: MigrationVerification
}

export interface MigrationVerification {
  passed: boolean
  centralRecords: number
  projectRecords: number
  missingTables: string[]
  recordMismatches: Array<{ table: string; central: number; project: number }>
}

export interface MigrationProgress {
  phase: 'validating' | 'migrating' | 'verifying' | 'complete'
  currentTable?: string
  tablesCompleted: number
  totalTables: number
  recordsProcessed: number
  totalRecords: number
  message: string
}

export type MigrationStatus = 'not_started' | 'migrated' | 'error'

// Progress callback type for streaming updates to UI
export type ProgressCallback = (progress: MigrationProgress) => void

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
 * Get existing columns for a table in the database.
 */
function getTableColumns(
  sqlite: import('better-sqlite3').Database,
  table: string
): Set<string> {
  try {
    const columns = sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>
    return new Set(columns.map((col) => col.name))
  } catch (err) {
    logAction('getTableColumns:error', {
      table,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    })
    return new Set()
  }
}

/**
 * Get default value for a column based on schema knowledge.
 */
function getColumnDefault(table: string, column: string): unknown {
  // Default values based on schema
  const defaults: Record<string, Record<string, unknown>> = {
    cards: {
      has_conflicts: 0,
      ready_eligible: 0,
      sync_state: 'ok'
    },
    worktrees: {
      has_conflicts: 0
    }
  }

  return defaults[table]?.[column] ?? null
}

/**
 * Validate pre-migration conditions.
 * Checks disk space, permissions, and project state.
 */
function validatePreMigration(projectPath: string): string[] {
  const warnings: string[] = []
  const path = require('path')
  const fs = require('fs')

  // Check if .flowpatch directory exists
  const flowpatchDir = path.join(projectPath, '.flowpatch')
  if (!fs.existsSync(flowpatchDir)) {
    try {
      fs.mkdirSync(flowpatchDir, { recursive: true })
    } catch (err) {
      warnings.push(`Cannot create .flowpatch directory: ${err}`)
    }
  }

  // Check write permissions
  try {
    const testFile = path.join(flowpatchDir, '.migration-test')
    fs.writeFileSync(testFile, 'test')
    fs.unlinkSync(testFile)
  } catch (err) {
    warnings.push(`No write permission in .flowpatch directory: ${err}`)
  }

  // Check if project.db already exists
  if (hasProjectDb(projectPath)) {
    warnings.push('Project database already exists - migration may overwrite existing data')
  }

  return warnings
}

/**
 * Validate schema before migration starts.
 * Checks that required tables and columns exist in central DB.
 */
function validateSchema(
  centralSqlite: import('better-sqlite3').Database,
  migrations: Array<{ table: string; columns: { central: string[]; project: string[] } }>
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  for (const { table, columns } of migrations) {
    // Check if table exists
    try {
      centralSqlite.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()
    } catch (err) {
      errors.push(`Table ${table} does not exist in central DB: ${err}`)
      continue
    }

    // Check if columns exist
    const existingColumns = getTableColumns(centralSqlite, table)
    const missingColumns: string[] = []

    for (const col of columns.central) {
      if (!existingColumns.has(col)) {
        missingColumns.push(col)
      }
    }

    if (missingColumns.length > 0) {
      // Check if we have defaults for missing columns
      const hasDefaults = missingColumns.every((col) => getColumnDefault(table, col) !== null)
      if (hasDefaults) {
        warnings.push(
          `Table ${table} missing columns (will use defaults): ${missingColumns.join(', ')}`
        )
      } else {
        errors.push(`Table ${table} missing required columns: ${missingColumns.join(', ')}`)
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Verify migration completed successfully by comparing record counts.
 */
function verifyMigration(
  projectPath: string,
  expectedCounts: Record<string, number>
): MigrationVerification {
  const verification: MigrationVerification = {
    passed: true,
    centralRecords: 0,
    projectRecords: 0,
    missingTables: [],
    recordMismatches: []
  }

  try {
    const projectSqlite = getProjectSqlite(projectPath)

    // Check each table
    for (const [table, expectedCount] of Object.entries(expectedCounts)) {
      if (expectedCount === 0) continue

      try {
        const result = projectSqlite
          .prepare(`SELECT COUNT(*) as count FROM ${table}`)
          .get() as { count: number }

        const actualCount = result.count

        verification.projectRecords += actualCount
        verification.centralRecords += expectedCount

        if (actualCount !== expectedCount) {
          verification.passed = false
          verification.recordMismatches.push({
            table,
            central: expectedCount,
            project: actualCount
          })
        }
      } catch {
        verification.passed = false
        verification.missingTables.push(table)
      }
    }
  } catch (err) {
    verification.passed = false
  }

  return verification
}

/**
 * Save migration history to .flowpatch/migration-history.json
 */
function saveMigrationHistory(projectPath: string, result: MigrationResult): void {
  const path = require('path')
  const fs = require('fs')

  const historyPath = path.join(projectPath, '.flowpatch', 'migration-history.json')

  const history = {
    migratedAt: new Date().toISOString(),
    success: result.success,
    duration_ms: result.duration_ms,
    recordsMigrated: Object.values(result.recordsCopied).reduce((sum, count) => sum + count, 0),
    tables: result.tablesMigrated,
    recordsByTable: result.recordsCopied,
    errors: result.errors,
    warnings: result.warnings,
    verification: result.verification
  }

  try {
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8')
  } catch {
    // Don't fail migration if history save fails
  }
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
 *
 * @param projectId - The project ID
 * @param projectPath - The project local path
 * @param onProgress - Optional callback for progress updates
 */
export function migrateProjectToLocalDb(
  projectId: string,
  projectPath: string,
  onProgress?: ProgressCallback
): MigrationResult {
  const startTime = Date.now()
  const result: MigrationResult = {
    success: false,
    tablesMigrated: [],
    recordsCopied: {},
    errors: [],
    warnings: [],
    duration_ms: 0
  }

  try {
    // Pre-migration validation
    onProgress?.({
      phase: 'validating',
      tablesCompleted: 0,
      totalTables: 17,
      recordsProcessed: 0,
      totalRecords: 0,
      message: 'Validating project state...'
    })

    const validationWarnings = validatePreMigration(projectPath)
    result.warnings.push(...validationWarnings)

    if (validationWarnings.some((w) => w.includes('Cannot create') || w.includes('No write'))) {
      result.errors.push('Pre-migration validation failed')
      result.duration_ms = Date.now() - startTime
      return result
    }

    // Initialize project DB (creates tables)
    onProgress?.({
      phase: 'migrating',
      tablesCompleted: 0,
      totalTables: 17,
      recordsProcessed: 0,
      totalRecords: 0,
      message: 'Creating database tables...'
    })

    // Ensure databases are initialized and ready
    // This is important on first migration attempt when dialog is first opened
    const centralSqlite = getSqlite()
    
    // Ensure central DB is ready by running a simple query
    try {
      centralSqlite.prepare('SELECT 1').get()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      result.errors.push(`Central database not ready: ${errorMsg}`)
      logAction('migrateProjectToLocalDb:dbNotReady', {
        projectId,
        error: errorMsg,
        stack: err instanceof Error ? err.stack : undefined
      })
      result.duration_ms = Date.now() - startTime
      return result
    }

    // Initialize project DB
    initProjectDb(projectPath)
    const projectSqlite = getProjectSqlite(projectPath)
    
    // Ensure project DB is ready
    try {
      projectSqlite.prepare('SELECT 1').get()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      result.errors.push(`Project database not ready: ${errorMsg}`)
      logAction('migrateProjectToLocalDb:projectDbNotReady', {
        projectId,
        projectPath,
        error: errorMsg,
        stack: err instanceof Error ? err.stack : undefined
      })
      result.duration_ms = Date.now() - startTime
      return result
    }

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

    // Validate schema before migration
    onProgress?.({
      phase: 'validating',
      tablesCompleted: 0,
      totalTables: migrations.length,
      recordsProcessed: 0,
      totalRecords: 0,
      message: 'Validating database schema...'
    })

    const schemaValidation = validateSchema(centralSqlite, migrations)
    result.warnings.push(...schemaValidation.warnings)

    if (!schemaValidation.valid) {
      result.errors.push(...schemaValidation.errors)
      logAction('migrateProjectToLocalDb:schemaValidationFailed', {
        projectId,
        errors: schemaValidation.errors,
        warnings: schemaValidation.warnings
      })
      result.duration_ms = Date.now() - startTime
      return result
    }

    // Run migrations in a transaction
    projectSqlite.exec('BEGIN TRANSACTION')

    try {
      let tablesCompleted = 0
      let recordsProcessed = 0
      const totalTables = migrations.length

      for (const { table, columns } of migrations) {
        onProgress?.({
          phase: 'migrating',
          currentTable: table,
          tablesCompleted,
          totalTables,
          recordsProcessed,
          totalRecords: 0, // Unknown at this point
          message: `Migrating ${table}...`
        })

        try {
          // Special handling for tables without project_id column or with complex relationships
          let customQuery: string | undefined
          if (table === 'feature_suggestion_votes') {
            // Join through feature_suggestions to filter by project_id
            // Use column aliases to preserve original column names in result
            const selectColumns = columns.central.map((col) => `fsv.${col} AS ${col}`).join(', ')
            customQuery = `SELECT ${selectColumns} FROM feature_suggestion_votes fsv JOIN feature_suggestions fs ON fsv.suggestion_id = fs.id WHERE fs.project_id = ?`
          } else if (table === 'card_links') {
            // Join through cards to filter by project_id
            const selectColumns = columns.central.map((col) => `cl.${col} AS ${col}`).join(', ')
            customQuery = `SELECT ${selectColumns} FROM card_links cl JOIN cards c ON cl.card_id = c.id WHERE c.project_id = ?`
          } else if (table === 'worker_progress') {
            // Join through cards to filter by project_id
            const selectColumns = columns.central.map((col) => `wp.${col} AS ${col}`).join(', ')
            customQuery = `SELECT ${selectColumns} FROM worker_progress wp JOIN cards c ON wp.card_id = c.id WHERE c.project_id = ?`
          } else if (table === 'card_dependencies') {
            // Join through cards twice to ensure BOTH card_id and depends_on_card_id belong to this project
            // This prevents orphaned dependencies where one card is in the project but the other isn't
            // Exclude project_id from select since project DB doesn't have it
            const projectColumns = columns.central.filter((col) => col !== 'project_id')
            const selectColumns = projectColumns.map((col) => `cd.${col} AS ${col}`).join(', ')
            customQuery = `SELECT ${selectColumns} FROM card_dependencies cd 
              JOIN cards c1 ON cd.card_id = c1.id 
              JOIN cards c2 ON cd.depends_on_card_id = c2.id 
              WHERE c1.project_id = ? AND c2.project_id = ?`
            
            // Log dependency migration details
            try {
              // Count total dependencies in central DB for this project
              const totalDepsResult = centralSqlite
                .prepare('SELECT COUNT(*) as count FROM card_dependencies WHERE project_id = ?')
                .get(projectId) as { count: number }
              const totalDeps = totalDepsResult.count
              
              // Count dependencies where both cards belong to project (should migrate)
              const validDepsResult = centralSqlite
                .prepare(`
                  SELECT COUNT(*) as count FROM card_dependencies cd 
                  JOIN cards c1 ON cd.card_id = c1.id 
                  JOIN cards c2 ON cd.depends_on_card_id = c2.id 
                  WHERE cd.project_id = ? AND c1.project_id = ? AND c2.project_id = ?
                `)
                .get(projectId, projectId, projectId) as { count: number }
              const validDeps = validDepsResult.count
              
              // Count dependencies where one card doesn't belong (will be filtered out)
              const orphanedDeps = totalDeps - validDeps
              
              logAction('migrateProjectToLocalDb:cardDependencies:preMigration', {
                projectId,
                totalDependencies: totalDeps,
                validDependencies: validDeps,
                orphanedDependencies: orphanedDeps,
                note: orphanedDeps > 0 
                  ? `${orphanedDeps} dependency(ies) will be filtered out (one card not in project)`
                  : 'All dependencies have both cards in project'
              })
            } catch (err) {
              logAction('migrateProjectToLocalDb:cardDependencies:preMigration:error', {
                projectId,
                error: err instanceof Error ? err.message : String(err)
              })
            }
          }

          // For card_dependencies, we need two projectId parameters (one for each JOIN)
          const customQueryParams = table === 'card_dependencies' ? [projectId, projectId] : undefined

          const count = migrateTable(
            centralSqlite,
            projectSqlite,
            table,
            columns,
            projectId,
            customQuery,
            customQueryParams
          )
          result.recordsCopied[table] = count
          if (count > 0) {
            result.tablesMigrated.push(table)
          }
          
          // Log migration result for card_dependencies
          if (table === 'card_dependencies') {
            try {
              const totalDepsResult = centralSqlite
                .prepare('SELECT COUNT(*) as count FROM card_dependencies WHERE project_id = ?')
                .get(projectId) as { count: number }
              const totalDeps = totalDepsResult.count
              
              logAction('migrateProjectToLocalDb:cardDependencies:postMigration', {
                projectId,
                totalDependenciesInCentral: totalDeps,
                dependenciesMigrated: count,
                dependenciesFilteredOut: totalDeps - count,
                migrationRate: totalDeps > 0 ? `${((count / totalDeps) * 100).toFixed(1)}%` : 'N/A'
              })
            } catch (err) {
              logAction('migrateProjectToLocalDb:cardDependencies:postMigration:error', {
                projectId,
                error: err instanceof Error ? err.message : String(err)
              })
            }
          }
          
          // Special logging for card_dependencies to help debug relationship issues
          if (table === 'card_dependencies' && count > 0) {
            try {
              // Verify a sample of migrated dependencies
              const sampleDeps = projectSqlite
                .prepare('SELECT card_id, depends_on_card_id FROM card_dependencies LIMIT 5')
                .all() as Array<{ card_id: string; depends_on_card_id: string }>
              
              // Check if the referenced cards exist
              const cardIds = sampleDeps.map(d => d.card_id)
              const dependsOnIds = sampleDeps.map(d => d.depends_on_card_id)
              const allReferencedIds = [...new Set([...cardIds, ...dependsOnIds])]
              
              const existingCards = projectSqlite
                .prepare(`SELECT id FROM cards WHERE id IN (${allReferencedIds.map(() => '?').join(',')})`)
                .all(...allReferencedIds) as Array<{ id: string }>
              
              const existingCardIds = new Set(existingCards.map(c => c.id))
              const missingIds = allReferencedIds.filter(id => !existingCardIds.has(id))
              
              if (missingIds.length > 0) {
                logAction('migrateProjectToLocalDb:cardDependencySampleCheck', {
                  projectId,
                  sampleSize: sampleDeps.length,
                  missingCardIds: missingIds,
                  warning: 'Some card IDs referenced in dependencies do not exist in cards table'
                })
                result.warnings.push(
                  `Card dependencies migration: Found ${missingIds.length} card ID(s) in dependencies that don't exist in cards table (sample check)`
                )
              } else {
                logAction('migrateProjectToLocalDb:cardDependencySampleCheck', {
                  projectId,
                  sampleSize: sampleDeps.length,
                  status: 'all_referenced_cards_exist'
                })
              }
            } catch (err) {
              // Don't fail migration if sample check fails
              logAction('migrateProjectToLocalDb:cardDependencySampleCheckError', {
                projectId,
                error: err instanceof Error ? err.message : String(err)
              })
            }
          }

          tablesCompleted++
          recordsProcessed += count

          onProgress?.({
            phase: 'migrating',
            currentTable: table,
            tablesCompleted,
            totalTables,
            recordsProcessed,
            totalRecords: 0,
            message: `Migrated ${count} ${table}`
          })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          const errorDetails = `Failed to migrate table ${table}: ${errorMsg}`
          result.errors.push(errorDetails)
          logAction('migrateProjectToLocalDb:tableError', {
            projectId,
            table,
            error: errorMsg,
            stack: err instanceof Error ? err.stack : undefined
          })
          // Continue with other tables instead of failing completely
          // This allows partial migration to succeed
        }
      }

      // Only commit if no critical errors occurred
      if (result.errors.length === 0) {
        projectSqlite.exec('COMMIT')
        // Mark project as migrated in central DB only after successful commit
        centralSqlite.exec(
          `UPDATE projects SET local_db_migrated = 1, updated_at = datetime('now') WHERE id = '${projectId}'`
        )
        // Clear project path cache to ensure fresh DB resolution
        clearProjectPathCache(projectId)
        logAction('migrateProjectToLocalDb:cache_cleared', { projectId })
      } else {
        projectSqlite.exec('ROLLBACK')
        logAction('migrateProjectToLocalDb:rollback', {
          projectId,
          errors: result.errors,
          tablesMigrated: result.tablesMigrated.length
        })
        // Don't mark as migrated if transaction was rolled back
      }
    } catch (err) {
      projectSqlite.exec('ROLLBACK')
      const errorMsg = err instanceof Error ? err.message : String(err)
      result.errors.push(`Transaction failed: ${errorMsg}`)
      logAction('migrateProjectToLocalDb:transactionError', {
        projectId,
        error: errorMsg,
        stack: err instanceof Error ? err.stack : undefined
      })
      // Don't mark as migrated if transaction failed
      throw err
    }

    // Migrate project settings from central DB to config.yml
    onProgress?.({
      phase: 'migrating',
      currentTable: 'settings',
      tablesCompleted: 17,
      totalTables: 18,
      recordsProcessed: Object.values(result.recordsCopied).reduce((sum, c) => sum + c, 0),
      totalRecords: 0,
      message: 'Migrating project settings...'
    })

    try {
      const settingsResult = migrateProjectSettingsToConfig(projectId, projectPath)
      if (settingsResult.settingsMigrated > 0) {
        result.recordsCopied['settings'] = settingsResult.settingsMigrated
        result.tablesMigrated.push('settings')
      }
      if (settingsResult.errors.length > 0) {
        result.errors.push(...settingsResult.errors)
      }
    } catch (err) {
      // Don't fail the entire migration if settings migration fails
      result.errors.push(`Settings migration error: ${err}`)
    }

    // Post-migration verification
    onProgress?.({
      phase: 'verifying',
      tablesCompleted: 18,
      totalTables: 18,
      recordsProcessed: Object.values(result.recordsCopied).reduce((sum, c) => sum + c, 0),
      totalRecords: Object.values(result.recordsCopied).reduce((sum, c) => sum + c, 0),
      message: 'Verifying migration...'
    })

    const verification = verifyMigration(projectPath, result.recordsCopied)
    result.verification = verification

    // Additional verification: Check foreign key relationships for card_dependencies
    if (result.recordsCopied.card_dependencies > 0) {
      try {
        const projectSqlite = getProjectSqlite(projectPath)
        
        // Check if all card_id values in card_dependencies exist in cards table
        const orphanedCardIds = projectSqlite
          .prepare(`
            SELECT DISTINCT cd.card_id 
            FROM card_dependencies cd 
            LEFT JOIN cards c ON cd.card_id = c.id 
            WHERE c.id IS NULL
          `)
          .all() as Array<{ card_id: string }>
        
        // Check if all depends_on_card_id values in card_dependencies exist in cards table
        const orphanedDependsOnIds = projectSqlite
          .prepare(`
            SELECT DISTINCT cd.depends_on_card_id 
            FROM card_dependencies cd 
            LEFT JOIN cards c ON cd.depends_on_card_id = c.id 
            WHERE c.id IS NULL
          `)
          .all() as Array<{ depends_on_card_id: string }>
        
        if (orphanedCardIds.length > 0 || orphanedDependsOnIds.length > 0) {
          verification.passed = false
          const orphanedCardIdList = orphanedCardIds.map(r => r.card_id).join(', ')
          const orphanedDependsOnList = orphanedDependsOnIds.map(r => r.depends_on_card_id).join(', ')
          result.warnings.push(
            `Card dependencies have orphaned references: ${orphanedCardIds.length} card_id(s) and ${orphanedDependsOnIds.length} depends_on_card_id(s) don't exist in cards table`
          )
          if (orphanedCardIdList) {
            result.warnings.push(`Orphaned card_id values: ${orphanedCardIdList}`)
          }
          if (orphanedDependsOnList) {
            result.warnings.push(`Orphaned depends_on_card_id values: ${orphanedDependsOnList}`)
          }
          
          // Get total dependency count for context
          const totalDeps = projectSqlite
            .prepare('SELECT COUNT(*) as count FROM card_dependencies')
            .get() as { count: number }
          
          logAction('migrateProjectToLocalDb:orphanedDependencies', {
            projectId,
            totalDependencies: totalDeps.count,
            orphanedCardIds: orphanedCardIds.length,
            orphanedDependsOnIds: orphanedDependsOnIds.length,
            orphanedCardIdList: orphanedCardIdList.slice(0, 10),
            orphanedDependsOnList: orphanedDependsOnList.slice(0, 10)
          })
        } else {
          // Get total dependency count for successful verification
          const totalDeps = projectSqlite
            .prepare('SELECT COUNT(*) as count FROM card_dependencies')
            .get() as { count: number }
          
          logAction('migrateProjectToLocalDb:dependencyVerification', {
            projectId,
            totalDependencies: totalDeps.count,
            status: 'all_dependencies_valid',
            message: `All ${totalDeps.count} card dependencies have valid relationships`
          })
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        result.warnings.push(`Failed to verify card dependency relationships: ${errorMsg}`)
        logAction('migrateProjectToLocalDb:dependencyVerificationError', {
          projectId,
          error: errorMsg
        })
      }
    }

    if (!verification.passed) {
      result.warnings.push('Migration verification found discrepancies')
      if (verification.recordMismatches.length > 0) {
        result.warnings.push(
          `Record count mismatches: ${verification.recordMismatches.map((m) => `${m.table} (${m.central} → ${m.project})`).join(', ')}`
        )
      }
      if (verification.missingTables.length > 0) {
        result.warnings.push(`Missing tables: ${verification.missingTables.join(', ')}`)
      }
    }

    // Only mark as successful if no errors occurred
    result.success = result.errors.length === 0

    // Save migration history
    result.duration_ms = Date.now() - startTime
    saveMigrationHistory(projectPath, result)

    onProgress?.({
      phase: 'complete',
      tablesCompleted: 18,
      totalTables: 18,
      recordsProcessed: verification.projectRecords,
      totalRecords: verification.projectRecords,
      message: 'Migration complete!'
    })
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err))
  }

  result.duration_ms = Date.now() - startTime
  return result
}

/**
 * Migrate a single table from central to project DB.
 * Handles missing columns, special queries for tables without project_id, and error logging.
 */
function migrateTable(
  centralSqlite: import('better-sqlite3').Database,
  projectSqlite: import('better-sqlite3').Database,
  table: string,
  columns: { central: string[]; project: string[] },
  projectId: string,
  customQuery?: string,
  customQueryParams?: unknown[]
): number {
  try {
    // Get existing columns in central DB
    const existingColumns = getTableColumns(centralSqlite, table)

    // Filter columns to only those that exist in central DB
    const availableCentralColumns = columns.central.filter((col) => existingColumns.has(col))
    const missingCentralColumns = columns.central.filter((col) => !existingColumns.has(col))

    if (missingCentralColumns.length > 0) {
      logAction('migrateTable:missingColumns', {
        table,
        missing: missingCentralColumns,
        willUseDefaults: missingCentralColumns.every((col) => getColumnDefault(table, col) !== null)
      })
    }

    // Build SELECT query for central DB
    let selectQuery: string
    let queryParams: unknown[] = [projectId]

    if (customQuery) {
      // Use custom query (e.g., for feature_suggestion_votes with JOIN)
      selectQuery = customQuery
      queryParams = customQueryParams ?? [projectId]
    } else {
      // Standard query with project_id filter
      if (availableCentralColumns.length === 0) {
        logAction('migrateTable:noColumns', { table, projectId })
        return 0
      }
      const selectColumns = availableCentralColumns.join(', ')
      selectQuery = `SELECT ${selectColumns} FROM ${table} WHERE project_id = ?`
    }

    // Get rows from central DB
    let rows: Record<string, unknown>[]
    try {
      rows = centralSqlite.prepare(selectQuery).all(...queryParams) as Record<string, unknown>[]
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logAction('migrateTable:selectError', {
        table,
        query: selectQuery,
        error: errorMsg,
        stack: err instanceof Error ? err.stack : undefined
      })
      throw new Error(`Failed to select from ${table}: ${errorMsg}`)
    }

    if (rows.length === 0) {
      return 0
    }

    // Map available central columns to project columns
    // For each project column, find the corresponding central column
    const columnMapping: Array<{ projectCol: string; centralCol: string | null }> =
      columns.project.map((projectCol) => {
        const centralIndex = columns.central.indexOf(projectCol)
        if (centralIndex >= 0 && availableCentralColumns.includes(columns.central[centralIndex])) {
          return { projectCol, centralCol: columns.central[centralIndex] }
        }
        return { projectCol, centralCol: null }
      })

    // Build INSERT query for project DB
    const insertColumns = columns.project.join(', ')
    const placeholders = columns.project.map(() => '?').join(', ')
    const insertQuery = `INSERT OR REPLACE INTO ${table} (${insertColumns}) VALUES (${placeholders})`

    let insertStmt: import('better-sqlite3').Statement
    try {
      insertStmt = projectSqlite.prepare(insertQuery)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logAction('migrateTable:prepareError', {
        table,
        query: insertQuery,
        error: errorMsg,
        stack: err instanceof Error ? err.stack : undefined
      })
      throw new Error(`Failed to prepare insert for ${table}: ${errorMsg}`)
    }

    // Insert each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        const values = columnMapping.map(({ projectCol, centralCol }) => {
          if (centralCol && row[centralCol] !== undefined) {
            return row[centralCol]
          }
          // Use default value if column is missing
          const defaultValue = getColumnDefault(table, projectCol)
          if (defaultValue !== null) {
            return defaultValue
          }
          return null
        })
        
        // For cards table, log ID preservation to verify migration correctness
        if (table === 'cards' && row.id) {
          logAction('migrateTable:cardIdPreservation', {
            table,
            centralCardId: row.id,
            cardTitle: row.title,
            rowIndex: i,
            note: 'Verifying card ID is preserved during migration'
          })
        }
        
        // For card_dependencies, log the card IDs being migrated
        if (table === 'card_dependencies' && row.card_id && row.depends_on_card_id) {
          logAction('migrateTable:cardDependencyIds', {
            table,
            dependencyId: row.id,
            cardId: row.card_id,
            dependsOnCardId: row.depends_on_card_id,
            rowIndex: i,
            note: 'Verifying dependency card IDs are preserved'
          })
        }
        
        insertStmt.run(...values)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logAction('migrateTable:insertError', {
          table,
          rowIndex: i,
          rowId: row.id,
          error: errorMsg,
          stack: err instanceof Error ? err.stack : undefined
        })
        throw new Error(`Failed to insert row ${i} into ${table}: ${errorMsg}`)
      }
    }

    return rows.length
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logAction('migrateTable:fatalError', {
      table,
      projectId,
      error: errorMsg,
      stack: err instanceof Error ? err.stack : undefined
    })
    throw err
  }
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
  // Central DB has project_id, project DB doesn't (implicit)
  return {
    central: ['project_id', ...common],
    project: common
  }
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
      // Special handling for tables without project_id column
      if (table === 'card_links') {
        // Delete card_links that belong to cards in this project
        sqlite.exec(
          `DELETE FROM card_links WHERE card_id IN (SELECT id FROM cards WHERE project_id = '${projectId}')`
        )
      } else if (table === 'worker_progress') {
        // Delete worker_progress that belongs to cards in this project
        sqlite.exec(
          `DELETE FROM worker_progress WHERE card_id IN (SELECT id FROM cards WHERE project_id = '${projectId}')`
        )
      } else if (table === 'feature_suggestion_votes') {
        // Delete feature_suggestion_votes that belong to feature_suggestions in this project
        sqlite.exec(
          `DELETE FROM feature_suggestion_votes WHERE suggestion_id IN (SELECT id FROM feature_suggestions WHERE project_id = '${projectId}')`
        )
      } else {
        sqlite.exec(`DELETE FROM ${table} WHERE project_id = '${projectId}'`)
      }
    }
    sqlite.exec('COMMIT')
  } catch {
    sqlite.exec('ROLLBACK')
    throw new Error(`Failed to cleanup central data for project ${projectId}`)
  }
}

/**
 * Check if a project has data in the central database.
 * Checks all tables that can contain project data, not just cards.
 */
export function hasDataInCentralDb(projectId: string): boolean {
  const sqlite = getSqlite()
  
  // Check multiple tables to see if any project data exists
  const tablesToCheck = [
    'cards',
    'events',
    'jobs',
    'worktrees',
    'subtasks',
    'worker_slots',
    'plan_approvals',
    'follow_up_instructions',
    'usage_records',
    'agent_chat_messages',
    'ai_profiles',
    'feature_suggestions',
    'sync_state',
    'card_dependencies'
  ]
  
  for (const table of tablesToCheck) {
    try {
      const result = sqlite
        .prepare(`SELECT COUNT(*) as count FROM ${table} WHERE project_id = ?`)
        .get(projectId) as { count: number }
      if (result.count > 0) {
        return true
      }
    } catch {
      // Table might not exist or have project_id, continue checking
    }
  }
  
  // Check tables without project_id via JOINs
  try {
    const cardLinksResult = sqlite
      .prepare('SELECT COUNT(*) as count FROM card_links cl JOIN cards c ON cl.card_id = c.id WHERE c.project_id = ?')
      .get(projectId) as { count: number }
    if (cardLinksResult.count > 0) {
      return true
    }
  } catch {
    // Continue
  }
  
  try {
    const workerProgressResult = sqlite
      .prepare('SELECT COUNT(*) as count FROM worker_progress wp JOIN cards c ON wp.card_id = c.id WHERE c.project_id = ?')
      .get(projectId) as { count: number }
    if (workerProgressResult.count > 0) {
      return true
    }
  } catch {
    // Continue
  }
  
  try {
    const votesResult = sqlite
      .prepare('SELECT COUNT(*) as count FROM feature_suggestion_votes fsv JOIN feature_suggestions fs ON fsv.suggestion_id = fs.id WHERE fs.project_id = ?')
      .get(projectId) as { count: number }
    if (votesResult.count > 0) {
      return true
    }
  } catch {
    // Continue
  }
  
  return false
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
      let query: string
      let queryParams: unknown[] = [projectId]
      // Special handling for tables without project_id column or with complex relationships
      if (table === 'card_links') {
        query = `SELECT COUNT(*) as count FROM card_links cl JOIN cards c ON cl.card_id = c.id WHERE c.project_id = ?`
      } else if (table === 'worker_progress') {
        query = `SELECT COUNT(*) as count FROM worker_progress wp JOIN cards c ON wp.card_id = c.id WHERE c.project_id = ?`
      } else if (table === 'card_dependencies') {
        // Count dependencies where BOTH card_id and depends_on_card_id belong to this project
        query = `SELECT COUNT(*) as count FROM card_dependencies cd 
          JOIN cards c1 ON cd.card_id = c1.id 
          JOIN cards c2 ON cd.depends_on_card_id = c2.id 
          WHERE c1.project_id = ? AND c2.project_id = ?`
        queryParams = [projectId, projectId]
      } else {
        query = `SELECT COUNT(*) as count FROM ${table} WHERE project_id = ?`
      }
      const result = sqlite.prepare(query).get(...queryParams) as { count: number }
      counts[table] = result.count
    } catch {
      counts[table] = 0
    }
  }

  return counts
}
