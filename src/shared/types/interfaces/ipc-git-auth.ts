import type { GitAuthMode, GitAuthState } from './git-auth'

export interface GetGitAuthStatePayload {
  projectId: string
}

export interface GetGitAuthStateResult {
  success: boolean
  state: GitAuthState
  mode: GitAuthMode
  forceSshRewrite: boolean
}

export interface SetGitAuthModePayload {
  projectId: string
  mode: GitAuthMode
  forceSshRewrite?: boolean
}

export interface SimpleResult {
  success: boolean
  error?: string
}

export type TestGitAuthPayload = GetGitAuthStatePayload

export interface FixRemotePayload {
  projectId: string
}
