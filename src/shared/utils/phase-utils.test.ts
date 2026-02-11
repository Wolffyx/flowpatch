import { describe, it, expect } from 'vitest'
import {
  isPhaseEnabled,
  getPhaseSkipReason,
  getPhaseLabel,
  isCheckEnabled,
  hasAnyChecksEnabled,
  getCheckSkipReason
} from './phase-utils'
import type { PolicyConfig } from '../types/interfaces/policy-config'

describe('phase-utils', () => {
  describe('isPhaseEnabled', () => {
    const basePolicy: PolicyConfig = { version: 1 }

    describe('install phase', () => {
      it('should return true by default (undefined)', () => {
        expect(isPhaseEnabled(basePolicy, 'install')).toBe(true)
      })

      it('should return true when explicitly enabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableInstallPhase: true }
        }
        expect(isPhaseEnabled(policy, 'install')).toBe(true)
      })

      it('should return false when explicitly disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableInstallPhase: false }
        }
        expect(isPhaseEnabled(policy, 'install')).toBe(false)
      })
    })

    describe('checks phase', () => {
      it('should return true by default', () => {
        expect(isPhaseEnabled(basePolicy, 'checks')).toBe(true)
      })

      it('should return false when disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableChecksPhase: false }
        }
        expect(isPhaseEnabled(policy, 'checks')).toBe(false)
      })
    })

    describe('e2e phase', () => {
      it('should return false by default (e2e.enabled defaults to false)', () => {
        expect(isPhaseEnabled(basePolicy, 'e2e')).toBe(false)
      })

      it('should return true only when both e2e.enabled and phase toggle are true', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: {
            e2e: {
              enabled: true,
              framework: 'playwright',
              maxRetries: 3,
              timeoutMinutes: 10,
              createTestsIfMissing: true,
              fixToolPriority: 'claude-first'
            },
            enableE2EPhase: true
          }
        }
        expect(isPhaseEnabled(policy, 'e2e')).toBe(true)
      })

      it('should return false when e2e.enabled but phase toggle disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: {
            e2e: {
              enabled: true,
              framework: 'playwright',
              maxRetries: 3,
              timeoutMinutes: 10,
              createTestsIfMissing: true,
              fixToolPriority: 'claude-first'
            },
            enableE2EPhase: false
          }
        }
        expect(isPhaseEnabled(policy, 'e2e')).toBe(false)
      })
    })

    describe('decomposition phase', () => {
      it('should return false by default (decomposition.enabled defaults to false)', () => {
        expect(isPhaseEnabled(basePolicy, 'decomposition')).toBe(false)
      })

      it('should return true when both decomposition.enabled and phase toggle are true', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: {
            decomposition: {
              enabled: true,
              threshold: 'auto',
              createSubIssues: false,
              maxSubtasks: 5
            },
            enableDecompositionPhase: true
          }
        }
        expect(isPhaseEnabled(policy, 'decomposition')).toBe(true)
      })
    })

    describe('plan phase', () => {
      it('should return true by default', () => {
        expect(isPhaseEnabled(basePolicy, 'plan')).toBe(true)
      })

      it('should return false when disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enablePlanPhase: false }
        }
        expect(isPhaseEnabled(policy, 'plan')).toBe(false)
      })
    })

    describe('planApproval phase', () => {
      it('should return false by default (approvalRequired defaults to false)', () => {
        expect(isPhaseEnabled(basePolicy, 'planApproval')).toBe(false)
      })

      it('should return true when both approvalRequired and phase toggle are true', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          features: { planning: { enabled: true, mode: 'lite', approvalRequired: true } },
          worker: { enablePlanApprovalPhase: true }
        }
        expect(isPhaseEnabled(policy, 'planApproval')).toBe(true)
      })

      it('should return false when approvalRequired but phase toggle disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          features: { planning: { enabled: true, mode: 'lite', approvalRequired: true } },
          worker: { enablePlanApprovalPhase: false }
        }
        expect(isPhaseEnabled(policy, 'planApproval')).toBe(false)
      })
    })

    describe('commit phase', () => {
      it('should return true by default', () => {
        expect(isPhaseEnabled(basePolicy, 'commit')).toBe(true)
      })

      it('should return false when disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableCommitPhase: false }
        }
        expect(isPhaseEnabled(policy, 'commit')).toBe(false)
      })
    })

    describe('pr phase', () => {
      it('should return true by default', () => {
        expect(isPhaseEnabled(basePolicy, 'pr')).toBe(true)
      })

      it('should return false when disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enablePrPhase: false }
        }
        expect(isPhaseEnabled(policy, 'pr')).toBe(false)
      })
    })

    describe('unknown phase', () => {
      it('should return true for unknown phases', () => {
        // @ts-expect-error - testing unknown phase
        expect(isPhaseEnabled(basePolicy, 'unknown_phase')).toBe(true)
      })
    })
  })

  describe('getPhaseSkipReason', () => {
    it('should return appropriate reason for each phase', () => {
      expect(getPhaseSkipReason('install')).toBe('Install phase disabled in settings')
      expect(getPhaseSkipReason('checks')).toBe('Checks phase disabled in settings')
      expect(getPhaseSkipReason('e2e')).toBe('E2E phase disabled in settings')
      expect(getPhaseSkipReason('decomposition')).toBe('Decomposition phase disabled in settings')
      expect(getPhaseSkipReason('plan')).toBe('Plan phase disabled in settings')
      expect(getPhaseSkipReason('planApproval')).toBe('Plan approval phase disabled in settings')
      expect(getPhaseSkipReason('commit')).toBe('Commit phase disabled in settings')
      expect(getPhaseSkipReason('pr')).toBe('PR creation phase disabled in settings')
    })
  })

  describe('getPhaseLabel', () => {
    it('should return human-readable labels for each phase', () => {
      expect(getPhaseLabel('install')).toBe('Install Dependencies')
      expect(getPhaseLabel('checks')).toBe('Run Checks')
      expect(getPhaseLabel('e2e')).toBe('E2E Testing')
      expect(getPhaseLabel('decomposition')).toBe('Task Decomposition')
      expect(getPhaseLabel('plan')).toBe('Plan Generation')
      expect(getPhaseLabel('planApproval')).toBe('Plan Approval')
      expect(getPhaseLabel('commit')).toBe('Commit & Push')
      expect(getPhaseLabel('pr')).toBe('Create PR/MR')
    })
  })

  describe('isCheckEnabled', () => {
    const basePolicy: PolicyConfig = { version: 1 }

    describe('lint check', () => {
      it('should return true when master and individual toggle are enabled (default)', () => {
        expect(isCheckEnabled(basePolicy, 'lint')).toBe(true)
      })

      it('should return true when explicitly enabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableChecksPhase: true, enableLintCheck: true }
        }
        expect(isCheckEnabled(policy, 'lint')).toBe(true)
      })

      it('should return false when master is disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableChecksPhase: false, enableLintCheck: true }
        }
        expect(isCheckEnabled(policy, 'lint')).toBe(false)
      })

      it('should return false when individual toggle is disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableChecksPhase: true, enableLintCheck: false }
        }
        expect(isCheckEnabled(policy, 'lint')).toBe(false)
      })

      it('should default to true when not specified', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: {}
        }
        expect(isCheckEnabled(policy, 'lint')).toBe(true)
      })
    })

    describe('test check', () => {
      it('should return true by default', () => {
        expect(isCheckEnabled(basePolicy, 'test')).toBe(true)
      })

      it('should return false when master is disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableChecksPhase: false }
        }
        expect(isCheckEnabled(policy, 'test')).toBe(false)
      })

      it('should return false when individual toggle is disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableTestCheck: false }
        }
        expect(isCheckEnabled(policy, 'test')).toBe(false)
      })
    })

    describe('build check', () => {
      it('should return true by default', () => {
        expect(isCheckEnabled(basePolicy, 'build')).toBe(true)
      })

      it('should return false when master is disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableChecksPhase: false }
        }
        expect(isCheckEnabled(policy, 'build')).toBe(false)
      })

      it('should return false when individual toggle is disabled', () => {
        const policy: PolicyConfig = {
          ...basePolicy,
          worker: { enableBuildCheck: false }
        }
        expect(isCheckEnabled(policy, 'build')).toBe(false)
      })
    })

    describe('unknown check', () => {
      it('should return true for unknown check types (with master enabled)', () => {
        // @ts-expect-error - testing unknown check type
        expect(isCheckEnabled(basePolicy, 'unknown_check')).toBe(true)
      })
    })
  })

  describe('hasAnyChecksEnabled', () => {
    const basePolicy: PolicyConfig = { version: 1 }

    it('should return true when all checks enabled (default)', () => {
      expect(hasAnyChecksEnabled(basePolicy)).toBe(true)
    })

    it('should return false when master toggle is disabled', () => {
      const policy: PolicyConfig = {
        ...basePolicy,
        worker: { enableChecksPhase: false }
      }
      expect(hasAnyChecksEnabled(policy)).toBe(false)
    })

    it('should return true when only one check is enabled', () => {
      const policy: PolicyConfig = {
        ...basePolicy,
        worker: {
          enableLintCheck: false,
          enableTestCheck: false,
          enableBuildCheck: true
        }
      }
      expect(hasAnyChecksEnabled(policy)).toBe(true)
    })

    it('should return false when all individual checks are disabled', () => {
      const policy: PolicyConfig = {
        ...basePolicy,
        worker: {
          enableLintCheck: false,
          enableTestCheck: false,
          enableBuildCheck: false
        }
      }
      expect(hasAnyChecksEnabled(policy)).toBe(false)
    })
  })

  describe('getCheckSkipReason', () => {
    it('should return appropriate reason for each check type', () => {
      expect(getCheckSkipReason('lint')).toBe('Lint check disabled in settings')
      expect(getCheckSkipReason('test')).toBe('Test check disabled in settings')
      expect(getCheckSkipReason('build')).toBe('Build check disabled in settings')
    })
  })
})
