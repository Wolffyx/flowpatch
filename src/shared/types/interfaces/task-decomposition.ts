export interface TaskDecompositionConfig {
  enabled: boolean
  threshold: 'auto' | 'always' | 'never'
  createSubIssues: boolean
  maxSubtasks: number
}
