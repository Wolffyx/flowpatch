import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Loader2, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'

export interface StartupCheckDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCheckComplete: () => void
}

interface CheckResult {
  claude: boolean
  codex: boolean
  anyAvailable: boolean
  isFirstCheck: boolean
}

export function StartupCheckDialog({
  open,
  onOpenChange,
  onCheckComplete
}: StartupCheckDialogProps): React.JSX.Element {
  const [isChecking, setIsChecking] = useState(true)
  const [claudeAvailable, setClaudeAvailable] = useState(false)
  const [codexAvailable, setCodexAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    setIsChecking(true)
    setError(null)
    try {
      const result: CheckResult = await window.electron.ipcRenderer.invoke('checkCliAgents')
      setClaudeAvailable(result.claude)
      setCodexAvailable(result.codex)
      if (result.anyAvailable) {
        onCheckComplete()
        onOpenChange(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for CLI agents')
    } finally {
      setIsChecking(false)
    }
  }, [onCheckComplete, onOpenChange])

  useEffect(() => {
    if (open) {
      runCheck()
    }
  }, [open, runCheck])

  const openExternal = useCallback((url: string) => {
    window.electron.ipcRenderer.send('openExternal', url)
  }, [])

  const anyAvailable = claudeAvailable || codexAvailable

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>CLI Agent Required</DialogTitle>
          <DialogDescription>
            FlowPatch requires Claude CLI or Codex CLI to be installed for the worker to function.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {isChecking ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Checking for installed CLI agents...</span>
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  {claudeAvailable ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span>Claude CLI</span>
                </div>
                <div className="flex items-center gap-2">
                  {codexAvailable ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span>Codex CLI</span>
                </div>
              </div>

              {!anyAvailable && (
                <div className="rounded-lg border p-4 space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Please install at least one CLI agent to continue:
                  </p>

                  <div className="space-y-2">
                    <h4 className="font-medium">Claude CLI</h4>
                    <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                      npm install -g @anthropic-ai/claude-code
                    </pre>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => openExternal('https://docs.anthropic.com/en/docs/claude-code')}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      Documentation
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-medium">Codex CLI (OpenAI)</h4>
                    <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                      npm install -g @openai/codex
                    </pre>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => openExternal('https://github.com/openai/codex')}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      Documentation
                    </Button>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button onClick={runCheck} disabled={isChecking}>
            {isChecking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              'Re-check'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
