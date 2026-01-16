/**
 * Auto-Updater Hook
 *
 * Manages update state and shows toast notifications for update availability.
 * Provides VS Code-style non-intrusive notifications.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import type { UpdateStatus } from '../interfaces/shell-api'

interface UseAutoUpdaterReturn {
  updateStatus: UpdateStatus
  appVersion: string
  checkForUpdates: () => void
  downloadUpdate: () => void
  installUpdate: () => void
  isChecking: boolean
}

export function useAutoUpdater(): UseAutoUpdaterReturn {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [appVersion, setAppVersion] = useState<string>('')
  const lastNotifiedVersion = useRef<string | null>(null)

  // Load initial state
  useEffect(() => {
    window.shellAPI.getAppVersion().then(setAppVersion)
    window.shellAPI.getUpdateStatus().then(setUpdateStatus)
  }, [])

  // Subscribe to status changes
  useEffect(() => {
    const unsubscribe = window.shellAPI.onUpdateStatusChanged((status) => {
      setUpdateStatus(status)
    })
    return unsubscribe
  }, [])

  // Show toast notifications based on status changes
  useEffect(() => {
    // Update Available - show persistent toast with download action
    if (updateStatus.state === 'available' && updateStatus.version) {
      // Only notify once per version
      if (lastNotifiedVersion.current === updateStatus.version) return
      lastNotifiedVersion.current = updateStatus.version

      toast.info(`Update available: v${updateStatus.version}`, {
        id: 'update-available',
        duration: Infinity,
        description: 'A new version is ready to download.',
        action: {
          label: 'Download',
          onClick: () => {
            toast.dismiss('update-available')
            window.shellAPI.downloadUpdate()
          }
        },
        cancel: {
          label: 'Later',
          onClick: () => toast.dismiss('update-available')
        }
      })
    }

    // Downloading - show progress toast
    if (updateStatus.state === 'downloading' && updateStatus.downloadProgress !== undefined) {
      toast.loading(`Downloading update... ${updateStatus.downloadProgress}%`, {
        id: 'update-downloading',
        duration: Infinity
      })
    }

    // Downloaded - show install toast
    if (updateStatus.state === 'downloaded' && updateStatus.version) {
      toast.dismiss('update-downloading')
      toast.success(`Update v${updateStatus.version} ready to install`, {
        id: 'update-ready',
        duration: Infinity,
        description: 'Restart the app to apply the update.',
        action: {
          label: 'Restart Now',
          onClick: () => {
            toast.dismiss('update-ready')
            window.shellAPI.installUpdate()
          }
        },
        cancel: {
          label: 'Later',
          onClick: () => toast.dismiss('update-ready')
        }
      })
    }

    // Error - show error toast
    if (updateStatus.state === 'error' && updateStatus.error) {
      toast.dismiss('update-downloading')
      toast.error('Update check failed', {
        description: updateStatus.error,
        duration: 5000
      })
    }
  }, [updateStatus])

  const checkForUpdates = useCallback(() => {
    window.shellAPI.checkForUpdates()
  }, [])

  const downloadUpdate = useCallback(() => {
    window.shellAPI.downloadUpdate()
  }, [])

  const installUpdate = useCallback(() => {
    window.shellAPI.installUpdate()
  }, [])

  return {
    updateStatus,
    appVersion,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    isChecking: updateStatus.state === 'checking'
  }
}
