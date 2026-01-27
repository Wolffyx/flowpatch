/**
 * Git Auth Types
 */

export type GitAuthMode = 'auto' | 'ssh' | 'https' | 'gh_cli' | 'glab_cli'

export interface GitAuthSettings {
  mode?: GitAuthMode
  forceSshRewrite?: boolean
  preferredHost?: string | null
}

export type GitAuthProtocol = 'ssh' | 'https' | 'unknown'

export interface GitAuthState {
  remoteUrl: string | null
  protocol: GitAuthProtocol
  host: string | null
  hasCredentialHelper: boolean
  hasGhAuth: boolean
  hasGlabAuth: boolean
  sshOk: boolean
  message?: string
  warnings?: string[]
}
