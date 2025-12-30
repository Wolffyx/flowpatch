/**
 * AI Profiles Database Operations
 *
 * CRUD operations for AI configuration profiles.
 */

import { generateId } from '@shared/utils'
import { getDb } from './connection'
import type { AIProfile, AIModelProvider, ThinkingMode, PlanningMode } from '@shared/types'

// ============================================================================
// Type Definitions
// ============================================================================

interface AIProfileRow {
  id: string
  project_id: string
  name: string
  description: string | null
  is_default: number
  model_provider: string
  model_name: string | null
  temperature: number | null
  max_tokens: number | null
  top_p: number | null
  system_prompt: string | null
  thinking_enabled: number | null
  thinking_mode: string | null
  thinking_budget_tokens: number | null
  planning_enabled: number | null
  planning_mode: string | null
  created_at: string
  updated_at: string
}

function rowToProfile(row: AIProfileRow): AIProfile {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    description: row.description ?? undefined,
    is_default: row.is_default === 1,
    model_provider: row.model_provider as AIModelProvider,
    model_name: row.model_name ?? undefined,
    temperature: row.temperature ?? undefined,
    max_tokens: row.max_tokens ?? undefined,
    top_p: row.top_p ?? undefined,
    system_prompt: row.system_prompt ?? undefined,
    thinking_enabled: row.thinking_enabled === 1 ? true : row.thinking_enabled === 0 ? false : undefined,
    thinking_mode: (row.thinking_mode as ThinkingMode) ?? undefined,
    thinking_budget_tokens: row.thinking_budget_tokens ?? undefined,
    planning_enabled: row.planning_enabled === 1 ? true : row.planning_enabled === 0 ? false : undefined,
    planning_mode: (row.planning_mode as PlanningMode) ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

// ============================================================================
// Create Operations
// ============================================================================

export interface CreateAIProfileData {
  projectId: string
  name: string
  description?: string
  isDefault?: boolean
  modelProvider?: AIModelProvider
  modelName?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  systemPrompt?: string
  thinkingEnabled?: boolean
  thinkingMode?: ThinkingMode
  thinkingBudgetTokens?: number
  planningEnabled?: boolean
  planningMode?: PlanningMode
}

/**
 * Create a new AI profile.
 */
export function createAIProfile(data: CreateAIProfileData): AIProfile {
  const db = getDb()
  const id = generateId()
  const now = new Date().toISOString()

  // If this is set as default, clear any existing default for this project
  if (data.isDefault) {
    db.prepare('UPDATE ai_profiles SET is_default = 0 WHERE project_id = ?').run(data.projectId)
  }

  const stmt = db.prepare(`
    INSERT INTO ai_profiles (
      id, project_id, name, description, is_default,
      model_provider, model_name,
      temperature, max_tokens, top_p,
      system_prompt,
      thinking_enabled, thinking_mode, thinking_budget_tokens,
      planning_enabled, planning_mode,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    data.projectId,
    data.name,
    data.description ?? null,
    data.isDefault ? 1 : 0,
    data.modelProvider ?? 'auto',
    data.modelName ?? null,
    data.temperature ?? null,
    data.maxTokens ?? null,
    data.topP ?? null,
    data.systemPrompt ?? null,
    data.thinkingEnabled === undefined ? null : data.thinkingEnabled ? 1 : 0,
    data.thinkingMode ?? null,
    data.thinkingBudgetTokens ?? null,
    data.planningEnabled === undefined ? null : data.planningEnabled ? 1 : 0,
    data.planningMode ?? null,
    now,
    now
  )

  return {
    id,
    project_id: data.projectId,
    name: data.name,
    description: data.description,
    is_default: data.isDefault ?? false,
    model_provider: data.modelProvider ?? 'auto',
    model_name: data.modelName,
    temperature: data.temperature,
    max_tokens: data.maxTokens,
    top_p: data.topP,
    system_prompt: data.systemPrompt,
    thinking_enabled: data.thinkingEnabled,
    thinking_mode: data.thinkingMode,
    thinking_budget_tokens: data.thinkingBudgetTokens,
    planning_enabled: data.planningEnabled,
    planning_mode: data.planningMode,
    created_at: now,
    updated_at: now
  }
}

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Get an AI profile by ID.
 */
export function getAIProfile(profileId: string): AIProfile | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM ai_profiles WHERE id = ?')
  const row = stmt.get(profileId) as AIProfileRow | undefined
  return row ? rowToProfile(row) : null
}

/**
 * Get all AI profiles for a project.
 */
export function getAIProfilesByProject(projectId: string): AIProfile[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM ai_profiles WHERE project_id = ? ORDER BY is_default DESC, name ASC')
  const rows = stmt.all(projectId) as AIProfileRow[]
  return rows.map(rowToProfile)
}

/**
 * Get the default AI profile for a project.
 */
export function getDefaultAIProfile(projectId: string): AIProfile | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM ai_profiles WHERE project_id = ? AND is_default = 1')
  const row = stmt.get(projectId) as AIProfileRow | undefined
  return row ? rowToProfile(row) : null
}

/**
 * Get an AI profile by name within a project.
 */
export function getAIProfileByName(projectId: string, name: string): AIProfile | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM ai_profiles WHERE project_id = ? AND name = ?')
  const row = stmt.get(projectId, name) as AIProfileRow | undefined
  return row ? rowToProfile(row) : null
}

/**
 * Count AI profiles for a project.
 */
export function countAIProfiles(projectId: string): number {
  const db = getDb()
  const stmt = db.prepare('SELECT COUNT(*) as count FROM ai_profiles WHERE project_id = ?')
  const row = stmt.get(projectId) as { count: number }
  return row.count
}

// ============================================================================
// Update Operations
// ============================================================================

export interface UpdateAIProfileData {
  name?: string
  description?: string
  isDefault?: boolean
  modelProvider?: AIModelProvider
  modelName?: string | null
  temperature?: number | null
  maxTokens?: number | null
  topP?: number | null
  systemPrompt?: string | null
  thinkingEnabled?: boolean | null
  thinkingMode?: ThinkingMode | null
  thinkingBudgetTokens?: number | null
  planningEnabled?: boolean | null
  planningMode?: PlanningMode | null
}

/**
 * Update an AI profile.
 */
export function updateAIProfile(profileId: string, data: UpdateAIProfileData): AIProfile | null {
  const db = getDb()
  const now = new Date().toISOString()

  // Get current profile to get project_id
  const current = getAIProfile(profileId)
  if (!current) return null

  // If setting as default, clear other defaults
  if (data.isDefault === true) {
    db.prepare('UPDATE ai_profiles SET is_default = 0 WHERE project_id = ? AND id != ?').run(
      current.project_id,
      profileId
    )
  }

  const updates: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [now]

  if (data.name !== undefined) {
    updates.push('name = ?')
    values.push(data.name)
  }
  if (data.description !== undefined) {
    updates.push('description = ?')
    values.push(data.description ?? null)
  }
  if (data.isDefault !== undefined) {
    updates.push('is_default = ?')
    values.push(data.isDefault ? 1 : 0)
  }
  if (data.modelProvider !== undefined) {
    updates.push('model_provider = ?')
    values.push(data.modelProvider)
  }
  if (data.modelName !== undefined) {
    updates.push('model_name = ?')
    values.push(data.modelName)
  }
  if (data.temperature !== undefined) {
    updates.push('temperature = ?')
    values.push(data.temperature)
  }
  if (data.maxTokens !== undefined) {
    updates.push('max_tokens = ?')
    values.push(data.maxTokens)
  }
  if (data.topP !== undefined) {
    updates.push('top_p = ?')
    values.push(data.topP)
  }
  if (data.systemPrompt !== undefined) {
    updates.push('system_prompt = ?')
    values.push(data.systemPrompt)
  }
  if (data.thinkingEnabled !== undefined) {
    updates.push('thinking_enabled = ?')
    values.push(data.thinkingEnabled === null ? null : data.thinkingEnabled ? 1 : 0)
  }
  if (data.thinkingMode !== undefined) {
    updates.push('thinking_mode = ?')
    values.push(data.thinkingMode)
  }
  if (data.thinkingBudgetTokens !== undefined) {
    updates.push('thinking_budget_tokens = ?')
    values.push(data.thinkingBudgetTokens)
  }
  if (data.planningEnabled !== undefined) {
    updates.push('planning_enabled = ?')
    values.push(data.planningEnabled === null ? null : data.planningEnabled ? 1 : 0)
  }
  if (data.planningMode !== undefined) {
    updates.push('planning_mode = ?')
    values.push(data.planningMode)
  }

  values.push(profileId)
  const stmt = db.prepare(`UPDATE ai_profiles SET ${updates.join(', ')} WHERE id = ?`)
  stmt.run(...values)

  return getAIProfile(profileId)
}

/**
 * Set an AI profile as the default for its project.
 */
export function setDefaultAIProfile(profileId: string): boolean {
  const db = getDb()

  const profile = getAIProfile(profileId)
  if (!profile) return false

  // Clear existing default
  db.prepare('UPDATE ai_profiles SET is_default = 0 WHERE project_id = ?').run(profile.project_id)

  // Set new default
  const result = db
    .prepare('UPDATE ai_profiles SET is_default = 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), profileId)

  return result.changes > 0
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete an AI profile.
 */
export function deleteAIProfile(profileId: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM ai_profiles WHERE id = ?')
  const result = stmt.run(profileId)
  return result.changes > 0
}

/**
 * Delete all AI profiles for a project.
 */
export function deleteAIProfilesByProject(projectId: string): number {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM ai_profiles WHERE project_id = ?')
  const result = stmt.run(projectId)
  return result.changes
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Duplicate an AI profile with a new name.
 */
export function duplicateAIProfile(profileId: string, newName: string): AIProfile | null {
  const original = getAIProfile(profileId)
  if (!original) return null

  return createAIProfile({
    projectId: original.project_id,
    name: newName,
    description: original.description ? `Copy of ${original.description}` : undefined,
    isDefault: false,
    modelProvider: original.model_provider,
    modelName: original.model_name,
    temperature: original.temperature,
    maxTokens: original.max_tokens,
    topP: original.top_p,
    systemPrompt: original.system_prompt,
    thinkingEnabled: original.thinking_enabled,
    thinkingMode: original.thinking_mode,
    thinkingBudgetTokens: original.thinking_budget_tokens,
    planningEnabled: original.planning_enabled,
    planningMode: original.planning_mode
  })
}
