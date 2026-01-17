import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import {
  getIndexPaths,
  type FlowPatchIndexMeta,
  type FlowPatchFileIndexEntry
} from './flowpatch-indexer'
import { gitDiffNameOnly, gitHeadSha } from './flowpatch-git'
import { createPlanFile } from './flowpatch-workspace'

const BEGIN = '<!-- FLOWPATCH:BEGIN generated -->'
const END = '<!-- FLOWPATCH:END generated -->'

function replaceGeneratedSection(original: string, generated: string): string {
  const start = original.indexOf(BEGIN)
  const end = original.indexOf(END)
  if (start >= 0 && end >= 0 && end > start) {
    return (
      original.slice(0, start) +
      BEGIN +
      '\n' +
      generated.trimEnd() +
      '\n' +
      END +
      original.slice(end + END.length)
    )
  }
  const suffix = original.endsWith('\n') ? '' : '\n'
  return `${original}${suffix}\n${BEGIN}\n${generated.trimEnd()}\n${END}\n`
}

function loadIndex(repoRoot: string): {
  meta: FlowPatchIndexMeta | null
  files: FlowPatchFileIndexEntry[]
} {
  const { metaPath, fileIndexPath } = getIndexPaths(repoRoot)
  let meta: FlowPatchIndexMeta | null = null
  let files: FlowPatchFileIndexEntry[] = []
  try {
    if (existsSync(metaPath))
      meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as FlowPatchIndexMeta
  } catch {
    meta = null
  }
  try {
    if (existsSync(fileIndexPath)) {
      const parsed = JSON.parse(readFileSync(fileIndexPath, 'utf-8')) as {
        files?: FlowPatchFileIndexEntry[]
      }
      files = parsed.files ?? []
    }
  } catch {
    files = []
  }
  return { meta, files }
}

function computeTopDirs(files: FlowPatchFileIndexEntry[]): { dir: string; files: number }[] {
  const counts = new Map<string, number>()
  for (const f of files) {
    const parts = f.path.split('/')
    const top = parts[0] || ''
    if (!top || top.startsWith('.')) continue
    counts.set(top, (counts.get(top) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([dir, files]) => ({ dir, files }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 12)
}

export async function refreshFlowPatchDocs(repoRoot: string): Promise<{ updated: string[] }> {
  const docsDir = join(repoRoot, '.flowpatch', 'docs')
  const wherePath = join(docsDir, 'WHERE_TO_CHANGE.md')
  const agentsPath = join(docsDir, 'AGENTS.md')

  const updated: string[] = []
  const { meta, files } = loadIndex(repoRoot)
  const topDirs = computeTopDirs(files)
  const [changedFiles, headSha] = await Promise.all([
    gitDiffNameOnly(repoRoot),
    gitHeadSha(repoRoot)
  ])

  // WHERE_TO_CHANGE.md
  if (existsSync(wherePath)) {
    const before = readFileSync(wherePath, 'utf-8')
    const generated = [
      '## Repo Map (generated)',
      '',
      '| Area | Notes |',
      '|---|---|',
      ...topDirs.map((d) => `| \`${d.dir}/\` | ~${d.files} files |`),
      '',
      meta
        ? `Indexed at: \`${meta.lastIndexedAt}\` · SHA: \`${meta.lastIndexedSha ?? '—'}\``
        : 'Indexed: (missing)',
      '',
      '## Working Tree Changes (generated)',
      '',
      headSha ? `HEAD: \`${headSha}\`` : 'HEAD: (unknown)',
      '',
      changedFiles.length
        ? changedFiles
            .slice(0, 40)
            .map((p) => `- \`${p}\``)
            .join('\n')
        : '(none detected)'
    ].join('\n')
    const after = replaceGeneratedSection(before, generated)
    if (after !== before) {
      writeFileSync(wherePath, after, { encoding: 'utf-8' })
      updated.push(wherePath)
    }
  }

  // AGENTS.md
  if (existsSync(agentsPath)) {
    const before = readFileSync(agentsPath, 'utf-8')
    const generated = [
      '## Index Summary (generated)',
      '',
      `- Files indexed: ${meta?.totalFiles ?? files.length}`,
      `- Chunks: ${meta?.chunks ?? '—'}`,
      `- Symbols: ${meta?.symbols ?? '—'}`,
      `- Last indexed: ${meta?.lastIndexedAt ?? '—'}`,
      `- SHA: ${meta?.lastIndexedSha ?? '—'}`
    ].join('\n')
    const after = replaceGeneratedSection(before, generated)
    if (after !== before) {
      writeFileSync(agentsPath, after, { encoding: 'utf-8' })
      updated.push(agentsPath)
    }
  }

  // Doc lint: keep docs small (warn via generated section if too large).
  const lintPaths = [agentsPath, wherePath]
  for (const p of lintPaths) {
    if (!existsSync(p)) continue
    try {
      const text = readFileSync(p, 'utf-8')
      const lines = text.split(/\r?\n/).length
      if (lines > 800) {
        const warning = `\n\n> FLOWPATCH WARNING: This doc is ${lines} lines; consider trimming to keep agent context small.\n`
        if (!text.includes('FLOWPATCH WARNING')) {
          writeFileSync(p, text + warning, { encoding: 'utf-8' })
          updated.push(p)
        }
      }
    } catch {
      // ignore
    }
  }

  // PLAN.md: backup existing and reset to template
  const planPath = join(docsDir, 'PLAN.md')
  if (existsSync(planPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupPath = join(docsDir, `PLAN.backup.${timestamp}.md`)
    try {
      copyFileSync(planPath, backupPath)
      updated.push(`${backupPath} (backup)`)
      // Delete the existing plan so createPlanFile will create a fresh one
      unlinkSync(planPath)
    } catch {
      // ignore backup errors
    }
  }
  // Create fresh plan template
  const planResult = createPlanFile(repoRoot)
  if (planResult.created) {
    updated.push(planPath)
  }

  return { updated }
}
