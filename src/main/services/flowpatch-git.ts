import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function gitDiffNameOnly(repoRoot: string): Promise<string[]> {
  try {
    const [a, b] = await Promise.all([
      execFileAsync('git', ['diff', '--name-only'], { cwd: repoRoot }),
      execFileAsync('git', ['diff', '--name-only', '--cached'], { cwd: repoRoot })
    ])
    const files = new Set<string>()
    for (const out of [a.stdout, b.stdout]) {
      for (const line of (out || '').split(/\r?\n/)) {
        const p = line.trim()
        if (p) files.add(p.replace(/\\/g, '/'))
      }
    }
    return [...files]
  } catch {
    return []
  }
}

export async function gitHeadSha(repoRoot: string): Promise<string | null> {
  try {
    const res = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
    const sha = (res.stdout || '').trim()
    return sha || null
  } catch {
    return null
  }
}
