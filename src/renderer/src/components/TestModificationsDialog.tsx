import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Play,
  Square,
  ExternalLink,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { ScrollArea } from './ui/scroll-area'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'
import { toast } from 'sonner'

interface TestInfo {
  success: boolean
  hasWorktree?: boolean
  worktreePath?: string
  branchName?: string | null
  repoPath?: string
  projectType?: { type: string; hasPackageJson: boolean; port?: number }
  commands?: { install?: string; dev?: string; build?: string }
  error?: string
}

interface TestModificationsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  cardId: string
  testInfo: TestInfo | null
}

type ServerStatus = 'not_running' | 'starting' | 'running' | 'stopped' | 'error'

export function TestModificationsDialog({
  open,
  onOpenChange,
  projectId,
  cardId,
  testInfo
}: TestModificationsDialogProps): React.JSX.Element {
  const [serverStatus, setServerStatus] = useState<ServerStatus>('not_running')
  const [port, setPort] = useState<number | undefined>(undefined)
  const [output, setOutput] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(true)
  const [showCommands, setShowCommands] = useState(true)
  const [showLogs, setShowLogs] = useState(false)
  const [followLogs, setFollowLogs] = useState(true)

  const endRef = useRef<HTMLDivElement | null>(null)

  // Load initial status
  useEffect(() => {
    if (!open || !testInfo) return

    const loadStatus = async (): Promise<void> => {
      try {
        const status = await window.projectAPI.getDevServerStatus(cardId)
        if (status.success && status.status) {
          setServerStatus(status.status as ServerStatus)
          setPort(status.port)
          if (status.output) {
            setOutput(status.output)
          }
          if (status.error) {
            setError(status.error)
          }
        }
      } catch (err) {
        console.error('Failed to load dev server status:', err)
      }
    }

    void loadStatus()
  }, [open, cardId, testInfo])

  // Set up event listeners
  useEffect(() => {
    if (!open) return

    const unsubscribeOutput = window.projectAPI.onDevServerOutput((data) => {
      if (data.cardId === cardId) {
        setOutput((prev) => [...prev, data.line])
      }
    })

    const unsubscribeStatus = window.projectAPI.onDevServerStatus((data) => {
      if (data.cardId === cardId) {
        setServerStatus(data.status as ServerStatus)
      }
    })

    const unsubscribePort = window.projectAPI.onDevServerPort((data) => {
      if (data.cardId === cardId) {
        setPort(data.port)
      }
    })

    return () => {
      unsubscribeOutput()
      unsubscribeStatus()
      unsubscribePort()
    }
  }, [open, cardId])

  // Auto-scroll logs
  useEffect(() => {
    if (followLogs && showLogs) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [output, followLogs, showLogs])

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (serverStatus === 'running' || serverStatus === 'starting') {
          handleStop()
        } else {
          handleStart()
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'b' && port) {
        e.preventDefault()
        handleOpenBrowser()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault()
        handleCopyCommands()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, serverStatus, port])

  const handleStart = async (): Promise<void> => {
    if (!testInfo || !testInfo.commands?.dev) {
      toast.error('No dev command available')
      return
    }

    setError(null)
    setServerStatus('starting')
    setOutput([])

    try {
      // Parse command - handle cases like "npm run dev" or "yarn dev"
      const devCommand = testInfo.commands.dev || ''
      const parts = devCommand.trim().split(/\s+/)
      const command = parts[0] || 'npm'
      const args = parts.slice(1)
      const workingDir = testInfo.worktreePath || testInfo.repoPath || ''

      if (!workingDir) {
        throw new Error('No working directory available')
      }

      const result = await window.projectAPI.startDevServer({
        projectId,
        cardId,
        workingDir,
        command,
        args
      })

      if (result.error) {
        setError(result.error)
        setServerStatus('error')
        toast.error(`Failed to start dev server: ${result.error}`)
      } else {
        if (result.port) {
          setPort(result.port)
        }
        toast.success('Dev server starting...')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMsg)
      setServerStatus('error')
      toast.error(`Failed to start dev server: ${errorMsg}`)
    }
  }

  const handleStop = async (): Promise<void> => {
    try {
      await window.projectAPI.stopDevServer(cardId)
      setServerStatus('stopped')
      toast.success('Dev server stopped')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to stop dev server: ${errorMsg}`)
    }
  }

  const handleOpenBrowser = (): void => {
    if (port) {
      window.open(`http://localhost:${port}`, '_blank', 'noopener,noreferrer')
    }
  }

  const handleOpenFolder = async (): Promise<void> => {
    const path = testInfo?.worktreePath || testInfo?.repoPath
    if (path) {
      try {
        await window.electron.ipcRenderer.invoke('openWorktreeFolder', path)
      } catch (err) {
        toast.error('Failed to open folder')
      }
    }
  }

  const handleCopyCommands = async (): Promise<void> => {
    if (!testInfo?.commands) return

    const commands: string[] = []
    const workingDir = testInfo.worktreePath || testInfo.repoPath || ''

    if (testInfo.commands.install) {
      commands.push(`cd "${workingDir}"`)
      commands.push(testInfo.commands.install)
    }
    if (testInfo.commands.dev) {
      if (commands.length === 0) {
        commands.push(`cd "${workingDir}"`)
      }
      commands.push(testInfo.commands.dev)
    }

    const text = commands.join('\n')
    await navigator.clipboard.writeText(text)
    toast.success('Commands copied to clipboard')
  }

  const projectTypeLabel = useMemo(() => {
    const type = testInfo?.projectType?.type
    if (!type) return 'Unknown'
    return type.charAt(0).toUpperCase() + type.slice(1)
  }, [testInfo])

  const statusBadge = useMemo(() => {
    switch (serverStatus) {
      case 'running':
        return <Badge variant="default" className="bg-green-500">Running</Badge>
      case 'starting':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Starting
          </Badge>
        )
      case 'error':
        return <Badge variant="destructive">Error</Badge>
      case 'stopped':
        return <Badge variant="secondary">Stopped</Badge>
      default:
        return <Badge variant="outline">Not Running</Badge>
    }
  }, [serverStatus])

  if (!testInfo) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Modifications</DialogTitle>
          </DialogHeader>
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No test information available</p>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  if (testInfo.error) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Modifications</DialogTitle>
          </DialogHeader>
          <div className="text-center py-8">
            <XCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <p className="text-destructive font-medium mb-2">Error</p>
            <p className="text-sm text-muted-foreground">{testInfo.error}</p>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Test Modifications</DialogTitle>
            {statusBadge}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
          {/* Info Section */}
          <div className="border rounded-lg">
            <button
              type="button"
              onClick={() => setShowInfo(!showInfo)}
              className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
            >
              <span className="font-medium text-sm">Project Information</span>
              {showInfo ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showInfo && (
              <div className="px-3 pb-3 space-y-2 text-sm border-t">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Type:</span>
                  <Badge variant="outline">{projectTypeLabel}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Path:</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">
                    {testInfo.worktreePath || testInfo.repoPath}
                  </code>
                  <Button variant="ghost" size="sm" onClick={handleOpenFolder}>
                    <FolderOpen className="h-3 w-3" />
                  </Button>
                </div>
                {testInfo.branchName && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Branch:</span>
                    <code className="text-xs bg-muted px-2 py-1 rounded">{testInfo.branchName}</code>
                  </div>
                )}
                {port && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Port:</span>
                    <code className="text-xs bg-muted px-2 py-1 rounded">{port}</code>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Commands Section */}
          {testInfo.commands && (
            <div className="border rounded-lg">
              <button
                type="button"
                onClick={() => setShowCommands(!showCommands)}
                className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
              >
                <span className="font-medium text-sm">Commands</span>
                {showCommands ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showCommands && (
                <div className="px-3 pb-3 space-y-2 text-sm border-t">
                  {testInfo.commands.install && (
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-muted-foreground">Install:</span>
                        <code className="ml-2 text-xs bg-muted px-2 py-1 rounded">{testInfo.commands.install}</code>
                      </div>
                    </div>
                  )}
                  {testInfo.commands.dev && (
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-muted-foreground">Dev:</span>
                        <code className="ml-2 text-xs bg-muted px-2 py-1 rounded">{testInfo.commands.dev}</code>
                      </div>
                    </div>
                  )}
                  {testInfo.commands.build && (
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-muted-foreground">Build:</span>
                        <code className="ml-2 text-xs bg-muted px-2 py-1 rounded">{testInfo.commands.build}</code>
                      </div>
                    </div>
                  )}
                  <div className="pt-2">
                    <Button variant="outline" size="sm" onClick={handleCopyCommands}>
                      <Copy className="h-3 w-3 mr-2" />
                      Copy All Commands
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {serverStatus === 'running' || serverStatus === 'starting' ? (
              <Button onClick={handleStop} disabled={serverStatus === 'starting'}>
                <Square className="h-4 w-4 mr-2" />
                Stop Server
              </Button>
            ) : (
              <Button onClick={handleStart} disabled={!testInfo.commands?.dev}>
                <Play className="h-4 w-4 mr-2" />
                Start Server
              </Button>
            )}
            {port && (
              <Button variant="outline" onClick={handleOpenBrowser}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in Browser
              </Button>
            )}
            <Button variant="outline" onClick={handleOpenFolder}>
              <FolderOpen className="h-4 w-4 mr-2" />
              Open Folder
            </Button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">Error</p>
                  <p className="text-xs text-muted-foreground mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Logs Section */}
          <div className="border rounded-lg flex-1 min-h-0 flex flex-col">
            <button
              type="button"
              onClick={() => setShowLogs(!showLogs)}
              className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
            >
              <span className="font-medium text-sm">Server Output</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={followLogs}
                    onChange={(e) => setFollowLogs(e.target.checked)}
                    className="h-3 w-3"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span>Follow</span>
                </div>
                {showLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>
            {showLogs && (
              <ScrollArea className="flex-1 border-t">
                <div className="p-3 font-mono text-xs space-y-1">
                  {output.length === 0 ? (
                    <div className="text-muted-foreground text-center py-8">No output yet</div>
                  ) : (
                    output.map((line, idx) => {
                      const isError = line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')
                      return (
                        <div
                          key={idx}
                          className={cn(
                            'px-2 py-1 rounded',
                            isError ? 'bg-destructive/10 text-destructive' : 'hover:bg-muted/50'
                          )}
                        >
                          {line}
                        </div>
                      )
                    })
                  )}
                  <div ref={endRef} />
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
