/**
 * AI Profiles Database Operations
 *
 * Supports both central database (legacy) and project-local database.
 * CRUD operations for AI configuration profiles.
 */

import { and, asc, count, desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { aiProfiles } from './schema'
import { aiProfiles as projectAiProfiles } from './schema/project'
import { generateId } from '@shared/utils'
import type { AIProfile, AIModelProvider, ThinkingMode, PlanningMode } from '@shared/types'
import { resolveProjectDb } from './db-resolver'

// ============================================================================
// Helper Functions
// ============================================================================

function rowToProfile(
  row: {
    id: string
    project_id?: string
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
  },
  projectId?: string
): AIProfile {
  return {
    id: row.id,
    project_id: row.project_id ?? projectId ?? '',
    name: row.name,
    description: row.description ?? undefined,
    is_default: row.is_default === 1,
    model_provider: row.model_provider as AIModelProvider,
    model_name: row.model_name ?? undefined,
    temperature: row.temperature ?? undefined,
    max_tokens: row.max_tokens ?? undefined,
    top_p: row.top_p ?? undefined,
    system_prompt: row.system_prompt ?? undefined,
    thinking_enabled:
      row.thinking_enabled === 1 ? true : row.thinking_enabled === 0 ? false : undefined,
    thinking_mode: (row.thinking_mode as ThinkingMode) ?? undefined,
    thinking_budget_tokens: row.thinking_budget_tokens ?? undefined,
    planning_enabled:
      row.planning_enabled === 1 ? true : row.planning_enabled === 0 ? false : undefined,
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
  const { db, isLocalDb } = resolveProjectDb(data.projectId)
  const id = generateId()
  const now = new Date().toISOString()

  if (isLocalDb) {
    // If this is set as default, clear any existing default
    if (data.isDefault) {
      db.update(projectAiProfiles).set({ is_default: 0 }).run()
    }

    db.insert(projectAiProfiles)
      .values({
        id,
        name: data.name,
        description: data.description ?? null,
        is_default: data.isDefault ? 1 : 0,
        model_provider: data.modelProvider ?? 'auto',
        model_name: data.modelName ?? null,
        temperature: data.temperature ?? null,
        max_tokens: data.maxTokens ?? null,
        top_p: data.topP ?? null,
        system_prompt: data.systemPrompt ?? null,
        thinking_enabled: data.thinkingEnabled === undefined ? null : data.thinkingEnabled ? 1 : 0,
        thinking_mode: data.thinkingMode ?? null,
        thinking_budget_tokens: data.thinkingBudgetTokens ?? null,
        planning_enabled: data.planningEnabled === undefined ? null : data.planningEnabled ? 1 : 0,
        planning_mode: data.planningMode ?? null,
        created_at: now,
        updated_at: now
      })
      .run()

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

  // Central DB
  if (data.isDefault) {
    db.update(aiProfiles)
      .set({ is_default: 0 })
      .where(eq(aiProfiles.project_id, data.projectId))
      .run()
  }

  db.insert(aiProfiles)
    .values({
      id,
      project_id: data.projectId,
      name: data.name,
      description: data.description ?? null,
      is_default: data.isDefault ? 1 : 0,
      model_provider: data.modelProvider ?? 'auto',
      model_name: data.modelName ?? null,
      temperature: data.temperature ?? null,
      max_tokens: data.maxTokens ?? null,
      top_p: data.topP ?? null,
      system_prompt: data.systemPrompt ?? null,
      thinking_enabled: data.thinkingEnabled === undefined ? null : data.thinkingEnabled ? 1 : 0,
      thinking_mode: data.thinkingMode ?? null,
      thinking_budget_tokens: data.thinkingBudgetTokens ?? null,
      planning_enabled: data.planningEnabled === undefined ? null : data.planningEnabled ? 1 : 0,
      planning_mode: data.planningMode ?? null,
      created_at: now,
      updated_at: now
    })
    .run()

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
 * @param profileId - The profile ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function getAIProfile(profileId: string, projectId?: string): AIProfile | null {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const row = db
        .select()
        .from(projectAiProfiles)
        .where(eq(projectAiProfiles.id, profileId))
        .get()
      if (!row) return null
      return rowToProfile(row as any, projectId)
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const row = db.select().from(aiProfiles).where(eq(aiProfiles.id, profileId)).get()
  if (!row) return null
  return rowToProfile(row as any)
}

/**
 * Get all AI profiles for a project.
 */
export function getAIProfilesByProject(projectId: string): AIProfile[] {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const rows = db
      .select()
      .from(projectAiProfiles)
      .orderBy(desc(projectAiProfiles.is_default), asc(projectAiProfiles.name))
      .all()
    return rows.map((row) => rowToProfile(row as any, projectId))
  }

  const rows = db
    .select()
    .from(aiProfiles)
    .where(eq(aiProfiles.project_id, projectId))
    .orderBy(desc(aiProfiles.is_default), asc(aiProfiles.name))
    .all()
  return rows.map((row) => rowToProfile(row as any))
}

/**
 * Get the default AI profile for a project.
 */
export function getDefaultAIProfile(projectId: string): AIProfile | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const row = db.select().from(projectAiProfiles).where(eq(projectAiProfiles.is_default, 1)).get()
    if (!row) return null
    return rowToProfile(row as any, projectId)
  }

  const row = db
    .select()
    .from(aiProfiles)
    .where(and(eq(aiProfiles.project_id, projectId), eq(aiProfiles.is_default, 1)))
    .get()
  if (!row) return null
  return rowToProfile(row as any)
}

/**
 * Get an AI profile by name within a project.
 */
export function getAIProfileByName(projectId: string, name: string): AIProfile | null {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const row = db.select().from(projectAiProfiles).where(eq(projectAiProfiles.name, name)).get()
    if (!row) return null
    return rowToProfile(row as any, projectId)
  }

  const row = db
    .select()
    .from(aiProfiles)
    .where(and(eq(aiProfiles.project_id, projectId), eq(aiProfiles.name, name)))
    .get()
  if (!row) return null
  return rowToProfile(row as any)
}

/**
 * Count AI profiles for a project.
 */
export function countAIProfiles(projectId: string): number {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const result = db.select({ count: count() }).from(projectAiProfiles).get()
    return result?.count ?? 0
  }

  const result = db
    .select({ count: count() })
    .from(aiProfiles)
    .where(eq(aiProfiles.project_id, projectId))
    .get()
  return result?.count ?? 0
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
 * @param profileId - The profile ID
 * @param data - The update data
 * @param projectId - Optional project ID for direct DB resolution
 */
export function updateAIProfile(
  profileId: string,
  data: UpdateAIProfileData,
  projectId?: string
): AIProfile | null {
  const now = new Date().toISOString()

  // Get current profile to get project_id
  const current = getAIProfile(profileId, projectId)
  if (!current) return null

  const resolvedProjectId = projectId ?? current.project_id
  const { db, isLocalDb } = resolveProjectDb(resolvedProjectId)

  const updateData: Record<string, unknown> = { updated_at: now }

  if (data.name !== undefined) updateData.name = data.name
  if (data.description !== undefined) updateData.description = data.description ?? null
  if (data.isDefault !== undefined) updateData.is_default = data.isDefault ? 1 : 0
  if (data.modelProvider !== undefined) updateData.model_provider = data.modelProvider
  if (data.modelName !== undefined) updateData.model_name = data.modelName
  if (data.temperature !== undefined) updateData.temperature = data.temperature
  if (data.maxTokens !== undefined) updateData.max_tokens = data.maxTokens
  if (data.topP !== undefined) updateData.top_p = data.topP
  if (data.systemPrompt !== undefined) updateData.system_prompt = data.systemPrompt
  if (data.thinkingEnabled !== undefined) {
    updateData.thinking_enabled =
      data.thinkingEnabled === null ? null : data.thinkingEnabled ? 1 : 0
  }
  if (data.thinkingMode !== undefined) updateData.thinking_mode = data.thinkingMode
  if (data.thinkingBudgetTokens !== undefined)
    updateData.thinking_budget_tokens = data.thinkingBudgetTokens
  if (data.planningEnabled !== undefined) {
    updateData.planning_enabled =
      data.planningEnabled === null ? null : data.planningEnabled ? 1 : 0
  }
  if (data.planningMode !== undefined) updateData.planning_mode = data.planningMode

  if (isLocalDb) {
    // If setting as default, clear other defaults
    if (data.isDefault === true) {
      db.update(projectAiProfiles).set({ is_default: 0 }).run()
    }

    db.update(projectAiProfiles).set(updateData).where(eq(projectAiProfiles.id, profileId)).run()
    return getAIProfile(profileId, resolvedProjectId)
  }

  // Central DB
  if (data.isDefault === true) {
    db.update(aiProfiles)
      .set({ is_default: 0 })
      .where(eq(aiProfiles.project_id, resolvedProjectId))
      .run()
  }

  db.update(aiProfiles).set(updateData).where(eq(aiProfiles.id, profileId)).run()
  return getAIProfile(profileId, resolvedProjectId)
}

/**
 * Set an AI profile as the default for its project.
 * @param profileId - The profile ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function setDefaultAIProfile(profileId: string, projectId?: string): boolean {
  const profile = getAIProfile(profileId, projectId)
  if (!profile) return false

  const resolvedProjectId = projectId ?? profile.project_id
  const { db, isLocalDb } = resolveProjectDb(resolvedProjectId)
  const now = new Date().toISOString()

  if (isLocalDb) {
    db.update(projectAiProfiles).set({ is_default: 0 }).run()

    const result = db
      .update(projectAiProfiles)
      .set({ is_default: 1, updated_at: now })
      .where(eq(projectAiProfiles.id, profileId))
      .run()
    return result.changes > 0
  }

  // Central DB
  db.update(aiProfiles)
    .set({ is_default: 0 })
    .where(eq(aiProfiles.project_id, resolvedProjectId))
    .run()

  const result = db
    .update(aiProfiles)
    .set({ is_default: 1, updated_at: now })
    .where(eq(aiProfiles.id, profileId))
    .run()
  return result.changes > 0
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete an AI profile.
 * @param profileId - The profile ID
 * @param projectId - Optional project ID for direct DB resolution
 */
export function deleteAIProfile(profileId: string, projectId?: string): boolean {
  if (projectId) {
    const { db, isLocalDb } = resolveProjectDb(projectId)
    if (isLocalDb) {
      const result = db.delete(projectAiProfiles).where(eq(projectAiProfiles.id, profileId)).run()
      return result.changes > 0
    }
  }

  // Central DB fallback
  const db = getDrizzle()
  const result = db.delete(aiProfiles).where(eq(aiProfiles.id, profileId)).run()
  return result.changes > 0
}

/**
 * Delete all AI profiles for a project.
 */
export function deleteAIProfilesByProject(projectId: string): number {
  const { db, isLocalDb } = resolveProjectDb(projectId)

  if (isLocalDb) {
    const result = db.delete(projectAiProfiles).run()
    return result.changes
  }

  const result = db.delete(aiProfiles).where(eq(aiProfiles.project_id, projectId)).run()
  return result.changes
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Duplicate an AI profile with a new name.
 * @param profileId - The profile ID to duplicate
 * @param newName - The new name for the duplicated profile
 * @param projectId - Optional project ID for direct DB resolution
 */
export function duplicateAIProfile(
  profileId: string,
  newName: string,
  projectId?: string
): AIProfile | null {
  const original = getAIProfile(profileId, projectId)
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
