import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { FlowPatchChunk, FlowPatchSymbol } from './flowpatch-indexer'
import { semanticSearch } from './flowpatch-semantic'

export interface RetrieveSymbolMatch {
  kind: 'symbol'
  name: string
  path: string
  line: number
  exported: boolean
  score: number
}

export interface RetrieveTextMatch {
  kind: 'text'
  path: string
  startLine: number
  endLine: number
  snippet: string
  score: number
}

function normalize(s: string): string {
  return (s || '').toLowerCase()
}

function loadSymbols(repoRoot: string): FlowPatchSymbol[] {
  const symbolsPath = join(repoRoot, '.flowpatch', 'state', 'index', 'symbols.json')
  if (!existsSync(symbolsPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(symbolsPath, 'utf-8')) as { symbols?: FlowPatchSymbol[] }
    return parsed.symbols ?? []
  } catch {
    return []
  }
}

function loadChunks(repoRoot: string, limitBytes = 5_000_000): FlowPatchChunk[] {
  const chunksPath = join(repoRoot, '.flowpatch', 'state', 'index', 'chunks.jsonl')
  if (!existsSync(chunksPath)) return []
  try {
    const buf = readFileSync(chunksPath)
    if (buf.length > limitBytes) return []
    const text = buf.toString('utf-8')
    const lines = text.split(/\r?\n/).filter(Boolean)
    const chunks: FlowPatchChunk[] = []
    for (const line of lines) {
      try {
        chunks.push(JSON.parse(line) as FlowPatchChunk)
      } catch {
        // ignore
      }
    }
    return chunks
  } catch {
    return []
  }
}

export function retrieveSymbols(
  repoRoot: string,
  query: string,
  limit = 20
): RetrieveSymbolMatch[] {
  const q = normalize(query).trim()
  if (!q) return []

  const symbols = loadSymbols(repoRoot)
  const matches: RetrieveSymbolMatch[] = []
  for (const s of symbols) {
    const name = normalize(s.name)
    if (!name) continue
    let score = 0
    if (name === q) score = 100
    else if (name.startsWith(q)) score = 80
    else if (name.includes(q)) score = 60
    else continue
    if (s.exported) score += 5
    matches.push({
      kind: 'symbol',
      name: s.name,
      path: s.path,
      line: s.line,
      exported: s.exported,
      score
    })
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function retrieveText(repoRoot: string, query: string, limit = 20): RetrieveTextMatch[] {
  const q = normalize(query).trim()
  if (!q) return []

  // Prefer semantic search if available.
  const semantic = semanticSearch(repoRoot, q, Math.min(40, limit))
  if (semantic.length > 0) {
    const chunks = loadChunks(repoRoot)
    const chunkByKey = new Map<string, FlowPatchChunk>()
    for (const c of chunks) chunkByKey.set(`${c.path}:${c.startLine}:${c.endLine}`, c)

    const matches: RetrieveTextMatch[] = []
    for (const s of semantic) {
      const key = `${s.path}:${s.startLine}:${s.endLine}`
      const c = chunkByKey.get(key)
      const snippet = c ? (c.text.length > 600 ? c.text.slice(0, 600) + '\n…' : c.text) : ''
      matches.push({
        kind: 'text',
        path: s.path,
        startLine: s.startLine,
        endLine: s.endLine,
        snippet,
        score: s.score
      })
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  const chunks = loadChunks(repoRoot)
  const matches: RetrieveTextMatch[] = []
  for (const c of chunks) {
    const hay = normalize(c.text)
    const idx = hay.indexOf(q)
    if (idx < 0) continue

    // Simple score: prefer earlier matches and shorter files.
    const score = Math.max(1, 100 - Math.min(80, Math.floor(idx / 20)))
    const snippet = c.text.length > 600 ? c.text.slice(0, 600) + '\n…' : c.text
    matches.push({
      kind: 'text',
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      snippet,
      score
    })
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit)
}
