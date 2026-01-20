export interface E2ETestConfig {
  enabled: boolean
  framework: 'playwright'
  maxRetries: number
  timeoutMinutes: number
  testCommand?: string
  createTestsIfMissing: boolean
  testDirectories?: string[]
  fixToolPriority: 'claude-first'
}
