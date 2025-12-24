import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import type { PatchworkWorkspaceStatus } from '../../shared/types'
import { getIndexStatus } from './patchwork-indexer'
import { isIndexWatchEnabled } from './patchwork-watch-manager'

export interface PatchworkWorkspaceEnsureResult {
  repoRoot: string
  createdPaths: string[]
  updatedGitignore: boolean
}

const STATE_GITIGNORE_ENTRY = '.patchwork/state/'

function tryWriteProbe(dir: string): boolean {
  try {
    const probePath = join(dir, '.patchwork-write-probe.tmp')
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
    writeFileSync(gitignorePath, `# Patchwork IDE-like workspace state (generated)\n${line}`, {
      encoding: 'utf-8'
    })
    created.push(gitignorePath)
    return true
  }

  const existing = readFileSync(gitignorePath, 'utf-8')
  if (existing.split(/\r?\n/).some((l) => l.trim() === STATE_GITIGNORE_ENTRY)) return false

  appendFileSync(gitignorePath, `\n# Patchwork IDE-like workspace state (generated)\n${line}`, {
    encoding: 'utf-8'
  })
  return true
}

export async function getPatchworkWorkspaceStatus(
  repoRoot: string
): Promise<PatchworkWorkspaceStatus> {
  const root = join(repoRoot, '.patchwork')
  const configPath = join(root, 'config.yml')
  const docsPath = join(root, 'docs')
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
    hasScripts: existsSync(scriptsPath),
    hasState: existsSync(statePath),
    index,
    watchEnabled: isIndexWatchEnabled(repoRoot),
    autoIndexingEnabled: false
  }
}

export function ensurePatchworkWorkspace(repoRoot: string): PatchworkWorkspaceEnsureResult {
  const createdPaths: string[] = []

  const root = join(repoRoot, '.patchwork')
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
      'generatedBy: patchwork',
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
      '# Patchwork Agent Notes',
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
    ['// Placeholder: Patchwork context builder', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'retrieve.ts'),
    ['// Placeholder: Patchwork retrieve API', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'watch_index.ts'),
    ['// Placeholder: Patchwork watch index', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'validate_config.ts'),
    ['// Placeholder: Patchwork config validate', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'context_preview.ts'),
    ['// Placeholder: Patchwork context preview', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'repair.ts'),
    ['// Placeholder: Patchwork repair', 'export {}'].join('\n'),
    createdPaths
  )
  ensureFile(
    join(scripts, 'migrate.ts'),
    ['// Placeholder: Patchwork migrate', 'export {}'].join('\n'),
    createdPaths
  )

  const updatedGitignore = ensureGitignore(repoRoot, createdPaths)

  return { repoRoot, createdPaths, updatedGitignore }
}
