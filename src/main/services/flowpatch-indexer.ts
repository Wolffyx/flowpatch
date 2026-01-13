import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import {
  readdirSync,
  statSync,
  writeFileSync,
  existsSync,
  readFileSync,
  openSync,
  closeSync,
  unlinkSync
} from 'fs'
import { join, relative } from 'path'
import ts from 'typescript'
import type { FlowPatchIndexStatus } from '../../shared/types'
import { readFlowPatchConfig } from './flowpatch-config'
import { buildEffectivePrivacyPolicy, decidePathPrivacy, stableId } from './flowpatch-privacy'
import { buildSemanticIndex } from './flowpatch-semantic'

const execFileAsync = promisify(execFile)

export class IndexCanceledError extends Error {
  constructor(message = 'Index canceled') {
    super(message)
    this.name = 'IndexCanceledError'
  }
}

export interface FlowPatchIndexMeta {
  schemaVersion: number
  generatedBy: string
  lastIndexedAt: string
  lastIndexedSha: string | null
  totalFiles: number
  excludedFiles: number
  blockedFiles: number
  chunks: number
  symbols: number
  semantic: {
    enabled: boolean
    chunksIndexed: number
    error?: string
  }
  lockfile?: {
    path: string
    sha1: string
  }
}

export interface FlowPatchFileIndexEntry {
  path: string
  size: number
  mtimeMs: number
  hash?: string
}

export interface FlowPatchSymbol {
  id: string
  name: string
  kind: string
  path: string
  line: number
  exported: boolean
}

export interface FlowPatchChunk {
  id: string
  path: string
  startLine: number
  endLine: number
  text: string
}

interface FlowPatchFileCacheEntry {
  hash: string
  chunks: FlowPatchChunk[]
  symbols: FlowPatchSymbol[]
}

const DEFAULT_EXCLUDES = ['.git', 'node_modules', 'dist', 'out', '.flowpatch/state']

async function getHeadSha(repoRoot: string): Promise<string | null> {
  try {
    const res = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
    const sha = (res.stdout || '').trim()
    return sha || null
  } catch {
    return null
  }
}

function isExcludedPath(relPath: string): boolean {
  const rel = relPath.replace(/\\/g, '/')
  return DEFAULT_EXCLUDES.some((ex) => rel === ex || rel.startsWith(`${ex}/`))
}

function readUtf8IfText(absPath: string, maxBytes: number): string | null {
  try {
    const buf = readFileSync(absPath)
    if (buf.length > maxBytes) return null
    // Heuristic: if NUL byte exists, treat as binary.
    if (buf.includes(0)) return null
    return buf.toString('utf-8')
  } catch {
    return null
  }
}

function sha1Text(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), { encoding: 'utf-8' })
}

function writeJsonl(path: string, records: unknown[]): void {
  const lines = records.map((r) => JSON.stringify(r))
  writeFileSync(path, lines.join('\n') + (lines.length ? '\n' : ''), { encoding: 'utf-8' })
}

export function getIndexPaths(repoRoot: string): {
  indexDir: string
  fileIndexPath: string
  metaPath: string
  symbolsPath: string
  chunksPath: string
  cachePath: string
} {
  const indexDir = join(repoRoot, '.flowpatch', 'state', 'index')
  return {
    indexDir,
    fileIndexPath: join(indexDir, 'file_index.json'),
    metaPath: join(indexDir, 'meta.json'),
    symbolsPath: join(indexDir, 'symbols.json'),
    chunksPath: join(indexDir, 'chunks.jsonl'),
    cachePath: join(indexDir, 'cache.json')
  }
}

function scanFiles(
  root: string,
  repoRootForRel: string,
  prefix = '',
  opts?: { isCanceled?: () => boolean }
): { entries: FlowPatchFileIndexEntry[]; excluded: number } {
  const entries: FlowPatchFileIndexEntry[] = []
  let excluded = 0

  const assertNotCanceled = (): void => {
    if (opts?.isCanceled?.()) throw new IndexCanceledError()
  }

  const stack: string[] = [root]
  while (stack.length > 0) {
    assertNotCanceled()
    const dir = stack.pop()!
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      assertNotCanceled()
      const abs = join(dir, name)
      const rel = relative(repoRootForRel, abs).replace(/\\/g, '/')
      if (!rel) continue
      const finalRel = prefix ? `${prefix.replace(/\\/g, '/').replace(/\/$/, '')}/${rel}` : rel
      if (isExcludedPath(finalRel)) {
        excluded++
        continue
      }
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(abs)
        continue
      }
      if (!st.isFile()) continue
      entries.push({ path: finalRel, size: st.size, mtimeMs: st.mtimeMs })
    }
  }

  return { entries, excluded }
}

function loadPreviousFileIndex(repoRoot: string): Map<string, FlowPatchFileIndexEntry> {
  const { fileIndexPath } = getIndexPaths(repoRoot)
  if (!existsSync(fileIndexPath)) return new Map()
  try {
    const parsed = JSON.parse(readFileSync(fileIndexPath, 'utf-8')) as {
      files?: FlowPatchFileIndexEntry[]
    }
    const map = new Map<string, FlowPatchFileIndexEntry>()
    for (const f of parsed.files ?? []) map.set(f.path, f)
    return map
  } catch {
    return new Map()
  }
}

function loadCache(repoRoot: string): Map<string, FlowPatchFileCacheEntry> {
  const { cachePath } = getIndexPaths(repoRoot)
  if (!existsSync(cachePath)) return new Map()
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<
      string,
      FlowPatchFileCacheEntry
    >
    return new Map(Object.entries(parsed))
  } catch {
    return new Map()
  }
}

function saveCache(repoRoot: string, cache: Map<string, FlowPatchFileCacheEntry>): void {
  const { cachePath } = getIndexPaths(repoRoot)
  const obj: Record<string, FlowPatchFileCacheEntry> = {}
  for (const [k, v] of cache.entries()) obj[k] = v
  writeJson(cachePath, obj)
}

function buildChunksForFile(
  relPath: string,
  text: string,
  limits: { maxLines: number; maxChars: number }
): FlowPatchChunk[] {
  const lines = text.split(/\r?\n/)
  const chunks: FlowPatchChunk[] = []
  for (let start = 0; start < lines.length; start += limits.maxLines) {
    const slice = lines.slice(start, start + limits.maxLines)
    let chunkText = slice.join('\n')
    if (chunkText.length > limits.maxChars) {
      chunkText = chunkText.slice(0, limits.maxChars)
    }
    const startLine = start + 1
    const endLine = Math.min(lines.length, start + slice.length)
    chunks.push({
      id: stableId(`${relPath}:${startLine}:${endLine}`),
      path: relPath,
      startLine,
      endLine,
      text: chunkText
    })
  }
  return chunks
}

function findSymbolsInTsFile(relPath: string, text: string): FlowPatchSymbol[] {
  const sourceFile = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true)
  const symbols: FlowPatchSymbol[] = []

  function pushSymbol(node: ts.Node, name: string, kind: string, exported: boolean) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const line1 = line + 1
    symbols.push({
      id: stableId(`${relPath}:${kind}:${name}:${line1}`),
      name,
      kind,
      path: relPath,
      line: line1,
      exported
    })
  }

  function isExported(node: ts.Node): boolean {
    const mods = (node as any).modifiers as ts.NodeArray<ts.Modifier> | undefined
    return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  }

  sourceFile.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      pushSymbol(node, node.name.text, 'function', isExported(node))
    } else if (ts.isClassDeclaration(node) && node.name) {
      pushSymbol(node, node.name.text, 'class', isExported(node))
    } else if (ts.isInterfaceDeclaration(node)) {
      pushSymbol(node, node.name.text, 'interface', isExported(node))
    } else if (ts.isTypeAliasDeclaration(node)) {
      pushSymbol(node, node.name.text, 'type', isExported(node))
    } else if (ts.isEnumDeclaration(node)) {
      pushSymbol(node, node.name.text, 'enum', isExported(node))
    } else if (ts.isVariableStatement(node)) {
      const exported = isExported(node)
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          pushSymbol(node, decl.name.text, 'var', exported)
        }
      }
    }
  })

  return symbols
}

function isCodeFile(relPath: string): boolean {
  return /\.(ts|tsx|js|jsx|py|go)$/.test(relPath)
}

function isTextFile(relPath: string): boolean {
  return /\.(ts|tsx|js|jsx|json|md|txt|css|scss|html|yml|yaml|py|go)$/.test(relPath)
}

function findSymbolsInPythonFile(relPath: string, text: string): FlowPatchSymbol[] {
  const symbols: FlowPatchSymbol[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s/.test(line)) continue
    const def = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line)
    if (def) {
      symbols.push({
        id: stableId(`${relPath}:function:${def[1]}:${i + 1}`),
        name: def[1],
        kind: 'function',
        path: relPath,
        line: i + 1,
        exported: true
      })
      continue
    }
    const cls = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line)
    if (cls) {
      symbols.push({
        id: stableId(`${relPath}:class:${cls[1]}:${i + 1}`),
        name: cls[1],
        kind: 'class',
        path: relPath,
        line: i + 1,
        exported: true
      })
    }
  }
  return symbols
}

function findSymbolsInGoFile(relPath: string, text: string): FlowPatchSymbol[] {
  const symbols: FlowPatchSymbol[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fn = /^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line)
    if (fn) {
      symbols.push({
        id: stableId(`${relPath}:function:${fn[1]}:${i + 1}`),
        name: fn[1],
        kind: 'function',
        path: relPath,
        line: i + 1,
        exported: /^[A-Z]/.test(fn[1])
      })
      continue
    }
    const typ = /^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(line)
    if (typ) {
      symbols.push({
        id: stableId(`${relPath}:type:${typ[1]}:${i + 1}`),
        name: typ[1],
        kind: 'type',
        path: relPath,
        line: i + 1,
        exported: /^[A-Z]/.test(typ[1])
      })
    }
  }
  return symbols
}

export async function buildIndex(
  repoRoot: string,
  opts?: { isCanceled?: () => boolean }
): Promise<{
  meta: FlowPatchIndexMeta
  files: FlowPatchFileIndexEntry[]
  symbols: FlowPatchSymbol[]
  chunks: FlowPatchChunk[]
  blocked: { path: string; reason: string }[]
}> {
  const assertNotCanceled = (): void => {
    if (opts?.isCanceled?.()) throw new IndexCanceledError()
  }

  const { indexDir, fileIndexPath, metaPath, symbolsPath, chunksPath } = getIndexPaths(repoRoot)
  if (!existsSync(indexDir)) {
    throw new Error('Missing .flowpatch/state/index directory')
  }

  const lockPath = join(repoRoot, '.flowpatch', 'state', 'locks', 'index.lock')
  let lockFd: number | null = null
  try {
    try {
      lockFd = openSync(lockPath, 'wx')
      writeFileSync(lockFd, `${process.pid} ${new Date().toISOString()}`, { encoding: 'utf-8' })
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && (e as any).code === 'EEXIST') {
        throw new Error('Index is already running')
      }
      throw e
    }

    assertNotCanceled()

    const { config } = readFlowPatchConfig(repoRoot)
    const privacy = buildEffectivePrivacyPolicy(config.privacy)

    assertNotCanceled()

    const prevByPath = loadPreviousFileIndex(repoRoot)
    const cache = loadCache(repoRoot)
    const workspaces = config.workspaces?.length ? config.workspaces : ['.']
    let excluded = 0
    const entries: FlowPatchFileIndexEntry[] = []
    for (const ws of workspaces) {
      assertNotCanceled()
      const wsRoot = ws === '.' ? repoRoot : join(repoRoot, ws)
      const prefix = ws === '.' ? '' : ws
      const res = scanFiles(wsRoot, wsRoot, prefix, { isCanceled: opts?.isCanceled })
      excluded += res.excluded
      entries.push(...res.entries)
    }
    const blocked: { path: string; reason: string }[] = []

    const files: FlowPatchFileIndexEntry[] = []
    const chunks: FlowPatchChunk[] = []
    const symbols: FlowPatchSymbol[] = []

    for (const entry of entries) {
      assertNotCanceled()
      const decision = decidePathPrivacy(privacy, entry.path)
      if (!decision.allowed) {
        blocked.push({ path: entry.path, reason: decision.reason })
        continue
      }

      const prev = prevByPath.get(entry.path)
      const maybePrevHash = prev?.hash

      let text: string | null = null
      const absPath = join(repoRoot, entry.path)
      if (isTextFile(entry.path)) {
        text = readUtf8IfText(absPath, 1_000_000)
        if (text != null) entry.hash = sha1Text(text)
      }
      const hash = entry.hash ?? maybePrevHash ?? null
      const unchanged = !!hash && hash === maybePrevHash
      if (hash && unchanged) {
        const cached = cache.get(entry.path)
        if (cached && cached.hash === hash) {
          chunks.push(...cached.chunks)
          symbols.push(...cached.symbols)
        }
      }

      files.push(entry)

      if (
        text != null &&
        hash &&
        (!unchanged || !cache.get(entry.path) || cache.get(entry.path)!.hash !== hash)
      ) {
        assertNotCanceled()
        const fileChunks = buildChunksForFile(entry.path, text, { maxLines: 80, maxChars: 4000 })
        let fileSymbols: FlowPatchSymbol[] = []
        if (isCodeFile(entry.path)) {
          if (/\.(ts|tsx|js|jsx)$/.test(entry.path))
            fileSymbols = findSymbolsInTsFile(entry.path, text)
          else if (/\.py$/.test(entry.path)) fileSymbols = findSymbolsInPythonFile(entry.path, text)
          else if (/\.go$/.test(entry.path)) fileSymbols = findSymbolsInGoFile(entry.path, text)
        }
        cache.set(entry.path, { hash, chunks: fileChunks, symbols: fileSymbols })
        chunks.push(...fileChunks)
        symbols.push(...fileSymbols)
      }
    }

    // Drop cache entries for removed files.
    const present = new Set(files.map((f) => f.path))
    for (const k of cache.keys()) {
      if (!present.has(k)) cache.delete(k)
    }

    const headSha = await getHeadSha(repoRoot)
    const now = new Date().toISOString()
    const meta: FlowPatchIndexMeta = {
      schemaVersion: 1,
      generatedBy: 'flowpatch-indexer',
      lastIndexedAt: now,
      lastIndexedSha: headSha,
      totalFiles: files.length,
      excludedFiles: excluded,
      blockedFiles: blocked.length,
      chunks: chunks.length,
      symbols: symbols.length,
      semantic: {
        enabled: true,
        chunksIndexed: 0
      }
    }

    // Lockfile fingerprint for staleness warnings.
    const lockfileCandidates = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
    const lockfilePath = lockfileCandidates.find((p) => existsSync(join(repoRoot, p)))
    if (lockfilePath) {
      const lockText = readUtf8IfText(join(repoRoot, lockfilePath), 5_000_000)
      if (lockText != null) {
        meta.lockfile = { path: lockfilePath, sha1: sha1Text(lockText) }
      }
    }

    writeJson(fileIndexPath, { files })
    writeJson(metaPath, meta)
    writeJson(symbolsPath, { symbols })
    writeJsonl(chunksPath, chunks)
    saveCache(repoRoot, cache)

    // Local semantic index (SQLite FTS5). Always enabled; no network required.
    try {
      assertNotCanceled()
      buildSemanticIndex(repoRoot, chunks)
      meta.semantic.chunksIndexed = chunks.length
    } catch (e) {
      if (e instanceof IndexCanceledError) throw e
      meta.semantic.enabled = false
      meta.semantic.error = e instanceof Error ? e.message : String(e)
    }

    // Rewrite meta if semantic changed.
    writeJson(metaPath, meta)

    return { meta, files, symbols, chunks, blocked }
  } finally {
    try {
      if (lockFd != null) closeSync(lockFd)
    } catch {
      // ignore
    }
    try {
      if (lockFd != null) unlinkSync(lockPath)
    } catch {
      // ignore
    }
  }
}

export async function getIndexStatus(repoRoot: string): Promise<FlowPatchIndexStatus> {
  const { fileIndexPath, metaPath } = getIndexPaths(repoRoot)
  const headSha = await getHeadSha(repoRoot)
  if (!existsSync(fileIndexPath) || !existsSync(metaPath)) {
    return { state: 'missing', headSha, lastIndexedSha: null, lastIndexedAt: null, warnings: [] }
  }
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as FlowPatchIndexMeta
    const lastIndexedSha = meta.lastIndexedSha ?? null
    const stale = headSha && lastIndexedSha && headSha !== lastIndexedSha
    const warnings: string[] = []

    // Lockfile change warning
    const lockfileCandidates = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
    const currentLockfile = lockfileCandidates.find((p) => existsSync(join(repoRoot, p)))
    if (currentLockfile && meta.lockfile?.path === currentLockfile) {
      try {
        const currentText = readUtf8IfText(join(repoRoot, currentLockfile), 5_000_000)
        const currentSha = currentText ? sha1Text(currentText) : null
        if (currentSha && meta.lockfile.sha1 && currentSha !== meta.lockfile.sha1) {
          warnings.push('Lockfile changed since last index')
        }
      } catch {
        // ignore
      }
    } else if (currentLockfile && !meta.lockfile) {
      warnings.push('Index meta missing lockfile fingerprint')
    }

    return {
      state: stale ? 'stale' : 'ready',
      headSha,
      lastIndexedSha,
      lastIndexedAt: meta.lastIndexedAt ?? null,
      warnings
    }
  } catch {
    return { state: 'missing', headSha, lastIndexedSha: null, lastIndexedAt: null, warnings: [] }
  }
}
