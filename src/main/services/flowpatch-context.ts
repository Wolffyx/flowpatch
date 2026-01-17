import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { FlowPatchBudgets } from './flowpatch-config'
import { readFlowPatchConfig } from './flowpatch-config'
import { buildEffectivePrivacyPolicy, decidePathPrivacy } from './flowpatch-privacy'
import { retrieveSymbols, retrieveText } from './flowpatch-retrieve'
import { buildIndex } from './flowpatch-indexer'

export interface ContextSnippet {
  path: string
  startLine: number
  endLine: number
  text: string
  redactions: number
}

export interface ContextBundle {
  task: string
  generatedAt: string
  budgets: FlowPatchBudgets
  privacyMode: string
  includedFiles: { path: string; score: number; reasons: string[] }[]
  blockedFiles: { path: string; reason: string }[]
  snippets: ContextSnippet[]
  totals: {
    includedFiles: number
    blockedFiles: number
    snippets: number
    redactions: number
    totalLines: number
  }
}

function cap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n…'
}

function redactSecrets(text: string): { text: string; redactions: number } {
  let redactions = 0
  const rules: { re: RegExp; replace: string }[] = [
    { re: /\bsk-[a-z0-9]{16,}\b/gi, replace: 'sk-REDACTED' },
    { re: /\bghp_[A-Za-z0-9]{20,}\b/g, replace: 'ghp_REDACTED' },
    { re: /\bglpat-[A-Za-z0-9\-_]{10,}\b/g, replace: 'glpat-REDACTED' },
    { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: 'AKIAREDACTED' },
    {
      re: /(\b(api[_-]?key|token|secret|password|passwd)\b\s*[:=]\s*)(['"]?)[^'"\s]+(\3)/gi,
      replace: '$1$3REDACTED$4'
    },
    { re: /([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi, replace: 'REDACTED_EMAIL' }
  ]

  let out = text
  for (const rule of rules) {
    out = out.replace(rule.re, () => {
      redactions++
      return rule.replace
    })
  }
  return { text: out, redactions }
}

function readDoc(repoRoot: string, name: string, maxChars: number): string | null {
  const p = join(repoRoot, '.flowpatch', 'docs', name)
  if (!existsSync(p)) return null
  try {
    return cap(readFileSync(p, 'utf-8'), maxChars)
  } catch {
    return null
  }
}

export async function buildContextBundle(repoRoot: string, task: string): Promise<ContextBundle> {
  const { config } = readFlowPatchConfig(repoRoot)
  const budgets = config.budgets
  const privacy = buildEffectivePrivacyPolicy(config.privacy)

  // Ensure index exists and is fresh-ish.
  try {
    await buildIndex(repoRoot)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.toLowerCase().includes('already running')) throw e
  }

  const tokens = task
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((t) => t.length >= 4)
    .slice(0, 24)

  const scoreByPath = new Map<string, { score: number; reasons: string[] }>()

  const textMatches = retrieveText(repoRoot, task, 80)
  for (const m of textMatches) {
    const cur = scoreByPath.get(m.path) ?? { score: 0, reasons: [] }
    cur.score += m.score
    if (cur.reasons.length < 3) cur.reasons.push('text')
    scoreByPath.set(m.path, cur)
  }

  for (const t of tokens) {
    for (const m of retrieveSymbols(repoRoot, t, 20)) {
      const cur = scoreByPath.get(m.path) ?? { score: 0, reasons: [] }
      cur.score += m.score
      if (cur.reasons.length < 3) cur.reasons.push(`symbol:${m.name}`)
      scoreByPath.set(m.path, cur)
    }
  }

  const candidates = [...scoreByPath.entries()]
    .map(([path, v]) => ({ path, score: v.score, reasons: v.reasons }))
    .sort((a, b) => b.score - a.score)

  const includedFiles: { path: string; score: number; reasons: string[] }[] = []
  const blockedFiles: { path: string; reason: string }[] = []

  for (const c of candidates) {
    const decision = decidePathPrivacy(privacy, c.path)
    if (!decision.allowed) {
      blockedFiles.push({ path: c.path, reason: decision.reason })
      continue
    }
    includedFiles.push(c)
    if (includedFiles.length >= budgets.maxFiles) break
  }

  // Snippets: pick best text matches but only from included files.
  const includedSet = new Set(includedFiles.map((f) => f.path))
  const snippets: ContextSnippet[] = []
  let totalLines = 0
  let totalRedactions = 0

  for (const m of textMatches) {
    if (!includedSet.has(m.path)) continue
    const lines = m.snippet.split(/\r?\n/).slice(0, budgets.maxLinesPerFile)
    const capped = lines.join('\n')
    const redacted = redactSecrets(capped)
    const lineCount = redacted.text.split(/\r?\n/).length
    if (totalLines + lineCount > budgets.maxTotalLines) break

    snippets.push({
      path: m.path,
      startLine: m.startLine,
      endLine: m.endLine,
      text: redacted.text,
      redactions: redacted.redactions
    })
    totalLines += lineCount
    totalRedactions += redacted.redactions
    if (snippets.length >= budgets.maxFiles * 2) break
  }

  const generatedAt = new Date().toISOString()
  return {
    task,
    generatedAt,
    budgets,
    privacyMode: privacy.mode,
    includedFiles,
    blockedFiles,
    snippets,
    totals: {
      includedFiles: includedFiles.length,
      blockedFiles: blockedFiles.length,
      snippets: snippets.length,
      redactions: totalRedactions,
      totalLines
    }
  }
}

export function writeLastContext(repoRoot: string, bundle: ContextBundle): string {
  const p = join(repoRoot, '.flowpatch', 'state', 'last_context.json')
  writeFileSync(p, JSON.stringify(bundle, null, 2), { encoding: 'utf-8' })
  return p
}

export function buildPromptContext(repoRoot: string, bundle: ContextBundle): string {
  const agents = readDoc(repoRoot, 'AGENTS.md', 2500)
  const arch = readDoc(repoRoot, 'ARCHITECTURE.md', 2500)
  const plan = readDoc(repoRoot, 'PLAN.md', 3000)

  const suggested = bundle.includedFiles
    .slice(0, 12)
    .map((f) => `- ${f.path} (${f.reasons.join(', ')})`)
    .join('\n')

  const snippetText = bundle.snippets
    .slice(0, 10)
    .map(
      (s) =>
        `### ${s.path}:${s.startLine}\n` +
        (s.redactions ? `# (redacted ${s.redactions})\n` : '') +
        s.text
    )
    .join('\n\n')

  return [
    agents ? `### AGENTS.md (top)\n${agents}` : '### AGENTS.md\n(missing)',
    '',
    arch ? `### ARCHITECTURE.md (top)\n${arch}` : '### ARCHITECTURE.md\n(missing)',
    '',
    plan ? `### PLAN.md (top)\n${plan}` : '',
    '',
    '### Suggested files (from local index)',
    suggested || '(none)',
    '',
    '### Snippets (bounded, may be redacted)',
    snippetText || '(none)'
  ].filter(Boolean).join('\n')
}
