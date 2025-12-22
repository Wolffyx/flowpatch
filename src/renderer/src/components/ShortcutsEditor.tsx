import { useMemo, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { cn } from '../lib/utils'
import {
  acceleratorToDisplay,
  buildAcceleratorFromKeyEvent,
  detectPlatform,
  type Platform
} from '@shared/accelerator'
import type { ShortcutBinding, ShortcutCommandId } from '@shared/shortcuts'

interface ShortcutsEditorProps {
  bindings: ShortcutBinding[]
  onPatch: (patch: Record<string, string | null>) => Promise<void>
  className?: string
}

export function ShortcutsEditor({ bindings, onPatch, className }: ShortcutsEditorProps): React.JSX.Element {
  const platform: Platform = useMemo(() => detectPlatform(), [])
  const [editingId, setEditingId] = useState<ShortcutCommandId | null>(null)
  const [savingId, setSavingId] = useState<ShortcutCommandId | null>(null)
  const [errorById, setErrorById] = useState<Record<string, string>>({})

  const save = async (patch: Record<string, string | null>, idForError: ShortcutCommandId): Promise<void> => {
    setSavingId(idForError)
    setErrorById((prev) => {
      const next = { ...prev }
      delete next[idForError]
      return next
    })
    try {
      await onPatch(patch)
    } catch (err) {
      setErrorById((prev) => ({
        ...prev,
        [idForError]: err instanceof Error ? err.message : 'Failed to update shortcut'
      }))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="text-xs text-muted-foreground">
        Click a shortcut and press a new key combination.
      </div>

      <div className="divide-y rounded-lg border">
        {bindings.map((binding) => {
          const effective = acceleratorToDisplay(binding.effectiveAccelerator, platform)
          const defaultValue = acceleratorToDisplay(binding.defaultAccelerator, platform)
          const isCustom = binding.userAccelerator !== null
          const isEditing = editingId === binding.id
          const isSaving = savingId === binding.id
          const error = errorById[binding.id]

          return (
            <div key={binding.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{binding.label}</div>
                  {binding.description && (
                    <div className="text-xs text-muted-foreground">{binding.description}</div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    Default: <span className="font-mono">{defaultValue}</span>
                    {isCustom && (
                      <>
                        {' '}
                        • Custom: <span className="font-mono">{effective}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  {isEditing ? (
                    <Input
                      autoFocus
                      readOnly
                      className="w-44 font-mono text-xs"
                      placeholder="Press keys…"
                      onBlur={() => setEditingId(null)}
                      onKeyDown={async (e) => {
                        e.preventDefault()
                        e.stopPropagation()

                        if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                          setEditingId(null)
                          return
                        }

                        const accel = buildAcceleratorFromKeyEvent(e, platform)
                        if (!accel) return

                        await save({ [binding.id]: accel }, binding.id)
                        setEditingId(null)
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-7 items-center rounded border bg-muted px-2 font-mono text-xs text-muted-foreground',
                        'hover:text-foreground hover:border-muted-foreground/50'
                      )}
                      onClick={() => setEditingId(binding.id)}
                      disabled={isSaving}
                      title="Click to change"
                    >
                      {effective}
                    </button>
                  )}

                  {isCustom && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSaving}
                      onClick={() => save({ [binding.id]: null }, binding.id)}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>

              {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

