export interface AISessionConfig {
  sessionMode: 'single' | 'iterative'
  maxIterations: number
  progressCheckpoint: boolean
  contextCarryover?: 'full' | 'summary' | 'none'
  /** Use minimal prompts for iterations 2+ to reduce context/token usage (default: true) */
  minimalContinuationPrompt?: boolean
}
