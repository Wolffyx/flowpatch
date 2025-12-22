export type Platform = 'darwin' | 'win32' | 'linux' | 'unknown'

export interface ParsedAccelerator {
  cmdOrCtrl: boolean
  cmd: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

type ModifierKey = Exclude<keyof ParsedAccelerator, 'key'>

const MODIFIER_ALIASES: Record<string, ModifierKey> = {
  cmdorctrl: 'cmdOrCtrl',
  commandorcontrol: 'cmdOrCtrl',
  cmd: 'cmd',
  command: 'cmd',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift'
}

export function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  const raw = (accelerator || '').trim()
  if (!raw) return null

  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null

  const parsed: ParsedAccelerator = {
    cmdOrCtrl: false,
    cmd: false,
    ctrl: false,
    alt: false,
    shift: false,
    key: ''
  }

  for (const part of parts) {
    const normalized = part.toLowerCase().replace(/\s+/g, '')
    const mod = MODIFIER_ALIASES[normalized]
    if (mod) {
      parsed[mod] = true
    } else {
      parsed.key = normalizeKeyToken(part)
    }
  }

  if (!parsed.key) return null
  return parsed
}

export function normalizeAccelerator(accelerator: string): string | null {
  const parsed = parseAccelerator(accelerator)
  if (!parsed) return null

  const parts: string[] = []
  if (parsed.cmdOrCtrl) parts.push('CmdOrCtrl')
  if (parsed.cmd) parts.push('Cmd')
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  parts.push(parsed.key)
  return parts.join('+')
}

export function acceleratorToDisplay(accelerator: string, platform: Platform): string {
  const parsed = parseAccelerator(accelerator)
  if (!parsed) return accelerator

  const parts: string[] = []
  const cmdOrCtrlLabel = platform === 'darwin' ? 'Cmd' : 'Ctrl'
  if (parsed.cmdOrCtrl) parts.push(cmdOrCtrlLabel)
  if (parsed.cmd) parts.push('Cmd')
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push(platform === 'darwin' ? 'Option' : 'Alt')
  if (parsed.shift) parts.push('Shift')
  parts.push(parsed.key)
  return parts.join('+')
}

export function matchAccelerator(
  accelerator: string,
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
): boolean {
  const parsed = parseAccelerator(accelerator)
  if (!parsed) return false

  const eventKey = normalizeKeyToken(event.key)
  if (eventKey !== parsed.key) return false

  if (parsed.shift !== !!event.shiftKey) return false
  if (parsed.alt !== !!event.altKey) return false

  const cmdPressed = !!event.metaKey
  const ctrlPressed = !!event.ctrlKey

  if (parsed.cmdOrCtrl && !(cmdPressed || ctrlPressed)) return false
  if (!parsed.cmdOrCtrl && (cmdPressed || ctrlPressed)) {
    if (parsed.cmd !== cmdPressed) return false
    if (parsed.ctrl !== ctrlPressed) return false
  } else {
    if (parsed.cmd && !cmdPressed) return false
    if (parsed.ctrl && !ctrlPressed) return false
  }

  return true
}

export function isProbablyValidAccelerator(accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator)
  if (!parsed) return false

  const hasAnyModifier = parsed.cmdOrCtrl || parsed.cmd || parsed.ctrl || parsed.alt || parsed.shift
  const key = parsed.key

  const isSingleAlphaNum = /^[A-Z0-9]$/.test(key)
  if (isSingleAlphaNum && !hasAnyModifier) return false

  return true
}

export function buildAcceleratorFromKeyEvent(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform: Platform
): string | null {
  const key = normalizeKeyToken(event.key)
  if (!key) return null

  const isModifierOnly = key === 'Shift' || key === 'Ctrl' || key === 'Alt' || key === 'Cmd'
  if (isModifierOnly) return null

  const parts: string[] = []

  const cmd = !!event.metaKey
  const ctrl = !!event.ctrlKey

  if (cmd || ctrl) {
    parts.push(platform === 'darwin' ? (cmd ? 'CmdOrCtrl' : 'Ctrl') : 'CmdOrCtrl')
  }
  if (!!event.altKey) parts.push('Alt')
  if (!!event.shiftKey) parts.push('Shift')
  parts.push(key)

  return normalizeAccelerator(parts.join('+'))
}

export function detectPlatform(): Platform {
  const p = (typeof process !== 'undefined' && process.platform) || ''
  if (p === 'darwin' || p === 'win32' || p === 'linux') return p

  const nav = (typeof navigator !== 'undefined' && navigator) || null
  const platform = (nav && 'platform' in nav ? String((nav as any).platform) : '').toLowerCase()
  if (platform.includes('mac')) return 'darwin'
  if (platform.includes('win')) return 'win32'
  if (platform.includes('linux')) return 'linux'

  return 'unknown'
}

function normalizeKeyToken(key: string): string {
  const k = (key || '').trim()
  if (!k) return ''

  if (k.length === 1) return k.toUpperCase()

  switch (k) {
    case ' ':
      return 'Space'
    case 'Esc':
      return 'Escape'
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
  }

  const upper = k[0].toUpperCase() + k.slice(1)
  if (/^F\d{1,2}$/i.test(k)) return k.toUpperCase()
  return upper
}
