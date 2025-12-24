/**
 * IPC Types
 *
 * Strict TypeScript types for IPC communication between main and renderer processes.
 */

import type {
  Project,
  Card,
  CardLink,
  Event,
  Job,
  CardStatus,
  PolicyConfig,
  RepoLabel,
  RemoteInfo,
  Worktree
} from '../types'

// ============================================================================
// Common Result Types
// ============================================================================

export interface SuccessResult {
  success: true
}

export interface ErrorResult {
  error: string
}

export type Result<T = void> = (T extends void ? SuccessResult : SuccessResult & T) | ErrorResult

// ============================================================================
// App State
// ============================================================================

export interface ProjectData {
  project: Project
  cards: Card[]
  cardLinks: CardLink[]
  events: Event[]
  jobs: Job[]
}

export interface AppState {
  projects: ProjectData[]
}

// ============================================================================
// Repository Operations
// ============================================================================

export interface SelectDirectoryResult {
  path?: string
  canceled?: boolean
  error?: string
}

export interface OpenRepoResult {
  project?: Project
  remotes?: RemoteInfo[]
  needSelection?: boolean
  canceled?: boolean
  error?: string
}

export interface CreateRepoPayload {
  repoName: string
  localParentPath: string
  remoteName?: string
  addReadme?: boolean
  initialCommit?: boolean
  initialCommitMessage?: string
  remoteProvider?: 'none' | 'github' | 'gitlab'
  remoteVisibility?: 'public' | 'private'
  pushToRemote?: boolean
  githubOwner?: string
  gitlabNamespace?: string
  gitlabHost?: string
}

export interface CreateRepoResult extends OpenRepoResult {
  warnings?: string[]
  repoPath?: string
}

export interface SelectRemotePayload {
  projectId: string
  remoteName: string
  remoteUrl: string
  repoKey: string
}

export interface SelectRemoteResult {
  project?: Project
  error?: string
}

// ============================================================================
// Project Operations
// ============================================================================

export interface GetProjectPayload {
  projectId: string
}

export interface DeleteProjectPayload {
  projectId: string
}

export interface DeleteProjectResult {
  success: boolean
}

export interface UnlinkProjectPayload {
  projectId: string
}

export interface UnlinkProjectResult {
  success?: boolean
  error?: string
}

export interface UpdateProjectPolicyPayload {
  projectId: string
  policy: Partial<PolicyConfig>
}

export interface UpdateProjectPolicyResult {
  success?: boolean
  project?: Project
  error?: string
}

// ============================================================================
// Card Operations
// ============================================================================

export interface CreateTestCardPayload {
  projectId: string
  title: string
}

export interface CreateTestCardResult {
  card: Card
}

export interface CreateCardPayload {
  projectId: string
  title: string
  body?: string
  createType: 'local' | 'repo_issue' | 'github_issue' | 'gitlab_issue'
}

export interface CreateCardResult {
  card?: Card
  issueNumber?: number
  url?: string
  error?: string
}

export interface MoveCardPayload {
  cardId: string
  status: CardStatus
}

export interface MoveCardResult {
  card: Card | null
}

// ============================================================================
// Worker Operations
// ============================================================================

export interface ToggleWorkerPayload {
  projectId: string
  enabled: boolean
}

export interface ToggleWorkerResult {
  project: Project | null
}

export interface SetWorkerToolPreferencePayload {
  projectId: string
  toolPreference: 'auto' | 'claude' | 'codex'
}

export interface SetWorkerToolPreferenceResult {
  success?: boolean
  project?: Project
  error?: string
}

export interface SetWorkerRollbackOnCancelPayload {
  projectId: string
  rollbackOnCancel: boolean
}

export interface SetWorkerRollbackOnCancelResult {
  success?: boolean
  project?: Project
  error?: string
}

export interface RunWorkerPayload {
  projectId: string
  cardId?: string
}

export interface RunWorkerResult {
  success?: boolean
  job?: Job
  error?: string
}

// ============================================================================
// Sync Operations
// ============================================================================

export interface SyncProjectPayload {
  projectId: string
}

export interface SyncProjectResult {
  success: boolean
  error?: string
  job?: Job
}

// ============================================================================
// Settings Operations
// ============================================================================

export type ThemePreference = 'light' | 'dark' | 'system'

export interface SetThemePreferenceResult {
  success?: boolean
  error?: string
}

export interface GetApiKeyPayload {
  key: string
}

export interface SetApiKeyPayload {
  key: string
  value: string
}

export interface SetApiKeyResult {
  success?: boolean
  error?: string
}

export interface CheckCliAgentsResult {
  claude: boolean
  codex: boolean
  anyAvailable: boolean
  isFirstCheck: boolean
}

// ============================================================================
// AI Drafting
// ============================================================================

export interface GenerateCardDescriptionPayload {
  projectId: string
  title: string
  toolPreference?: 'auto' | 'claude' | 'codex'
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface GenerateCardDescriptionResult {
  success?: boolean
  toolUsed?: 'claude' | 'codex'
  response?: string
  error?: string
}

export interface GenerateCardListPayload {
  projectId: string
  description: string
  count: number
  toolPreference?: 'auto' | 'claude' | 'codex'
}

export interface GenerateCardListResult {
  success?: boolean
  toolUsed?: 'claude' | 'codex'
  cards?: Array<{ title: string; body: string }>
  error?: string
}

// ============================================================================
// UI Settings
// ============================================================================

export interface SetShowPullRequestsSectionPayload {
  projectId: string
  showPullRequestsSection: boolean
}

export interface SetShowPullRequestsSectionResult {
  success?: boolean
  project?: Project
  error?: string
}

// ============================================================================
// Onboarding Operations
// ============================================================================

export interface GetRepoOnboardingStatePayload {
  projectId: string
}

export interface RepoOnboardingState {
  shouldPromptGithubProject: boolean
  shouldShowLabelWizard: boolean
  shouldShowStarterCardsWizard: boolean
}

export interface DismissLabelWizardPayload {
  projectId: string
}

export interface ResetLabelWizardPayload {
  projectId: string
}

export interface DismissStarterCardsWizardPayload {
  projectId: string
}

export interface CompleteStarterCardsWizardPayload {
  projectId: string
}

export interface DismissGithubProjectPromptPayload {
  projectId: string
}

export interface ResetGithubProjectPromptPayload {
  projectId: string
}

export interface ListRepoLabelsPayload {
  projectId: string
}

export interface ListRepoLabelsResult {
  labels: RepoLabel[]
  error?: string
}

export interface CreateRepoLabelsPayload {
  projectId: string
  labels: RepoLabel[]
}

export interface CreateRepoLabelsResult {
  created: string[]
  skipped: string[]
  error?: string
}

export interface ApplyLabelConfigPayload {
  projectId: string
  readyLabel: string
  statusLabels: {
    draft: string
    ready: string
    inProgress: string
    inReview: string
    testing: string
    done: string
  }
  createMissingLabels?: boolean
}

export interface ApplyLabelConfigResult {
  success?: boolean
  project?: Project
  error?: string
}

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

// ============================================================================
// Worktree Operations
// ============================================================================

export interface ListWorktreesPayload {
  projectId: string
}

export interface GetWorktreePayload {
  worktreeId: string
}

export interface RemoveWorktreePayload {
  worktreeId: string
}

export interface RemoveWorktreeResult {
  success?: boolean
  error?: string
}

export interface RecreateWorktreePayload {
  worktreeId: string
}

export interface RecreateWorktreeResult {
  success?: boolean
  error?: string
}

export interface OpenWorktreeFolderPayload {
  worktreePath: string
}

export interface OpenWorktreeFolderResult {
  success: boolean
}

export interface CleanupStaleWorktreesPayload {
  projectId: string
}

export interface CleanupStaleWorktreesResult {
  success?: boolean
  result?: unknown
  error?: string
}

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
  moveCard: { payload: MoveCardPayload; result: MoveCardResult }

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

/**
 * Helper type to get payload type for a channel.
 */
export type IPCPayload<T extends keyof IPCChannels> = IPCChannels[T]['payload']

/**
 * Helper type to get result type for a channel.
 */
export type IPCResult<T extends keyof IPCChannels> = IPCChannels[T]['result']
