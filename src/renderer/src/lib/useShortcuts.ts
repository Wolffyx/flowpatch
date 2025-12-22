import { useEffect, useMemo, useState } from 'react'
import type { ShortcutBinding, ShortcutCommandId } from '@shared/shortcuts'

export interface ShortcutState {
  bindings: ShortcutBinding[]
  byId: Partial<Record<ShortcutCommandId, string>>
  loading: boolean
  reload: () => Promise<void>
}

export function useShortcuts(): ShortcutState {
  const [bindings, setBindings] = useState<ShortcutBinding[]>([])
  const [loading, setLoading] = useState(false)

  const reload = async (): Promise<void> => {
    setLoading(true)
    try {
      const data = (await window.electron.ipcRenderer.invoke('shortcuts:getAll')) as ShortcutBinding[]
      setBindings(data)
    } catch {
      setBindings([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    const handler = () => void reload()
    window.electron.ipcRenderer.on('shortcutsUpdated', handler)
    return () => {
      window.electron.ipcRenderer.removeListener('shortcutsUpdated', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const byId = useMemo(() => {
    const map: Partial<Record<ShortcutCommandId, string>> = {}
    for (const b of bindings) {
      map[b.id] = b.effectiveAccelerator
    }
    return map
  }, [bindings])

  return { bindings, byId, loading, reload }
}

