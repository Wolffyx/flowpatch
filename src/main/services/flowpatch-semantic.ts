import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import type { FlowPatchChunk } from './flowpatch-indexer'

export interface SemanticMatch {
  path: string
  startLine: number
  endLine: number
  score: number
}

export function getSemanticDbPath(repoRoot: string): string {
  return join(repoRoot, '.flowpatch', 'state', 'index', 'embeddings.sqlite')
}

export function buildSemanticIndex(repoRoot: string, chunks: FlowPatchChunk[]): void {
  const dbPath = getSemanticDbPath(repoRoot)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  // FTS5 table for chunk text; SQLite handles tokenization.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
      id UNINDEXED,
      path UNINDEXED,
      startLine UNINDEXED,
      endLine UNINDEXED,
      text
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_vec (
      id TEXT PRIMARY KEY,
      vec BLOB NOT NULL
    );
  `)

  const insert = db.prepare(
    'INSERT INTO chunk_fts (id, path, startLine, endLine, text) VALUES (?, ?, ?, ?, ?)'
  )
  const insertVec = db.prepare('INSERT INTO chunk_vec (id, vec) VALUES (?, ?)')

  const tx = db.transaction(() => {
    db.exec('DELETE FROM chunk_fts;')
    db.exec('DELETE FROM chunk_vec;')
    for (const c of chunks) {
      insert.run(c.id, c.path, c.startLine, c.endLine, c.text)
      insertVec.run(c.id, serializeVec(embedText(c.text)))
    }
  })
  tx()
  db.close()
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((t) => t.length >= 3)
    .slice(0, 400)
}

function hashToken(token: string): number {
  const h = createHash('sha1').update(token).digest()
  // 16-bit int from first two bytes
  return (h[0] << 8) | h[1]
}

// Simple local "embedding" using hashing trick (256 dims) + L2 normalize.
function embedText(text: string): Float32Array {
  const dims = 256
  const vec = new Float32Array(dims)
  const tokens = tokenize(text)
  for (const t of tokens) {
    const hv = hashToken(t)
    const idx = hv % dims
    // signed update based on next bit
    const sign = hv & 0x8000 ? -1 : 1
    vec[idx] += sign * 1
  }
  let norm = 0
  for (let i = 0; i < dims; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < dims; i++) vec[i] /= norm
  return vec
}

function serializeVec(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer)
}

function deserializeVec(buf: Buffer): Float32Array {
  // Copy to avoid referencing a larger underlying Buffer.
  const copy = Buffer.from(buf)
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4)
}

function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < n; i++) dot += a[i] * b[i]
  return dot
}

export function semanticSearch(repoRoot: string, query: string, limit = 20): SemanticMatch[] {
  const dbPath = getSemanticDbPath(repoRoot)
  if (!existsSync(dbPath)) return []

  const db = new Database(dbPath, { readonly: true })
  try {
    // bm25() is available in FTS5; lower is better. Convert to a higher-is-better score.
    const queryVec = embedText(query)

    // Load vectors for candidates and rerank by cosine similarity.
    const getVec = db.prepare('SELECT vec FROM chunk_vec WHERE id = ?')

    const rowsWithId = db
      .prepare(
        `
        SELECT id, path, startLine, endLine, bm25(chunk_fts) AS rank
        FROM chunk_fts
        WHERE chunk_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `
      )
      .all(query, Math.max(limit, 40)) as {
      id: string
      path: string
      startLine: number
      endLine: number
      rank: number
    }[]

    const rescored: SemanticMatch[] = []
    for (const r of rowsWithId) {
      let score = Math.max(1, 100 - Math.min(99, Math.floor(r.rank * 10)))
      try {
        const vecRow = getVec.get(r.id) as { vec: Buffer } | undefined
        if (vecRow?.vec) {
          const v = deserializeVec(vecRow.vec)
          const sim = cosine(queryVec, v) // [-1,1]
          score = Math.max(1, Math.min(100, Math.floor((sim + 1) * 50)))
        }
      } catch {
        // ignore
      }
      rescored.push({
        path: r.path,
        startLine: Number(r.startLine),
        endLine: Number(r.endLine),
        score
      })
    }

    return rescored.sort((a, b) => b.score - a.score).slice(0, limit)
  } catch {
    return []
  } finally {
    db.close()
  }
}
