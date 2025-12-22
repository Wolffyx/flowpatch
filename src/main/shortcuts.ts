import { SHORTCUT_COMMANDS, type ShortcutBinding, shortcutSettingKey } from '../shared/shortcuts'
import { isProbablyValidAccelerator, normalizeAccelerator } from '../shared/accelerator'
import { clearDefault, getDefault, setDefault } from './settingsStore'

export interface ShortcutsPatch {
  [commandId: string]: string | null
}

export function getAllShortcuts(): ShortcutBinding[] {
  return SHORTCUT_COMMANDS.map((cmd) => {
    const userValue = getDefault(shortcutSettingKey(cmd.id))
    const effective = userValue ?? cmd.defaultAccelerator
    return {
      id: cmd.id,
      label: cmd.label,
      description: cmd.description,
      defaultAccelerator: cmd.defaultAccelerator,
      userAccelerator: userValue,
      effectiveAccelerator: effective
    }
  })
}

export function setShortcuts(patch: ShortcutsPatch): void {
  const commandsById = new Map(SHORTCUT_COMMANDS.map((c) => [c.id, c]))
  const current = new Map(getAllShortcuts().map((b) => [b.id, b]))

  for (const [id, value] of Object.entries(patch)) {
    const cmd = commandsById.get(id as any)
    if (!cmd) {
      throw new Error(`Unknown shortcut id: ${id}`)
    }

    if (value === null) {
      const binding = current.get(id as any)
      if (binding) {
        binding.userAccelerator = null
        binding.effectiveAccelerator = cmd.defaultAccelerator
      }
      continue
    }

    const normalized = normalizeAccelerator(value)
    if (!normalized || !isProbablyValidAccelerator(normalized)) {
      throw new Error(`Invalid shortcut: ${value}`)
    }

    const binding = current.get(id as any)
    if (binding) {
      binding.userAccelerator = normalized
      binding.effectiveAccelerator = normalized
    }
  }

  const duplicates = findDuplicates(
    Array.from(current.values()).map((b) => ({ id: b.id, accelerator: b.effectiveAccelerator }))
  )
  if (duplicates.length > 0) {
    const first = duplicates[0]
    throw new Error(`Shortcut conflict: ${first.accelerator} is used by ${first.ids.join(', ')}`)
  }

  for (const [id, value] of Object.entries(patch)) {
    if (value === null) {
      clearDefault(shortcutSettingKey(id as any))
      continue
    }
    const normalized = normalizeAccelerator(value)
    if (!normalized) {
      throw new Error(`Invalid shortcut: ${value}`)
    }
    setDefault(shortcutSettingKey(id as any), normalized)
  }
}

function findDuplicates(items: Array<{ id: string; accelerator: string }>): Array<{ accelerator: string; ids: string[] }> {
  const map = new Map<string, string[]>()
  for (const item of items) {
    const key = item.accelerator.trim()
    if (!key) continue
    const list = map.get(key) ?? []
    list.push(item.id)
    map.set(key, list)
  }
  return Array.from(map.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([accelerator, ids]) => ({ accelerator, ids }))
}
