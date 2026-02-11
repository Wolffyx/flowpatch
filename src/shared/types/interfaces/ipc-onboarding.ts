/**
 * IPC Onboarding Types
 *
 * Types for repository onboarding: wizards, prompts, labels, and GitHub Projects V2.
 */

import type { Project } from './project'
import type { ProjectIdPayload } from './ipc-common'

// ============================================================================
// Onboarding State
// ============================================================================

export interface GetRepoOnboardingStatePayload {
  projectId: string
}

export interface RepoOnboardingState {
  shouldPromptGithubProject: boolean
  shouldShowLabelWizard: boolean
  shouldShowStarterCardsWizard: boolean
}

// ============================================================================
// Label Wizard
// ============================================================================

/**
 * Payload for dismissing the label wizard.
 */
export type DismissLabelWizardPayload = ProjectIdPayload

/**
 * Payload for resetting the label wizard state.
 */
export type ResetLabelWizardPayload = ProjectIdPayload

// ============================================================================
// Starter Cards Wizard
// ============================================================================

/**
 * Payload for dismissing the starter cards wizard.
 */
export type DismissStarterCardsWizardPayload = ProjectIdPayload

/**
 * Payload for completing the starter cards wizard.
 */
export type CompleteStarterCardsWizardPayload = ProjectIdPayload

// ============================================================================
// GitHub Project Prompt
// ============================================================================

/**
 * Payload for dismissing the GitHub project prompt.
 */
export type DismissGithubProjectPromptPayload = ProjectIdPayload

/**
 * Payload for resetting the GitHub project prompt state.
 */
export type ResetGithubProjectPromptPayload = ProjectIdPayload

// ============================================================================
// Label Configuration
// ============================================================================

export interface ApplyLabelConfigPayload {
  projectId: string
  readyLabel: string
  statusLabels: {
    draft: string
    ready: string
    inProgress: string
    inReview: string
    testing: string
    failed: string
    done: string
  }
  createMissingLabels?: boolean
}

export interface ApplyLabelConfigResult {
  success?: boolean
  project?: Project
  error?: string
}

// ============================================================================
// GitHub Projects V2
// ============================================================================

export interface CreateGithubProjectV2Payload {
  projectId: string
  title?: string
}

export interface CreateGithubProjectV2Result {
  success?: boolean
  projectId?: string
  url?: string
  title?: string
  error?: string
}
