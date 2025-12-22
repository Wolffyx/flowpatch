import { useMemo, useState, useEffect, useRef } from 'react'
import {
  FolderOpen,
  RefreshCw,
  Play,
  Plus,
  Search
} from 'lucide-react'
import { Dialog, DialogContent } from './ui/dialog'
import { Input } from './ui/input'
import { cn } from '../lib/utils'
import { acceleratorToDisplay, detectPlatform } from '@shared/accelerator'
import { SHORTCUT_COMMANDS, type ShortcutCommandId } from '@shared/shortcuts'

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  shortcutId?: ShortcutCommandId
  action: () => void
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hasProject: boolean
  onOpenRepo: () => void
  onSync: () => void
  onRunWorker: () => void
  onAddCard: () => void
  shortcuts?: Partial<Record<ShortcutCommandId, string>>
}

export function CommandPalette({
  open,
  onOpenChange,
  hasProject,
  onOpenRepo,
  onSync,
  onRunWorker,
  onAddCard,
  shortcuts
}: CommandPaletteProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const platform = detectPlatform()

  const defaultById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const cmd of SHORTCUT_COMMANDS) map[cmd.id] = cmd.defaultAccelerator
    return map
  }, [])

  const shortcutLabel = (id: ShortcutCommandId | undefined): string | null => {
    if (!id) return null
    const accel = shortcuts?.[id] ?? defaultById[id]
    if (!accel) return null
    return acceleratorToDisplay(accel, platform)
  }

  const commands: CommandItem[] = [
    {
      id: 'open-repo',
      label: 'Open / Create Repository',
      description: 'Open an existing repo or create a new one',
      icon: <FolderOpen className="h-4 w-4" />,
      shortcutId: 'repo.open' as ShortcutCommandId,
      action: () => {
        onOpenRepo()
        onOpenChange(false)
      }
    },
    ...(hasProject
      ? [
          {
            id: 'sync',
            label: 'Sync Now',
            description: 'Sync cards with remote',
            icon: <RefreshCw className="h-4 w-4" />,
            shortcutId: 'sync.now' as ShortcutCommandId,
            action: () => {
              onSync()
              onOpenChange(false)
            }
          },
          {
            id: 'run-worker',
            label: 'Run Worker',
            description: 'Run worker on ready cards',
            icon: <Play className="h-4 w-4" />,
            shortcutId: 'worker.run' as ShortcutCommandId,
            action: () => {
              onRunWorker()
              onOpenChange(false)
            }
          },
          {
            id: 'add-card',
            label: 'Add Card',
            description: 'Create a new local card',
            icon: <Plus className="h-4 w-4" />,
            shortcutId: 'card.add' as ShortcutCommandId,
            action: () => {
              onAddCard()
              onOpenChange(false)
            }
          }
        ]
      : [])
  ]

  const filteredCommands = commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(search.toLowerCase()) ||
      cmd.description?.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    if (open) {
      setSearch('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action()
        }
        break
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-lg">
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {filteredCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Search className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No commands found</p>
            </div>
          ) : (
            filteredCommands.map((cmd, index) => (
              <button
                key={cmd.id}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                  index === selectedIndex && 'bg-accent'
                )}
                onClick={cmd.action}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                  {cmd.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{cmd.label}</p>
                  {cmd.description && (
                    <p className="text-xs text-muted-foreground">{cmd.description}</p>
                  )}
                </div>
                {cmd.shortcutId && shortcutLabel(cmd.shortcutId) && (
                  <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-xs text-muted-foreground">
                    {shortcutLabel(cmd.shortcutId)}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <kbd className="rounded border bg-muted px-1">↑↓</kbd>
            <span>Navigate</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="rounded border bg-muted px-1">↵</kbd>
            <span>Select</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="rounded border bg-muted px-1">Esc</kbd>
            <span>Close</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
