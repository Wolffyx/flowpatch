/**
 * Drizzle ORM Client
 *
 * Initializes and exports the Drizzle ORM client for SQLite database operations.
 */

import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as schema from './schema'

let db: BetterSQLite3Database<typeof schema> | null = null
let sqlite: Database.Database | null = null

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

/**
 * Initialize the Drizzle database connection.
 */
export function initDrizzle(): BetterSQLite3Database<typeof schema> {
  const base = app.getPath('userData')
  const dir = join(base, 'kanban')
  ensureDir(dir)
  const file = join(dir, 'kanban.db')

  sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  db = drizzle(sqlite, { schema })
  return db
}

/**
 * Get the Drizzle database instance. Initializes if not already done.
 */
export function getDrizzle(): BetterSQLite3Database<typeof schema> {
  if (!db) return initDrizzle()
  return db
}

/**
 * Get the underlying better-sqlite3 instance for transactions.
 */
export function getSqlite(): Database.Database {
  if (!sqlite) initDrizzle()
  return sqlite!
}

/**
 * Close the database connection.
 */
export function closeDrizzle(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
  }
}

// Re-export schema for convenience
export { schema }
