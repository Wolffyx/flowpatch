export type ShortcutCommandId =
  | 'commandPalette.open'
  | 'repo.open'
  | 'sync.now'
  | 'worker.run'
  | 'card.add'
  | 'ui.escape'

export interface ShortcutCommand {
  id: ShortcutCommandId
  label: string
  description?: string
  defaultAccelerator: string
}

export interface ShortcutBinding {
  id: ShortcutCommandId
  label: string
  description?: string
  defaultAccelerator: string
  userAccelerator: string | null
  effectiveAccelerator: string
}

export const SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
  {
    id: 'commandPalette.open',
    label: 'Open Command Palette',
    description: 'Open the command palette',
    defaultAccelerator: 'CmdOrCtrl+K'
  },
  {
    id: 'repo.open',
    label: 'Open / Create Repository',
    description: 'Open an existing repo or create a new one',
    defaultAccelerator: 'CmdOrCtrl+O'
  },
  {
    id: 'sync.now',
    label: 'Sync Now',
    description: 'Sync cards with remote',
    defaultAccelerator: 'CmdOrCtrl+S'
  },
  {
    id: 'worker.run',
    label: 'Run Worker',
    description: 'Run worker on ready cards',
    defaultAccelerator: 'CmdOrCtrl+R'
  },
  {
    id: 'card.add',
    label: 'Add Card',
    description: 'Create a new local card',
    defaultAccelerator: 'CmdOrCtrl+N'
  },
  {
    id: 'ui.escape',
    label: 'Escape / Close',
    description: 'Close dialogs or exit selection',
    defaultAccelerator: 'Escape'
  }
] as const

export function shortcutSettingKey(id: ShortcutCommandId): string {
  return `shortcuts.${id}`
}

