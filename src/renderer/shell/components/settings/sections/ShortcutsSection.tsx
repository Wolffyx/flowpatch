/**
 * Shortcuts Section
 *
 * Keyboard shortcuts editor
 */

import { useState, useEffect, useCallback } from 'react'
import { Key, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ShortcutsEditor } from '../../../../src/components/ShortcutsEditor'
import type { ShortcutBinding } from '@shared/shortcuts'

export function ShortcutsSection(): React.JSX.Element {
  const [shortcuts, setShortcuts] = useState<ShortcutBinding[]>([])
  const [shortcutsLoading, setShortcutsLoading] = useState(false)

  const supportsShortcuts =
    typeof window.shellAPI.getShortcuts === 'function' &&
    typeof window.shellAPI.setShortcuts === 'function' &&
    typeof window.shellAPI.onShortcutsUpdated === 'function'

  const loadShortcuts = useCallback(async () => {
    if (!supportsShortcuts) return
    setShortcutsLoading(true)
    try {
      const data = await window.shellAPI.getShortcuts()
      setShortcuts(data)
    } catch {
      setShortcuts([])
    } finally {
      setShortcutsLoading(false)
    }
  }, [supportsShortcuts])

  useEffect(() => {
    loadShortcuts()
  }, [loadShortcuts])

  // Subscribe to shortcut updates
  useEffect(() => {
    if (!supportsShortcuts) return
    return window.shellAPI.onShortcutsUpdated(async () => {
      const shortcutsData = await window.shellAPI.getShortcuts()
      setShortcuts(shortcutsData)
    })
  }, [supportsShortcuts])

  const handleShortcutsPatch = useCallback(
    async (patch: Record<string, string | null>) => {
      if (!supportsShortcuts) return
      await window.shellAPI.setShortcuts(patch)
      await loadShortcuts()
      toast.success('Shortcut updated')
    },
    [supportsShortcuts, loadShortcuts]
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Keyboard Shortcuts</h3>
      </div>

      {!supportsShortcuts ? (
        <div className="text-sm text-muted-foreground">
          Shortcuts are not available in this session. Restart the app to load the updated preload.
        </div>
      ) : shortcutsLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading shortcuts...
        </div>
      ) : (
        <ShortcutsEditor bindings={shortcuts} onPatch={handleShortcutsPatch} />
      )}
    </div>
  )
}
