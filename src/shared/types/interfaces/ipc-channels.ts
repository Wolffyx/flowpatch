/**
 * IPC Channels
 *
 * Type-safe IPC channel definitions mapping channel names to payload and result types.
 */

import type { Project } from './project'
import type { Worktree } from './worktree'
import type { ThemePreference } from './theme'
import type { Result, AppState } from './ipc-common'

// Repository types
import type {
  SelectDirectoryResult,
  OpenRepoResult,
  CreateRepoPayload,
  CreateRepoResult,
  SelectRemotePayload,
  SelectRemoteResult
} from './ipc-repository'

// Project types
import type {
  GetProjectPayload,
  DeleteProjectPayload,
  DeleteProjectResult,
  UnlinkProjectPayload,
  UnlinkProjectResult,
  UpdateProjectPolicyPayload,
  UpdateProjectPolicyResult
} from './ipc-project'

// Card types
import type {
  CreateTestCardPayload,
  CreateTestCardResult,
  CreateCardPayload,
  CreateCardResult,
  MoveCardPayload,
  MoveCardResult,
  SplitCardPayload,
  SplitCardResult,
  PushCardToRemotePayload,
  PushCardToRemoteResult
} from './ipc-card'

// Worker types
import type {
  ToggleWorkerPayload,
  ToggleWorkerResult,
  SetWorkerToolPreferencePayload,
  SetWorkerToolPreferenceResult,
  SetWorkerRollbackOnCancelPayload,
  SetWorkerRollbackOnCancelResult,
  RunWorkerPayload,
  RunWorkerResult
} from './ipc-worker'

// Sync types
import type { SyncProjectPayload, SyncProjectResult } from './ipc-sync'

// Settings types
import type {
  SetThemePreferenceResult,
  GetApiKeyPayload,
  SetApiKeyPayload,
  SetApiKeyResult,
  CheckCliAgentsResult
} from './ipc-settings'

// AI types
import type {
  GenerateCardDescriptionPayload,
  GenerateCardDescriptionResult,
  GenerateCardListPayload,
  GenerateCardListResult,
  GenerateSplitCardsPayload,
  GenerateSplitCardsResult
} from './ipc-ai'

// UI types
import type {
  SetShowPullRequestsSectionPayload,
  SetShowPullRequestsSectionResult
} from './ipc-ui'

// Onboarding types
import type {
  GetRepoOnboardingStatePayload,
  RepoOnboardingState,
  DismissLabelWizardPayload,
  ResetLabelWizardPayload,
  DismissStarterCardsWizardPayload,
  CompleteStarterCardsWizardPayload,
  DismissGithubProjectPromptPayload,
  ResetGithubProjectPromptPayload,
  ApplyLabelConfigPayload,
  ApplyLabelConfigResult,
  CreateGithubProjectV2Payload,
  CreateGithubProjectV2Result
} from './ipc-onboarding'

// Repository label types (from ipc-repository)
import type {
  ListRepoLabelsPayload,
  ListRepoLabelsResult,
  CreateRepoLabelsPayload,
  CreateRepoLabelsResult
} from './ipc-repository'

// Worktree types
import type {
  RemoveWorktreeResult,
  RecreateWorktreeResult,
  OpenWorktreeFolderResult,
  CleanupStaleWorktreesResult
} from './ipc-worktree'

// ============================================================================
// IPC Channel Map
// ============================================================================

/**
 * Type-safe IPC channel definitions.
 * Maps channel names to their payload and result types.
 */
export interface IPCChannels {
  // Repository
  selectDirectory: { payload: void; result: SelectDirectoryResult }
  openRepo: { payload: void; result: OpenRepoResult }
  createRepo: { payload: CreateRepoPayload; result: CreateRepoResult }
  selectRemote: { payload: SelectRemotePayload; result: SelectRemoteResult }

  // State
  getState: { payload: void; result: AppState }
  getProject: { payload: GetProjectPayload; result: Project | null }

  // Project
  deleteProject: { payload: DeleteProjectPayload; result: DeleteProjectResult }
  unlinkProject: { payload: UnlinkProjectPayload; result: UnlinkProjectResult }
  updateProjectPolicy: { payload: UpdateProjectPolicyPayload; result: UpdateProjectPolicyResult }

  // Card
  createTestCard: { payload: CreateTestCardPayload; result: CreateTestCardResult }
  createCard: { payload: CreateCardPayload; result: CreateCardResult }
  splitCard: { payload: SplitCardPayload; result: SplitCardResult }
  moveCard: { payload: MoveCardPayload; result: MoveCardResult }
  pushCardToRemote: { payload: PushCardToRemotePayload; result: PushCardToRemoteResult }

  // Worker
  toggleWorker: { payload: ToggleWorkerPayload; result: ToggleWorkerResult }
  setWorkerToolPreference: {
    payload: SetWorkerToolPreferencePayload
    result: SetWorkerToolPreferenceResult
  }
  setWorkerRollbackOnCancel: {
    payload: SetWorkerRollbackOnCancelPayload
    result: SetWorkerRollbackOnCancelResult
  }
  runWorker: { payload: RunWorkerPayload; result: RunWorkerResult }

  // Sync
  syncProject: { payload: SyncProjectPayload; result: SyncProjectResult }

  // Settings
  getThemePreference: { payload: void; result: ThemePreference }
  setThemePreference: { payload: ThemePreference; result: SetThemePreferenceResult }
  getSystemTheme: { payload: void; result: 'light' | 'dark' }
  getApiKey: { payload: GetApiKeyPayload; result: string | null }
  setApiKey: { payload: SetApiKeyPayload; result: SetApiKeyResult }
  checkCliAgents: { payload: void; result: CheckCliAgentsResult }

  // AI
  generateCardDescription: {
    payload: GenerateCardDescriptionPayload
    result: GenerateCardDescriptionResult
  }
  generateCardList: { payload: GenerateCardListPayload; result: GenerateCardListResult }
  generateSplitCards: { payload: GenerateSplitCardsPayload; result: GenerateSplitCardsResult }

  // UI
  setShowPullRequestsSection: {
    payload: SetShowPullRequestsSectionPayload
    result: SetShowPullRequestsSectionResult
  }

  // Onboarding
  getRepoOnboardingState: { payload: GetRepoOnboardingStatePayload; result: RepoOnboardingState }
  dismissLabelWizard: { payload: DismissLabelWizardPayload; result: Result }
  resetLabelWizard: { payload: ResetLabelWizardPayload; result: Result }
  dismissStarterCardsWizard: { payload: DismissStarterCardsWizardPayload; result: Result }
  completeStarterCardsWizard: { payload: CompleteStarterCardsWizardPayload; result: Result }
  dismissGithubProjectPrompt: { payload: DismissGithubProjectPromptPayload; result: Result }
  resetGithubProjectPrompt: { payload: ResetGithubProjectPromptPayload; result: Result }
  listRepoLabels: { payload: ListRepoLabelsPayload; result: ListRepoLabelsResult }
  createRepoLabels: { payload: CreateRepoLabelsPayload; result: CreateRepoLabelsResult }
  applyLabelConfig: { payload: ApplyLabelConfigPayload; result: ApplyLabelConfigResult }
  createGithubProjectV2: {
    payload: CreateGithubProjectV2Payload
    result: CreateGithubProjectV2Result
  }

  // Worktree
  listWorktrees: { payload: string; result: Worktree[] }
  getWorktree: { payload: string; result: Worktree | null }
  removeWorktree: { payload: string; result: RemoveWorktreeResult }
  recreateWorktree: { payload: string; result: RecreateWorktreeResult }
  openWorktreeFolder: { payload: string; result: OpenWorktreeFolderResult }
  cleanupStaleWorktrees: { payload: string; result: CleanupStaleWorktreesResult }
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Helper type to get payload type for a channel.
 */
export type IPCPayload<T extends keyof IPCChannels> = IPCChannels[T]['payload']

/**
 * Helper type to get result type for a channel.
 */
export type IPCResult<T extends keyof IPCChannels> = IPCChannels[T]['result']
