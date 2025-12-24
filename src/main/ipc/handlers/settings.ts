/**
 * IPC handlers for settings operations.
 * Handles: theme preferences, API keys, CLI agent checks
 */

import { ipcMain, nativeTheme } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getAppSetting, setAppSetting } from '../../db'
import { sendToAllTabs } from '../../tabManager'

const execFileAsync = promisify(execFile)

// ============================================================================
// Handler Registration
// ============================================================================

export function registerSettingsHandlers(): void {
  // Theme preference handlers (global app settings)
  ipcMain.handle('getThemePreference', () => {
    const saved = getAppSetting('theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved
    }
    return 'system' // Default to system
  })

  ipcMain.handle('setThemePreference', (_e, theme: string) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') {
      return { error: 'Invalid theme preference' }
    }
    setAppSetting('theme', theme)

    // Broadcast theme change to all project tabs
    // Resolve the theme if it's 'system'
    const resolvedTheme =
      theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme
    sendToAllTabs('themeChanged', { preference: theme, resolved: resolvedTheme })

    return { success: true }
  })

  ipcMain.handle('getSystemTheme', () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })

  // API Key handlers (global app settings)
  ipcMain.handle('getApiKey', (_e, payload: { key: string }) => {
    if (!payload?.key) return null
    const settingKey = `api_key_${payload.key}`
    return getAppSetting(settingKey) || null
  })

  ipcMain.handle('setApiKey', (_e, payload: { key: string; value: string }) => {
    if (!payload?.key) return { error: 'Invalid key' }
    const settingKey = `api_key_${payload.key}`
    setAppSetting(settingKey, payload.value || '')
    return { success: true }
  })

  // CLI Agent Check
  ipcMain.handle('checkCliAgents', async () => {
    const isFirstCheck = getAppSetting('startup_agent_check_completed') !== '1'

    const checkCommand = async (cmd: string): Promise<boolean> => {
      try {
        if (process.platform === 'win32') {
          await execFileAsync('where', [cmd])
        } else {
          await execFileAsync('which', [cmd])
        }
        return true
      } catch {
        return false
      }
    }

    const [claude, codex] = await Promise.all([checkCommand('claude'), checkCommand('codex')])

    const anyAvailable = claude || codex

    // Mark completed only if an agent is found on first check
    if (anyAvailable && isFirstCheck) {
      setAppSetting('startup_agent_check_completed', '1')
    }

    return { claude, codex, anyAvailable, isFirstCheck }
  })
}
