export interface AISessionConfig {
  sessionMode: 'single' | 'iterative'
  maxIterations: number
  progressCheckpoint: boolean
  contextCarryover?: 'full' | 'summary' | 'none'
}
