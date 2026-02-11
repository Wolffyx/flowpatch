import type { PolicyConfig } from '../types/interfaces/policy-config'

/**
 * Identifiers for individual check types within the checks phase.
 */
export type CheckId = 'lint' | 'test' | 'build'

/**
 * Identifiers for worker pipeline phases that can be toggled.
 */
export type PhaseId =
  | 'install'
  | 'checks'
  | 'e2e'
  | 'decomposition'
  | 'plan'
  | 'planApproval'
  | 'commit'
  | 'pr'

/**
 * Determines if a specific pipeline phase is enabled based on policy configuration.
 * Missing flags default to `true` (enabled) for backwards compatibility.
 *
 * @param policy - The project's policy configuration
 * @param phase - The phase to check
 * @returns true if the phase should run, false if it should be skipped
 */
export function isPhaseEnabled(policy: PolicyConfig, phase: PhaseId): boolean {
  const worker = policy.worker ?? {}

  switch (phase) {
    case 'install':
      return worker.enableInstallPhase !== false

    case 'checks':
      return worker.enableChecksPhase !== false

    case 'e2e':
      // E2E requires both the e2e.enabled config AND the phase toggle
      return (worker.e2e?.enabled ?? false) && worker.enableE2EPhase !== false

    case 'decomposition':
      // Decomposition requires both decomposition.enabled AND the phase toggle
      return (worker.decomposition?.enabled ?? false) && worker.enableDecompositionPhase !== false

    case 'plan':
      return worker.enablePlanPhase !== false

    case 'planApproval':
      // Plan approval requires both features.planning.approvalRequired AND the phase toggle
      return (
        (policy.features?.planning?.approvalRequired ?? false) &&
        worker.enablePlanApprovalPhase !== false
      )

    case 'commit':
      return worker.enableCommitPhase !== false

    case 'pr':
      return worker.enablePrPhase !== false

    default:
      return true
  }
}

/**
 * Gets the reason text for why a phase was skipped.
 * Useful for logging and UI display.
 */
export function getPhaseSkipReason(phase: PhaseId): string {
  const reasons: Record<PhaseId, string> = {
    install: 'Install phase disabled in settings',
    checks: 'Checks phase disabled in settings',
    e2e: 'E2E phase disabled in settings',
    decomposition: 'Decomposition phase disabled in settings',
    plan: 'Plan phase disabled in settings',
    planApproval: 'Plan approval phase disabled in settings',
    commit: 'Commit phase disabled in settings',
    pr: 'PR creation phase disabled in settings'
  }
  return reasons[phase] ?? 'Phase disabled in settings'
}

/**
 * Gets a human-readable label for a phase.
 */
export function getPhaseLabel(phase: PhaseId): string {
  const labels: Record<PhaseId, string> = {
    install: 'Install Dependencies',
    checks: 'Run Checks',
    e2e: 'E2E Testing',
    decomposition: 'Task Decomposition',
    plan: 'Plan Generation',
    planApproval: 'Plan Approval',
    commit: 'Commit & Push',
    pr: 'Create PR/MR'
  }
  return labels[phase] ?? phase
}

/**
 * Determines if a specific check type is enabled based on policy configuration.
 * A check is enabled if both the master checks phase toggle and the individual
 * check toggle are enabled. Missing flags default to `true` (enabled).
 *
 * @param policy - The project's policy configuration
 * @param check - The check type to evaluate
 * @returns true if the check should run, false if it should be skipped
 */
export function isCheckEnabled(policy: PolicyConfig, check: CheckId): boolean {
  const worker = policy.worker ?? {}

  // Master toggle must be on (defaults to true)
  if (worker.enableChecksPhase === false) return false

  switch (check) {
    case 'lint':
      return worker.enableLintCheck !== false
    case 'test':
      return worker.enableTestCheck !== false
    case 'build':
      return worker.enableBuildCheck !== false
    default:
      return true
  }
}

/**
 * Checks if any individual check type is enabled.
 * Useful for determining if the checks phase should be entered at all.
 *
 * @param policy - The project's policy configuration
 * @returns true if at least one check type is enabled
 */
export function hasAnyChecksEnabled(policy: PolicyConfig): boolean {
  return (
    isCheckEnabled(policy, 'lint') ||
    isCheckEnabled(policy, 'test') ||
    isCheckEnabled(policy, 'build')
  )
}

/**
 * Gets the reason text for why a specific check was skipped.
 */
export function getCheckSkipReason(check: CheckId): string {
  const reasons: Record<CheckId, string> = {
    lint: 'Lint check disabled in settings',
    test: 'Test check disabled in settings',
    build: 'Build check disabled in settings'
  }
  return reasons[check] ?? 'Check disabled in settings'
}
