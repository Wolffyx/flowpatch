import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { ScrollArea } from './ui/scroll-area'
import { Loader2, Sparkles, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { AIDescriptionDialog } from './AIDescriptionDialog'

type ToolPreference = 'auto' | 'claude' | 'codex'

export type StarterCardsWizardMode = 'onboarding' | 'manual'

export interface StarterCardsWizardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  mode: StarterCardsWizardMode
  onCreateCards: (items: Array<{ title: string; body: string }>) => Promise<void>
}

type Step = 'describe' | 'review'

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 8
  return Math.min(15, Math.max(1, Math.floor(value)))
}

export function StarterCardsWizardDialog({
  open,
  onOpenChange,
  projectId,
  mode,
  onCreateCards
}: StarterCardsWizardDialogProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('describe')
  const [toolPreference, setToolPreference] = useState<ToolPreference>('auto')
  const [count, setCount] = useState<number>(8)
  const [description, setDescription] = useState('')
  const [cards, setCards] = useState<Array<{ title: string; body: string }>>([])
  const [aiDescriptionOpen, setAiDescriptionOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStep('describe')
    setToolPreference('auto')
    setCount(8)
    setDescription('')
    setCards([])
    setIsGenerating(false)
    setIsCreating(false)
    setAiDescriptionOpen(false)
    setError(null)
  }, [open])

  const safeProjectId = projectId || ''
  const canGenerate = safeProjectId.trim().length > 0 && description.trim().length > 0 && !isGenerating

  const title = mode === 'onboarding' ? 'Create starter cards' : 'Generate cards with AI'
  const subtitle =
    mode === 'onboarding'
      ? 'Describe your app, then generate a draft set of cards to get started.'
      : 'Generate a draft set of cards from an app description.'

  const handleGenerate = useCallback(async (): Promise<void> => {
    if (!canGenerate) return
    setIsGenerating(true)
    setError(null)
    try {
      const result: {
        success?: boolean
        toolUsed?: 'claude' | 'codex'
        cards?: Array<{ title: string; body: string }>
        error?: string
      } = await window.electron.ipcRenderer.invoke('generateCardList', {
        projectId: safeProjectId,
        description,
        count: clampCount(count),
        toolPreference
      })

      if (result?.error) throw new Error(result.error)
      const nextCards = Array.isArray(result?.cards) ? result.cards : []
      if (nextCards.length === 0) throw new Error('No cards returned from agent')

      setCards(nextCards.map((c) => ({ title: c.title || '', body: c.body || '' })))
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate cards')
    } finally {
      setIsGenerating(false)
    }
  }, [canGenerate, count, description, safeProjectId, toolPreference])

  const moveCard = useCallback((index: number, dir: -1 | 1) => {
    setCards((prev) => {
      const nextIndex = index + dir
      if (nextIndex < 0 || nextIndex >= prev.length) return prev
      const next = [...prev]
      const tmp = next[index]
      next[index] = next[nextIndex]
      next[nextIndex] = tmp
      return next
    })
  }, [])

  const removeCard = useCallback((index: number) => {
    setCards((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const updateCard = useCallback((index: number, patch: Partial<{ title: string; body: string }>) => {
    setCards((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }, [])

  const validCards = useMemo(() => cards.filter((c) => c.title.trim().length > 0), [cards])

  const handleCreate = useCallback(async (): Promise<void> => {
    if (isCreating) return
    const items = validCards.map((c) => ({ title: c.title.trim(), body: c.body.trim() })).slice(0, 15)
    if (items.length === 0) {
      setError('Add at least one card title before creating.')
      return
    }

    setIsCreating(true)
    setError(null)
    try {
      await onCreateCards(items)
      if (mode === 'onboarding') {
        await window.electron.ipcRenderer.invoke('completeStarterCardsWizard', {
          projectId: safeProjectId
        })
      }
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cards')
    } finally {
      setIsCreating(false)
    }
  }, [isCreating, mode, onCreateCards, onOpenChange, safeProjectId, validCards])

  const handleSkip = useCallback(async (): Promise<void> => {
    if (mode !== 'onboarding') {
      onOpenChange(false)
      return
    }
    try {
      await window.electron.ipcRenderer.invoke('dismissStarterCardsWizard', { projectId: safeProjectId })
    } catch {
      // ignore
    } finally {
      onOpenChange(false)
    }
  }, [mode, onOpenChange, safeProjectId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[820px] max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        {step === 'describe' ? (
          <div className="grid gap-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Tool:</span>
              <div className="flex gap-2">
                {(['auto', 'claude', 'codex'] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={toolPreference === t ? 'default' : 'outline'}
                    onClick={() => setToolPreference(t)}
                    disabled={isGenerating || isCreating}
                  >
                    {t === 'auto' ? 'Auto' : t === 'claude' ? 'Claude' : 'Codex'}
                  </Button>
                ))}
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Cards:</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={15}
                  value={count}
                  onChange={(e) => setCount(clampCount(Number(e.target.value)))}
                  className="w-24"
                  disabled={isGenerating || isCreating}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium">App description</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAiDescriptionOpen(true)}
                  disabled={isGenerating || isCreating || !safeProjectId}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Draft with AI
                </Button>
              </div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the app you want to build. Include key features, users, and constraints."
                rows={8}
                disabled={isGenerating || isCreating}
              />
            </div>

            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0 pr-4 -mr-4">
            <div className="grid gap-3 py-2">
              <div className="text-sm text-muted-foreground">
                Review and edit the generated cards. All cards will be created as <span className="font-medium">Draft</span>.
              </div>

              {cards.map((c, idx) => (
                <div key={idx} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 grid gap-2">
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-muted-foreground w-8">{idx + 1}.</div>
                        <Input
                          value={c.title}
                          onChange={(e) => updateCard(idx, { title: e.target.value })}
                          placeholder="Card title"
                          disabled={isCreating}
                        />
                      </div>
                      <Textarea
                        value={c.body}
                        onChange={(e) => updateCard(idx, { body: e.target.value })}
                        placeholder="Card description (Markdown supported)"
                        rows={4}
                        disabled={isCreating}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => moveCard(idx, -1)}
                        disabled={isCreating || idx === 0}
                        title="Move up"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => moveCard(idx, 1)}
                        disabled={isCreating || idx === cards.length - 1}
                        title="Move down"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => removeCard(idx)}
                        disabled={isCreating}
                        title="Remove"
                        className={cn('text-destructive')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="shrink-0">
          {step === 'review' ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStep('describe')
                setError(null)
              }}
              disabled={isCreating}
            >
              Back
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={handleSkip} disabled={isGenerating || isCreating}>
              {mode === 'onboarding' ? 'Skip' : 'Close'}
            </Button>
          )}

          {step === 'describe' ? (
            <Button type="button" onClick={handleGenerate} disabled={!canGenerate || isCreating}>
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                'Generate cards'
              )}
            </Button>
          ) : (
            <Button type="button" onClick={handleCreate} disabled={isCreating || validCards.length === 0}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                `Create ${validCards.length} draft cards`
              )}
            </Button>
          )}
        </DialogFooter>

        <AIDescriptionDialog
          open={aiDescriptionOpen}
          onOpenChange={setAiDescriptionOpen}
          projectId={safeProjectId}
          title="App description"
          currentDescription={description}
          onApplyDescription={(txt) => setDescription(txt)}
        />
      </DialogContent>
    </Dialog>
  )
}

