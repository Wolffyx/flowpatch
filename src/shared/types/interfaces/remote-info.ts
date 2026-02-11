export interface RemoteInfo {
  name: string
  url: string
  provider: 'github' | 'gitlab' | 'unknown'
  repoKey: string
}
