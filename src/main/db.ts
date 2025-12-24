/**
 * Database Module (Backward Compatibility Layer)
 *
 * This file re-exports all database operations from the new modular structure.
 * New code should import directly from './db/index' or specific modules.
 *
 * @deprecated Import from './db' directory modules instead
 */

export * from './db/index'
