import { ipcRenderer, IpcRendererEvent } from 'electron'

export type Listener = (...args: unknown[]) => void

export function createListener(
  channel: string,
  callback: (...args: unknown[]) => void
): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}
