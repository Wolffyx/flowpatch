import { useCallback, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { ScrollArea } from './ui/scroll-area'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'

type ToolPreference = 'auto' | 'claude' | 'codex'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

interface AIDescriptionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  title: string
  currentDescription: string
  onApplyDescription: (description: string) => void
}

function extractFinalDescription(raw: string): string {
  const text = raw.trim()
  if (!text) return ''

  const markers = [
    /^##\s*Final Description\s*$/im,
    /^Final Description\s*:\s*$/im,
    /^FINAL\s*:\s*$/im
  ]

  for (const marker of markers) {
    const match = text.match(marker)
    if (!match || match.index == null) continue
    const after = text.slice(match.index + match[0].length).trim()
    if (after) return after
  }

  return text
}

export function AIDescriptionDialog({
  open,
  onOpenChange,
  projectId,
  title,
  currentDescription,
  onApplyDescription
}: AIDescriptionDialogProps): React.JSX.Element {
  const [toolPreference, setToolPreference] = useState<ToolPreference>('auto')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lastAssistantMessage = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant')
    return last?.content || ''
  }, [messages])

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = input.trim()
    if (!trimmed || isRunning) return

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    setInput('')
    setIsRunning(true)
    setError(null)

    try {
      const result = (await window.electron.ipcRenderer.invoke('generateCardDescription', {
        projectId,
        title,
        toolPreference,
        messages: nextMessages
      })) as { success?: boolean; response?: string; error?: string }

      if (result?.error) throw new Error(result.error)

      const response = (result?.response || '').trim()
      if (!response) throw new Error('No response from agent')

      setMessages((prev) => [...prev, { role: 'assistant', content: response }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate description')
    } finally {
      setIsRunning(false)
    }
  }, [input, isRunning, messages, projectId, title, toolPreference])

  const handleSeed = useCallback((): void => {
    const seed = [
      `Help me write a great issue description for this card.`,
      '',
      `Title: ${title || '(untitled)'}`,
      '',
      currentDescription.trim() ? `Current description:\n${currentDescription.trim()}` : '',
      '',
      'Ask me questions if you need more info, then provide the final description.'
    ]
      .filter(Boolean)
      .join('\n')

    setInput(seed)
  }, [currentDescription, title])

  const handleApply = useCallback((): void => {
    const extracted = extractFinalDescription(lastAssistantMessage)
    if (!extracted) return
    onApplyDescription(extracted)
    onOpenChange(false)
  }, [lastAssistantMessage, onApplyDescription, onOpenChange])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setError(null)
        setIsRunning(false)
      }
      onOpenChange(next)
    },
    [onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Draft with AI (Plan Mode)</DialogTitle>
          <DialogDescription>
            Chat with Claude Code or Codex to refine the issue description, then insert the result
            into the card.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Tool:</span>
          <div className="flex gap-2">
            {(['auto', 'claude', 'codex'] as const).map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={toolPreference === t ? 'default' : 'outline'}
                onClick={() => setToolPreference(t)}
                disabled={isRunning}
              >
                {t === 'auto' ? 'Auto' : t === 'claude' ? 'Claude' : 'Codex'}
              </Button>
            ))}
          </div>
          <div className="flex-1" />
          <Button type="button" size="sm" variant="outline" onClick={handleSeed} disabled={isRunning}>
            Seed prompt
          </Button>
        </div>

        <ScrollArea className="h-[320px] rounded-md border p-3">
          {messages.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Send a message to start. The assistant will ask clarifying questions and then produce
              a final description.
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'rounded-md border px-3 py-2 text-sm whitespace-pre-wrap',
                    m.role === 'user' ? 'bg-muted/40' : 'bg-card'
                  )}
                >
                  <div className="mb-1 text-xs text-muted-foreground">
                    {m.role === 'user' ? 'You' : 'Assistant'}
                  </div>
                  {m.content}
                </div>
              ))}
              {isRunning && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking…
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <div className="grid gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            rows={3}
            disabled={isRunning}
          />
          <div className="flex items-center justify-between">
            {error ? <div className="text-sm text-destructive">{error}</div> : <div />}
            <Button type="button" onClick={handleSend} disabled={isRunning || !input.trim()}>
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                'Send'
              )}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={isRunning || !lastAssistantMessage.trim()}
          >
            Use latest as description
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

