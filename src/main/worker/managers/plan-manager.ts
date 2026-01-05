/**
 * Plan Manager
 *
 * Handles implementation plan generation for different planning modes.
 */

import type { Card, PolicyConfig, PlanningMode } from '../../../shared/types'

/**
 * Manages plan generation for worker pipeline.
 */
export class PlanManager {
  private card: Card
  private policy: PolicyConfig

  constructor(card: Card, policy: PolicyConfig) {
    this.card = card
    this.policy = policy
  }

  /**
   * Generate implementation plan based on planning mode.
   * - skip: Returns a minimal plan
   * - lite: Basic plan with task overview and high-level approach
   * - spec: Detailed specification with file analysis and dependencies
   * - full: Comprehensive plan with risk analysis and verification steps
   */
  generatePlan(mode: PlanningMode): string {
    switch (mode) {
      case 'skip':
        return this.generateMinimalPlan()
      case 'lite':
        return this.generateLitePlan()
      case 'spec':
        return this.generateSpecPlan()
      case 'full':
        return this.generateFullPlan()
      default:
        return this.generateLitePlan()
    }
  }

  /**
   * Generate a minimal plan for 'skip' mode.
   * Returns a simple task summary without detailed planning.
   */
  private generateMinimalPlan(): string {
    return `
# Task Summary

**Title:** ${this.card.title}

**Description:** ${this.card.body || 'No description provided'}

**Commands:** ${(this.policy.worker?.allowedCommands || []).join(', ') || 'None specified'}

*Planning skipped - proceeding directly to implementation.*
`.trim()
  }

  /**
   * Generate a lite plan - basic overview and approach.
   */
  private generateLitePlan(): string {
    return `
# Implementation Plan (Lite)

## Task
${this.card.title}

## Description
${this.card.body || 'No description provided'}

## Approach
1. Analyze the requirements
2. Identify files to modify
3. Implement changes
4. Run verification commands
5. Commit and push

## Commands to Run
${(this.policy.worker?.allowedCommands || []).map((c) => `- ${c}`).join('\n') || '- None specified'}
`.trim()
  }

  /**
   * Generate a spec plan - detailed specification with file analysis.
   */
  private generateSpecPlan(): string {
    const lintCmd = this.policy.worker?.lintCommand
    const testCmd = this.policy.worker?.testCommand
    const buildCmd = this.policy.worker?.buildCommand

    return `
# Implementation Specification (Spec)

## Task
${this.card.title}

## Description
${this.card.body || 'No description provided'}

## Analysis Requirements
Before implementing, analyze the following:
1. Identify all files that need to be modified
2. List any new files that need to be created
3. Check for existing patterns in the codebase to follow
4. Identify any dependencies or related components

## Implementation Steps
1. **Preparation**
   - Review existing code structure
   - Identify integration points

2. **Core Changes**
   - Implement the main functionality
   - Follow existing code patterns and conventions

3. **Integration**
   - Wire up new components
   - Update any necessary imports/exports

4. **Testing**
   - Add or update tests as needed
   - Verify existing tests still pass

## Verification
${lintCmd ? `- Lint: \`${lintCmd}\`` : ''}
${testCmd ? `- Test: \`${testCmd}\`` : ''}
${buildCmd ? `- Build: \`${buildCmd}\`` : ''}

## Allowed Commands
${(this.policy.worker?.allowedCommands || []).map((c) => `- ${c}`).join('\n') || '- None specified'}

## Forbidden Paths
${(this.policy.worker?.forbidPaths || []).map((p) => `- ${p}`).join('\n') || '- None'}
`.trim()
  }

  /**
   * Generate a full plan - comprehensive with risk analysis.
   */
  private generateFullPlan(): string {
    const lintCmd = this.policy.worker?.lintCommand
    const testCmd = this.policy.worker?.testCommand
    const buildCmd = this.policy.worker?.buildCommand

    return `
# Comprehensive Implementation Plan (Full)

## Task
${this.card.title}

## Description
${this.card.body || 'No description provided'}

## Pre-Implementation Analysis
Before making any changes:
1. **Codebase Exploration**
   - Map the relevant parts of the codebase
   - Identify all files that might be affected
   - Understand the data flow and dependencies

2. **Pattern Recognition**
   - Identify coding patterns used in similar features
   - Note any architectural conventions
   - Check for reusable components or utilities

3. **Risk Assessment**
   - Identify potential breaking changes
   - Note any performance considerations
   - Consider backward compatibility

## Implementation Phases

### Phase 1: Foundation
- Set up any necessary infrastructure
- Create new files/modules if needed
- Establish type definitions

### Phase 2: Core Implementation
- Implement the main functionality
- Follow TDD where appropriate
- Keep changes atomic and reviewable

### Phase 3: Integration
- Connect new code with existing systems
- Update any configuration files
- Wire up UI components if applicable

### Phase 4: Polish
- Handle edge cases
- Add error handling
- Improve code clarity

## Testing Strategy
1. **Unit Tests**
   - Test individual functions/components
   - Cover edge cases

2. **Integration Tests**
   - Test component interactions
   - Verify data flow

3. **Manual Verification**
   - Test the full user flow
   - Verify in development environment

## Verification Commands
${lintCmd ? `- Lint: \`${lintCmd}\`` : ''}
${testCmd ? `- Test: \`${testCmd}\`` : ''}
${buildCmd ? `- Build: \`${buildCmd}\`` : ''}

## Constraints
### Allowed Commands
${(this.policy.worker?.allowedCommands || []).map((c) => `- ${c}`).join('\n') || '- None specified'}

### Forbidden Paths
${(this.policy.worker?.forbidPaths || []).map((p) => `- ${p}`).join('\n') || '- None'}

## Expected Outcomes
- All acceptance criteria from the task are met
- All tests pass (existing and new)
- Code follows project conventions
- No regressions introduced

## Risks and Mitigations
| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Run full test suite before and after |
| Performance degradation | Profile critical paths if applicable |
| Incomplete implementation | Validate against all acceptance criteria |

## Rollback Plan
If issues are discovered after merge:
1. Revert the PR/MR
2. Document what went wrong
3. Create follow-up issue for proper fix
`.trim()
  }
}
