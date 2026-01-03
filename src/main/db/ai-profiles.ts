/**
 * AI Profiles Database Operations
 *
 * CRUD operations for AI configuration profiles.
 */

import { and, asc, count, desc, eq } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import { aiProfiles } from './schema'
import { generateId } from '@shared/utils'
import type { AIProfile, AIModelProvider, ThinkingMode, PlanningMode } from '@shared/types'

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
  const db = getDrizzle()
  const id = generateId()
  const now = new Date().toISOString()

  // If this is set as default, clear any existing default for this project
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
 */
export function getAIProfile(profileId: string): AIProfile | null {
  const db = getDrizzle()
  const row = db.select().from(aiProfiles).where(eq(aiProfiles.id, profileId)).get()

  if (!row) return null

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

/**
 * Get all AI profiles for a project.
 */
export function getAIProfilesByProject(projectId: string): AIProfile[] {
  const db = getDrizzle()
  const rows = db
    .select()
    .from(aiProfiles)
    .where(eq(aiProfiles.project_id, projectId))
    .orderBy(desc(aiProfiles.is_default), asc(aiProfiles.name))
    .all()

  return rows.map((row) => ({
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
  }))
}

/**
 * Get the default AI profile for a project.
 */
export function getDefaultAIProfile(projectId: string): AIProfile | null {
  const db = getDrizzle()
  const row = db
    .select()
    .from(aiProfiles)
    .where(and(eq(aiProfiles.project_id, projectId), eq(aiProfiles.is_default, 1)))
    .get()

  if (!row) return null

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

/**
 * Get an AI profile by name within a project.
 */
export function getAIProfileByName(projectId: string, name: string): AIProfile | null {
  const db = getDrizzle()
  const row = db
    .select()
    .from(aiProfiles)
    .where(and(eq(aiProfiles.project_id, projectId), eq(aiProfiles.name, name)))
    .get()

  if (!row) return null

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

/**
 * Count AI profiles for a project.
 */
export function countAIProfiles(projectId: string): number {
  const db = getDrizzle()
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
 */
export function updateAIProfile(profileId: string, data: UpdateAIProfileData): AIProfile | null {
  const db = getDrizzle()
  const now = new Date().toISOString()

  // Get current profile to get project_id
  const current = getAIProfile(profileId)
  if (!current) return null

  // If setting as default, clear other defaults
  if (data.isDefault === true) {
    db.update(aiProfiles)
      .set({ is_default: 0 })
      .where(and(eq(aiProfiles.project_id, current.project_id), eq(aiProfiles.id, profileId)))
      .run()

    // Need to clear all OTHER defaults
    db.update(aiProfiles)
      .set({ is_default: 0 })
      .where(eq(aiProfiles.project_id, current.project_id))
      .run()
  }

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
    updateData.thinking_enabled = data.thinkingEnabled === null ? null : data.thinkingEnabled ? 1 : 0
  }
  if (data.thinkingMode !== undefined) updateData.thinking_mode = data.thinkingMode
  if (data.thinkingBudgetTokens !== undefined) updateData.thinking_budget_tokens = data.thinkingBudgetTokens
  if (data.planningEnabled !== undefined) {
    updateData.planning_enabled = data.planningEnabled === null ? null : data.planningEnabled ? 1 : 0
  }
  if (data.planningMode !== undefined) updateData.planning_mode = data.planningMode

  db.update(aiProfiles).set(updateData).where(eq(aiProfiles.id, profileId)).run()

  return getAIProfile(profileId)
}

/**
 * Set an AI profile as the default for its project.
 */
export function setDefaultAIProfile(profileId: string): boolean {
  const db = getDrizzle()

  const profile = getAIProfile(profileId)
  if (!profile) return false

  // Clear existing default
  db.update(aiProfiles)
    .set({ is_default: 0 })
    .where(eq(aiProfiles.project_id, profile.project_id))
    .run()

  // Set new default
  const result = db
    .update(aiProfiles)
    .set({ is_default: 1, updated_at: new Date().toISOString() })
    .where(eq(aiProfiles.id, profileId))
    .run()

  return result.changes > 0
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete an AI profile.
 */
export function deleteAIProfile(profileId: string): boolean {
  const db = getDrizzle()
  const result = db.delete(aiProfiles).where(eq(aiProfiles.id, profileId)).run()
  return result.changes > 0
}

/**
 * Delete all AI profiles for a project.
 */
export function deleteAIProfilesByProject(projectId: string): number {
  const db = getDrizzle()
  const result = db.delete(aiProfiles).where(eq(aiProfiles.project_id, projectId)).run()
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
