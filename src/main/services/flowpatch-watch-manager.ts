import { watch, type FSWatcher } from 'fs'

interface WatchState {
  watcher: FSWatcher
  debounceTimer: NodeJS.Timeout | null
  lastTriggerAt: number
}

const watchers = new Map<string, WatchState>() // repoRoot -> state

export function isIndexWatchEnabled(repoRoot: string): boolean {
  return watchers.has(repoRoot)
}

export function stopIndexWatch(repoRoot: string): void {
  const state = watchers.get(repoRoot)
  if (!state) return
  if (state.debounceTimer) clearTimeout(state.debounceTimer)
  state.watcher.close()
  watchers.delete(repoRoot)
}

export function startIndexWatch(
  repoRoot: string,
  onDebouncedChange: () => void,
  opts?: { debounceMs?: number; minIntervalMs?: number }
): void {
  const debounceMs = opts?.debounceMs ?? 800
  const minIntervalMs = opts?.minIntervalMs ?? 10_000

  stopIndexWatch(repoRoot)

  const watcher = watch(repoRoot, { recursive: true }, () => {
    const state = watchers.get(repoRoot)
    if (!state) return

    const now = Date.now()
    if (now - state.lastTriggerAt < minIntervalMs) return

    if (state.debounceTimer) clearTimeout(state.debounceTimer)
    state.debounceTimer = setTimeout(() => {
      const current = watchers.get(repoRoot)
      if (!current) return
      current.lastTriggerAt = Date.now()
      onDebouncedChange()
    }, debounceMs)
  })

  watchers.set(repoRoot, { watcher, debounceTimer: null, lastTriggerAt: 0 })
}
