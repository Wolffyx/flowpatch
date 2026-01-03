/**
 * IPC handlers for AI-assisted drafting.
 * Handles: generateCardDescription, generateCardList
 */

import { ipcMain } from 'electron'
import { execFileSync, spawn } from 'child_process'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getProject } from '../../db'

type DraftToolPreference = 'auto' | 'claude' | 'codex'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function buildDraftPrompt(title: string, messages: ChatMessage[]): string {
  const transcript = messages
    .slice(-20)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.content}\n`)
    .join('\n')

  return [
    'You help draft high-quality GitHub issue descriptions in Markdown.',
    '',
    'Work in plan mode:',
    '- Ask up to 3 clarifying questions if needed.',
    '- Propose a concise outline/plan for the issue description.',
    '- Then provide a final issue description under a heading: "## Final Description".',
    '',
    'Constraints:',
    '- Do not use any external tools or run any commands.',
    '- Prefer concrete acceptance criteria and reproduction steps when relevant.',
    '',
    `Issue title: ${title || '(untitled)'}`,
    '',
    'Conversation so far:',
    transcript || '(none)',
    '',
    'Now respond.'
  ].join('\n')
}

function buildCardListPrompt(description: string, count: number): string {
  return [
    'You generate an initial list of Kanban cards for a software project.',
    '',
    `Generate exactly ${count} cards based on the app description.`,
    '',
    'Output requirements (follow exactly):',
    '- Output ONLY valid JSON (no code fences, no markdown outside JSON).',
    '- Output a JSON array of objects. Each object must have:',
    '  - "title": string',
    '  - "body": string (Markdown allowed inside this string)',
    '- Keep titles short and action-oriented.',
    '- Bodies should include brief context plus a small checklist of acceptance criteria when appropriate.',
    '',
    'App description:',
    description.trim(),
    ''
  ].join('\n')
}

function extractLikelyJson(raw: string): string {
  const text = raw.trim()
  if (!text) return ''

  // Fast path: already JSON
  if (text.startsWith('[') && text.endsWith(']')) return text

  // Strip ```json fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()

  // Best-effort: find the first array-shaped substring
  const first = text.indexOf('[')
  const last = text.lastIndexOf(']')
  if (first >= 0 && last > first) return text.slice(first, last + 1).trim()

  return text
}

function parseCardListJson(raw: string, expectedCount: number): Array<{ title: string; body: string }> {
  const extracted = extractLikelyJson(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(extracted)
  } catch (err) {
    throw new Error(`Failed to parse JSON card list: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!Array.isArray(parsed)) throw new Error('Card list JSON must be an array')

  const cards = parsed.map((item, idx) => {
    if (!item || typeof item !== 'object') throw new Error(`Card ${idx + 1} must be an object`)
    const title = (item as { title?: unknown }).title
    const body = (item as { body?: unknown }).body
    if (typeof title !== 'string' || !title.trim()) throw new Error(`Card ${idx + 1} missing valid "title"`)
    if (typeof body !== 'string') throw new Error(`Card ${idx + 1} missing valid "body"`)
    return { title: title.trim(), body: body.trim() }
  })

  if (cards.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} cards, got ${cards.length}`)
  }

  return cards
}

async function checkCommand(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      stdio: 'ignore'
    })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

function resolveWindowsSpawnCommand(command: string): string {
  if (command.includes('\\') || command.includes('/') || /\.[A-Za-z0-9]+$/.test(command)) return command

  try {
    const raw = execFileSync('where', [command], { encoding: 'utf-8', windowsHide: true })
    const matches = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!matches.length) return command

    const preferredExts = ['.exe', '.cmd', '.bat', '.com']
    for (const ext of preferredExts) {
      const hit = matches.find((m) => m.toLowerCase().endsWith(ext))
      if (hit) return hit
    }
    return matches[0]
  } catch {
    return command
  }
}

async function runClaudePlan(prompt: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['--print', '--output-format', 'text', '--permission-mode', 'plan', '--tools', ''],
      {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'cli' }
      }
    )

    let stdout = ''
    let stderr = ''

    try {
      child.stdin.write(prompt)
      child.stdin.end()
    } catch {
      // ignore
    }

    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      reject(new Error(`Claude timed out after ${Math.ceil(timeoutMs / 1000)}s`))
    }, timeoutMs)

    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`))
        return
      }
      resolve(stdout.trim())
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function runCodexPlan(prompt: string, cwd: string, timeoutMs: number): Promise<string> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'patchwork-ai-'))
  const lastMessagePath = join(tmpRoot, 'codex-last-message.txt')

  try {
    await new Promise<void>((resolve, reject) => {
      const codexCommand =
        process.platform === 'win32' ? resolveWindowsSpawnCommand('codex') : 'codex'
      const child = spawn(
        codexCommand,
        [
          'exec',
          '--sandbox',
          'read-only',
          '--skip-git-repo-check',
          '--color',
          'never',
          '--output-last-message',
          lastMessagePath,
          '-'
        ],
        { cwd, stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env } }
      )

      try {
        child.stdin.write(prompt)
        child.stdin.end()
      } catch {
        // ignore
      }

      let stderr = ''
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore
        }
        reject(new Error(`Codex timed out after ${Math.ceil(timeoutMs / 1000)}s`))
      }, timeoutMs)

      child.stderr.on('data', (d) => {
        stderr += d.toString()
      })

      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code !== 0) {
          reject(new Error(`Codex exited with code ${code}: ${stderr}`))
          return
        }
        resolve()
      })

      child.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    const output = await readFile(lastMessagePath, 'utf-8')
    return output.trim()
  } finally {
    try {
      await rm(tmpRoot, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

export function registerAIHandlers(): void {
  ipcMain.handle(
    'generateCardDescription',
    async (
      _e,
      payload: {
        projectId: string
        title: string
        toolPreference?: DraftToolPreference
        messages?: ChatMessage[]
      }
    ) => {
      try {
        const project = getProject(payload.projectId)
        if (!project) return { error: 'Project not found' }

        const toolPreference: DraftToolPreference = payload.toolPreference || 'auto'
        const messages = Array.isArray(payload.messages) ? payload.messages : []

        const [hasClaude, hasCodex] = await Promise.all([
          checkCommand('claude'),
          checkCommand('codex')
        ])
        if (!hasClaude && !hasCodex) return { error: 'No CLI agent available (claude or codex)' }

        let tool: 'claude' | 'codex' | null = null
        if (toolPreference === 'claude' && hasClaude) tool = 'claude'
        else if (toolPreference === 'codex' && hasCodex) tool = 'codex'
        else if (toolPreference === 'auto') tool = hasClaude ? 'claude' : hasCodex ? 'codex' : null
        if (!tool) return { error: `Selected tool not available: ${toolPreference}` }

        const prompt = buildDraftPrompt(payload.title, messages)
        const timeoutMs = 90_000

        if (tool === 'claude') {
          const response = await runClaudePlan(prompt, project.local_path, timeoutMs)
          return { success: true, toolUsed: tool, response }
        }

        const response = await runCodexPlan(prompt, project.local_path, timeoutMs)
        return { success: true, toolUsed: tool, response }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(
    'generateCardList',
    async (
      _e,
      payload: {
        projectId: string
        description: string
        count: number
        toolPreference?: DraftToolPreference
      }
    ) => {
      try {
        const project = getProject(payload.projectId)
        if (!project) return { error: 'Project not found' }

        const description = (payload.description || '').trim()
        if (!description) return { error: 'Description is required' }

        const requested = Number.isFinite(payload.count) ? Math.floor(payload.count) : 0
        const count = Math.min(15, Math.max(1, requested))

        const toolPreference: DraftToolPreference = payload.toolPreference || 'auto'

        const [hasClaude, hasCodex] = await Promise.all([
          checkCommand('claude'),
          checkCommand('codex')
        ])
        if (!hasClaude && !hasCodex) return { error: 'No CLI agent available (claude or codex)' }

        let tool: 'claude' | 'codex' | null = null
        if (toolPreference === 'claude' && hasClaude) tool = 'claude'
        else if (toolPreference === 'codex' && hasCodex) tool = 'codex'
        else if (toolPreference === 'auto') tool = hasClaude ? 'claude' : hasCodex ? 'codex' : null
        if (!tool) return { error: `Selected tool not available: ${toolPreference}` }

        const prompt = buildCardListPrompt(description, count)
        const timeoutMs = 120_000

        const raw =
          tool === 'claude'
            ? await runClaudePlan(prompt, project.local_path, timeoutMs)
            : await runCodexPlan(prompt, project.local_path, timeoutMs)

        const cards = parseCardListJson(raw, count)
        return { success: true, toolUsed: tool, cards }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
}
