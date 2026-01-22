/**
 * IPC Repository Types
 *
 * Types for repository operations: opening repos, creating repos, selecting remotes, and labels.
 */

import type { Project } from './project'
import type { RemoteInfo } from './remote-info'

// ============================================================================
// Directory Selection
// ============================================================================

export interface SelectDirectoryResult {
  path?: string
  canceled?: boolean
  error?: string
}

// ============================================================================
// Repository Opening
// ============================================================================

export interface OpenRepoResult {
  project?: Project
  remotes?: RemoteInfo[]
  needSelection?: boolean
  canceled?: boolean
  error?: string
}

// ============================================================================
// Repository Creation
// ============================================================================

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

// ============================================================================
// Remote Selection
// ============================================================================

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
// Repository Labels
// ============================================================================

/**
 * Repository label definition for GitHub/GitLab.
 */
export interface RepoLabel {
  name: string
  color?: string
  description?: string
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
