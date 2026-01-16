/**
 * About Section
 *
 * Displays app version and update information:
 * - Current app version
 * - Check for updates button
 * - Update status messages
 * - Link to GitHub releases for changelog
 */

import { useEffect, useState } from 'react'
import { RefreshCw, ExternalLink, Download, RotateCcw, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '../../../../src/components/ui/button'
import { useAutoUpdater } from '../../../hooks'
import { cn } from '../../../../src/lib/utils'

export function AboutSection(): React.JSX.Element {
  const { updateStatus, appVersion, checkForUpdates, downloadUpdate, installUpdate, isChecking } =
    useAutoUpdater()
  const [hasChecked, setHasChecked] = useState(false)

  // Reset hasChecked when status changes from checking
  useEffect(() => {
    if (updateStatus.state !== 'checking' && updateStatus.state !== 'idle') {
      setHasChecked(true)
    }
  }, [updateStatus.state])

  const handleCheckForUpdates = () => {
    setHasChecked(false)
    checkForUpdates()
  }

  return (
    <div className="space-y-8">
      {/* Version Info */}
      <div>
        <h3 className="text-sm font-medium mb-1">Version</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Current version and update information.
        </p>

        <div className="rounded-lg border bg-card p-4 space-y-4">
          {/* Current Version */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">FlowPatch</p>
              <p className="text-xs text-muted-foreground">Version {appVersion || 'Loading...'}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckForUpdates}
              disabled={isChecking}
              className="gap-2"
            >
              <RefreshCw className={cn('h-4 w-4', isChecking && 'animate-spin')} />
              {isChecking ? 'Checking...' : 'Check for Updates'}
            </Button>
          </div>

          {/* Update Status */}
          {hasChecked && <UpdateStatusDisplay status={updateStatus} onDownload={downloadUpdate} onInstall={installUpdate} />}
        </div>
      </div>

      {/* Links */}
      <div>
        <h3 className="text-sm font-medium mb-1">Resources</h3>
        <p className="text-xs text-muted-foreground mb-4">Helpful links and documentation.</p>

        <div className="space-y-2">
          <a
            href="https://github.com/Wolffyx/flowpatch/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            View Release Notes & Changelog
          </a>
          <a
            href="https://github.com/Wolffyx/flowpatch/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            Report an Issue
          </a>
        </div>
      </div>
    </div>
  )
}

interface UpdateStatusDisplayProps {
  status: {
    state: string
    version?: string
    downloadProgress?: number
    error?: string
  }
  onDownload: () => void
  onInstall: () => void
}

function UpdateStatusDisplay({ status, onDownload, onInstall }: UpdateStatusDisplayProps): React.JSX.Element | null {
  switch (status.state) {
    case 'not-available':
      return (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          You&apos;re up to date!
        </div>
      )

    case 'available':
      return (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
            <Download className="h-4 w-4" />
            Update available: v{status.version}
          </div>
          <Button variant="default" size="sm" onClick={onDownload} className="gap-2">
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>
      )

    case 'downloading':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Downloading update... {status.downloadProgress}%
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${status.downloadProgress || 0}%` }}
            />
          </div>
        </div>
      )

    case 'downloaded':
      return (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            Update v{status.version} ready to install
          </div>
          <Button variant="default" size="sm" onClick={onInstall} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Restart Now
          </Button>
        </div>
      )

    case 'error':
      return (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4" />
          {status.error || 'Update check failed'}
        </div>
      )

    default:
      return null
  }
}
