export type FlowPatchIndexState = 'missing' | 'ready' | 'stale' | 'building' | 'blocked'

export interface FlowPatchIndexStatus {
  state: FlowPatchIndexState
  headSha: string | null
  lastIndexedSha: string | null
  lastIndexedAt: string | null
  warnings?: string[]
}

export interface FlowPatchWorkspaceStatus {
  repoRoot: string
  exists: boolean
  writable: boolean
  gitignoreHasStateIgnore: boolean
  hasConfig: boolean
  hasDocs: boolean
  hasPlan: boolean
  hasScripts: boolean
  hasState: boolean
  index: FlowPatchIndexStatus
  watchEnabled: boolean
  autoIndexingEnabled: boolean
}
