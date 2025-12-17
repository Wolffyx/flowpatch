export const logAction = (action: string, payload?: unknown): void => {
  const timestamp = new Date().toISOString()
  if (payload !== undefined) {
    console.log(`[Main][${timestamp}] ${action}`, payload)
  } else {
    console.log(`[Main][${timestamp}] ${action}`)
  }
}
