import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import type { FlowPatchWorkspaceStatus } from '../../shared/types'
import { getIndexStatus } from './flowpatch-indexer'
import { isIndexWatchEnabled } from './flowpatch-watch-manager'

export interface FlowPatchWorkspaceEnsureResult {
  repoRoot: string
  createdPaths: string[]
  updatedGitignore: boolean
}

//todo add in the feature the state folder
// const STATE_GITIGNORE_ENTRY =  '.flowpatch/state/'
const STATE_GITIGNORE_ENTRY =  '.flowpatch/'

function tryWriteProbe(dir: string): boolean {
  try {
    const probePath = join(dir, '.flowpatch-write-probe.tmp')
    writeFileSync(probePath, 'ok', { encoding: 'utf-8' })
    try {
      // Best-effort cleanup; ignore failures.
      require('fs').unlinkSync(probePath)
    } catch {
      // ignore
    }
    return true
  } catch {
    return false
  }
}

function ensureDir(path: string, created: string[]): void {
  if (existsSync(path)) return
  mkdirSync(path, { recursive: true })
  created.push(path)
}

function ensureFile(path: string, contents: string, created: string[]): void {
  if (existsSync(path)) return
  writeFileSync(path, contents, { encoding: 'utf-8' })
  created.push(path)
}

function ensureGitignore(repoRoot: string, created: string[]): boolean {
  const gitignorePath = join(repoRoot, '.gitignore')
  const line = `${STATE_GITIGNORE_ENTRY}\n`

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `# FlowPatch IDE-like workspace state (generated)\n${line}`, {
      encoding: 'utf-8'
    })
    created.push(gitignorePath)
    return true
  }

  const existing = readFileSync(gitignorePath, 'utf-8')
  if (existing.split(/\r?\n/).some((l) => l.trim() === STATE_GITIGNORE_ENTRY)) return false

  appendFileSync(gitignorePath, `\n# FlowPatch IDE-like workspace state (generated)\n${line}`, {
    encoding: 'utf-8'
  })
  return true
}

export async function getFlowPatchWorkspaceStatus(
  repoRoot: string
): Promise<FlowPatchWorkspaceStatus> {
  const root = join(repoRoot, '.flowpatch')
  const configPath = join(root, 'config.yml')
  const docsPath = join(root, 'docs')
  const planPath = join(docsPath, 'PLAN.md')
  const scriptsPath = join(root, 'scripts')
  const statePath = join(root, 'state')

  const exists = existsSync(root)
  const writable = exists ? tryWriteProbe(root) : tryWriteProbe(repoRoot)

  const gitignorePath = join(repoRoot, '.gitignore')
  const gitignoreHasStateIgnore = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf-8')
        .split(/\r?\n/)
        .some((l) => l.trim() === STATE_GITIGNORE_ENTRY)
    : false

  const index = await getIndexStatus(repoRoot)

  return {
    repoRoot,
    exists,
    writable,
    gitignoreHasStateIgnore,
    hasConfig: existsSync(configPath),
    hasDocs: existsSync(docsPath),
    hasPlan: existsSync(planPath),
    hasScripts: existsSync(scriptsPath),
    hasState: existsSync(statePath),
    index,
    watchEnabled: isIndexWatchEnabled(repoRoot),
    autoIndexingEnabled: false
  }
}

export function ensureFlowPatchWorkspace(repoRoot: string): FlowPatchWorkspaceEnsureResult {
  const createdPaths: string[] = []

  const root = join(repoRoot, '.flowpatch')
  const docs = join(root, 'docs')
  const scripts = join(root, 'scripts')
  const state = join(root, 'state')
  const stateIndex = join(state, 'index')
  const stateCache = join(state, 'cache')
  const stateLogs = join(state, 'logs')
  const stateLocks = join(state, 'locks')

  ensureDir(root, createdPaths)
  ensureDir(docs, createdPaths)
  ensureDir(scripts, createdPaths)
  ensureDir(state, createdPaths)
  ensureDir(stateIndex, createdPaths)
  ensureDir(stateCache, createdPaths)
  ensureDir(stateLogs, createdPaths)
  ensureDir(stateLocks, createdPaths)

  ensureFile(
    join(root, 'config.yml'),
    [
      'schemaVersion: 1',
      'generatedBy: flowpatch',
      '',
      '# Budgets',
      'budgets:',
      '  maxFiles: 12',
      '  maxLinesPerFile: 200',
      '  maxTotalLines: 1200',
      '',
      '# Privacy (optional overrides; app defaults apply when omitted)',
      '# privacy:',
      '#   mode: standard  # strict|standard|off',
      '#   denyCategories: [secrets, privateKeys, credentials, localConfigs]',
      '#   allowGlobs: ["**/*.env.example"]',
      '#   denyGlobs: ["**/*.sqlite", "**/*.log"]',
      ''
    ].join('\n'),
    createdPaths
  )

  ensureFile(
    join(docs, 'AGENTS.md'),
    [
      '# FlowPatch Agent Notes',
      '',
      '- Where things live:',
      '- Commands:',
      '- When asked X check Y:'
    ].join('\n'),
    createdPaths
  )
  ensureFile(join(docs, 'ARCHITECTURE.md'), '# Architecture\n', createdPaths)
  ensureFile(join(docs, 'DECISIONS.md'), '# Decisions\n', createdPaths)
  ensureFile(join(docs, 'CONVENTIONS.md'), '# Conventions\n', createdPaths)
  ensureFile(join(docs, 'RUNBOOK.md'), '# Runbook\n', createdPaths)
  ensureFile(
    join(docs, 'WHERE_TO_CHANGE.md'),
    ['# Where To Change', '', '| Area | Files |', '|---|---|', '| | |'].join('\n'),
    createdPaths
  )
  ensureFile(join(docs, 'SCHEMA.md'), '# Config Schema\n', createdPaths)
  ensureFile(join(docs, 'INTEGRATIONS.md'), '# Integrations\n', createdPaths)

  ensureFile(
    join(scripts, 'build_context.ts'),
    ['// Placeholder: FlowPatch context builder', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'retrieve.ts'),
    ['// Placeholder: FlowPatch retrieve API', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'watch_index.ts'),
    ['// Placeholder: FlowPatch watch index', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'validate_config.ts'),
    ['// Placeholder: FlowPatch config validate', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'context_preview.ts'),
    ['// Placeholder: FlowPatch context preview', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'repair.ts'),
    ['// Placeholder: FlowPatch repair', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'migrate.ts'),
    ['// Placeholder: FlowPatch migrate', 'export {}'].join('\n'),
    createdPaths
  )

  const updatedGitignore = ensureGitignore(repoRoot, createdPaths)

  return { repoRoot, createdPaths, updatedGitignore }
}

export function createPlanFile(repoRoot: string): { created: boolean; path: string } {
  const docsPath = join(repoRoot, '.flowpatch', 'docs')
  const planPath = join(docsPath, 'PLAN.md')

  if (existsSync(planPath)) {
    return { created: false, path: planPath }
  }

  // Ensure docs directory exists
  if (!existsSync(docsPath)) {
    mkdirSync(docsPath, { recursive: true })
  }

  const planTemplate = `# Implementation Plan

## Task Description
<!--
Provide a clear, concise summary of what needs to be built or fixed.
Include:
- The specific feature, bug, or improvement
- The user-facing behavior expected
- Any constraints or requirements

Example:
"Add a dark mode toggle to the settings page that persists user preference
to localStorage and applies the theme across all components."
-->


## Context & Background
<!--
Explain WHY this task exists and provide relevant context:
- Link to related issues, PRs, or discussions
- Describe the current behavior vs desired behavior
- Note any previous attempts or related work
- Include relevant technical debt or limitations

Example:
"Currently the app only supports light mode. Users have requested dark mode
support (Issue #123). The design team has provided mockups in Figma [link].
We use Tailwind CSS which has built-in dark mode support via the 'dark:' prefix."
-->


## Technical Analysis
<!--
Document your understanding of the codebase relevant to this task:
- Key files and their responsibilities
- Existing patterns to follow
- Dependencies and integrations affected
- Potential risks or edge cases

Example:
"Theme state should live in ThemeContext (src/contexts/ThemeContext.tsx).
All color classes need dark: variants. The Header, Sidebar, and Card
components are the main surfaces that need theme support."
-->


## Implementation Steps
<!--
Break down the work into discrete, actionable steps.
Each step should be:
- Small enough to verify independently
- Ordered by dependency (what must happen first)
- Clear about what "done" means for that step

Mark steps as you complete them: [ ] -> [x]
-->

1. [ ] **Step 1 title**: Description of what to do and expected outcome
2. [ ] **Step 2 title**: Description of what to do and expected outcome
3. [ ] **Step 3 title**: Description of what to do and expected outcome


## Files to Modify
<!--
List all files that will be created, modified, or deleted.
This helps track scope and ensures nothing is missed.
-->

| File | Action | Description |
|------|--------|-------------|
| \`src/path/to/file.ts\` | modify | Brief description of changes |
| \`src/path/to/new-file.ts\` | create | Purpose of new file |
| \`src/path/to/old-file.ts\` | delete | Why it's being removed |


## Testing Strategy
<!--
Define how to verify the implementation works correctly:
-->

### Unit Tests
<!-- Test individual functions/components in isolation -->
- [ ] Test case 1: Description and expected result
- [ ] Test case 2: Description and expected result

### Integration Tests
<!-- Test how components work together -->
- [ ] Test case 1: Description and expected result

### Manual Testing
<!-- Steps to manually verify the feature -->
- [ ] Step 1: Action to take and what to verify
- [ ] Step 2: Action to take and what to verify

### Edge Cases
<!-- Unusual scenarios to test -->
- [ ] Edge case 1: What could go wrong and how to test it


## Acceptance Criteria
<!--
Define the specific, measurable conditions that must be met
for this task to be considered complete. Write from user perspective.

Example:
- [ ] User can toggle dark mode from settings page
- [ ] Theme preference persists across browser sessions
- [ ] All text remains readable in both themes
- [ ] No flash of wrong theme on page load
-->

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3


## Dependencies & Blockers
<!--
Note anything that could prevent or delay completion:
- External dependencies (APIs, packages, approvals)
- Other tasks that must complete first
- Questions that need answers
- Access or permissions needed
-->


## Architecture Decisions
<!--
Document any significant technical decisions made:
- Why this approach over alternatives
- Trade-offs considered
- Future implications

Example:
"Using CSS custom properties for theme colors instead of Tailwind's
built-in dark mode. This allows runtime theme switching without
rebuilding CSS, and supports potential future themes beyond light/dark."
-->


## Notes & References
<!--
Additional context, links, or information:
- Documentation links
- Similar implementations to reference
- Design assets
- Meeting notes or discussion threads
-->


---
*Generated by FlowPatch - Update this plan as implementation progresses*
`

  writeFileSync(planPath, planTemplate, { encoding: 'utf-8' })
  return { created: true, path: planPath }
}
