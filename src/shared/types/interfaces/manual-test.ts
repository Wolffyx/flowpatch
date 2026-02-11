/**
 * Types for manual card testing functionality.
 *
 * Enables users to manually test AI modifications by either
 * recreating a worktree or checking out the branch in the main repo.
 */

/** Where to run manual tests */
export type TestLocation = 'worktree' | 'mainRepo'

/** Extended test info returned by getCardTestInfo */
export interface ManualTestInfo {
  success: boolean
  error?: string

  // Worktree availability
  hasWorktree: boolean
  worktreePath?: string

  // Branch info
  branchName: string | null
  branchExistsLocal: boolean
  branchExistsRemote: boolean

  // Project paths
  repoPath: string

  // Project type detection
  projectType?: {
    type: string
    hasPackageJson: boolean
    port?: number
  }

  // Available commands
  commands?: {
    install?: string
    dev?: string
    build?: string
  }

  // What actions are available to the user
  canRecreateWorktree: boolean
  canCheckoutInMainRepo: boolean
}

/** Request to prepare a test environment */
export interface PrepareTestEnvironmentRequest {
  projectId: string
  cardId: string
  location: TestLocation
}

/** Result of preparing a test environment */
export interface PrepareTestEnvironmentResult {
  success: boolean
  workingDir?: string
  branchName?: string
  location?: TestLocation
  wasRecreated?: boolean
  /** Whether install was attempted */
  installRan?: boolean
  /** Whether install succeeded (only set if installRan is true) */
  installSuccess?: boolean
  /** Whether install was skipped because dependencies were already installed */
  installSkipped?: boolean
  /** Error message if install failed */
  installError?: string
  error?: string
}

/** Data sent when prompting user for manual test after AI phase */
export interface ManualTestPromptData {
  projectId: string
  cardId: string
  jobId: string
  cardTitle?: string
  branchName?: string
  worktreePath?: string
}
