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
import { Loader2, ArrowUp, ArrowDown, Trash2, Minus, Plus, RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'
import type { Card } from '../../../shared/types'

type ToolPreference = 'auto' | 'claude' | 'codex'
type CountMode = 'auto' | 'manual'
type Step = 'configure' | 'review'

interface SplitCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  card: Card
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 3
  return Math.min(12, Math.max(1, Math.floor(value)))
}

export function SplitCardDialog({
  open,
  onOpenChange,
  projectId,
  card
}: SplitCardDialogProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('configure')
  const [toolPreference, setToolPreference] = useState<ToolPreference>('auto')
  const [countMode, setCountMode] = useState<CountMode>('auto')
  const [count, setCount] = useState(3)
  const [guidance, setGuidance] = useState('')
  const [cards, setCards] = useState<Array<{ title: string; body: string }>>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStep('configure')
    setToolPreference('auto')
    setCountMode('auto')
    setCount(3)
    setGuidance('')
    setCards([])
    setIsGenerating(false)
    setIsCreating(false)
    setError(null)
  }, [open])

  const canGenerate = projectId.trim().length > 0 && !isGenerating
  const createLabel = card.remote_repo_key ? 'Repo issues' : 'Local cards'

  const handleGenerate = useCallback(
    async (adjustment?: 'more' | 'fewer'): Promise<void> => {
      if (!canGenerate) return
      setIsGenerating(true)
      setError(null)
      try {
        // Build guidance with adjustment request if needed
        let fullGuidance = guidance
        if (adjustment === 'more') {
          const currentCount = cards.length || count
          fullGuidance = `${guidance}\n\nIMPORTANT: The previous split produced ${currentCount} cards which was too few. Please generate MORE cards (at least ${currentCount + 2}).`.trim()
        } else if (adjustment === 'fewer') {
          const currentCount = cards.length || count
          fullGuidance = `${guidance}\n\nIMPORTANT: The previous split produced ${currentCount} cards which was too many. Please generate FEWER cards (at most ${Math.max(2, currentCount - 2)}).`.trim()
        }

        // When adjusting (more/fewer), always use auto mode (count=0) so AI can decide new count
        // Otherwise respect the user's countMode setting
        const effectiveCount = adjustment ? 0 : countMode === 'auto' ? 0 : clampCount(count)

        const result: {
          success?: boolean
          toolUsed?: 'claude' | 'codex'
          cards?: Array<{ title: string; body: string }>
          error?: string
        } = await window.electron.ipcRenderer.invoke('generateSplitCards', {
          projectId,
          cardId: card.id,
          count: effectiveCount,
          toolPreference,
          guidance: fullGuidance
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
    },
    [canGenerate, card.id, cards.length, count, countMode, guidance, projectId, toolPreference]
  )

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

  const updateCard = useCallback(
    (index: number, patch: Partial<{ title: string; body: string }>) => {
      setCards((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
    },
    []
  )

  const validCards = useMemo(() => cards.filter((c) => c.title.trim().length > 0), [cards])

  const handleCreate = useCallback(async (): Promise<void> => {
    if (isCreating) return
    const items = validCards.map((c) => ({ title: c.title.trim(), body: c.body.trim() })).slice(0, 12)
    if (items.length === 0) {
      setError('Add at least one card title before creating.')
      return
    }

    setIsCreating(true)
    setError(null)
    try {
      const result = await window.projectAPI.splitCard({ cardId: card.id, items })
      if (result?.error) throw new Error(result.error)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create split cards')
    } finally {
      setIsCreating(false)
    }
  }, [card.id, isCreating, onOpenChange, validCards])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[820px] h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Split card with AI</DialogTitle>
          <DialogDescription>
            Generate child cards for "{card.title}". Parent will depend on the new cards.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          {step === 'configure' ? (
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
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Cards:</span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={countMode === 'auto' ? 'default' : 'outline'}
                      onClick={() => setCountMode('auto')}
                      disabled={isGenerating || isCreating}
                    >
                      Auto
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={countMode === 'manual' ? 'default' : 'outline'}
                      onClick={() => setCountMode('manual')}
                      disabled={isGenerating || isCreating}
                    >
                      Manual
                    </Button>
                  </div>
                  {countMode === 'manual' && (
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={12}
                      value={count}
                      onChange={(e) => setCount(clampCount(Number(e.target.value)))}
                      className="w-20"
                      disabled={isGenerating || isCreating}
                    />
                  )}
                  {countMode === 'auto' && (
                    <span className="text-xs text-muted-foreground">AI decides the optimal number</span>
                  )}
                </div>

                <div className="grid gap-2">
                  <div className="text-sm font-medium">Create as</div>
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3 text-left',
                      'border-primary bg-primary/5'
                    )}
                  >
                    <div className="flex h-4 w-4 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground" />
                    <div className="flex-1">
                      <div className="font-medium">{createLabel}</div>
                      <div className="text-xs text-muted-foreground">
                        Matches the parent card type.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  <label className="text-sm font-medium">Guidance (optional)</label>
                  <Textarea
                    value={guidance}
                    onChange={(e) => setGuidance(e.target.value)}
                    placeholder="Add any extra context or preferred split approach."
                    rows={4}
                    disabled={isGenerating || isCreating}
                  />
                </div>

                {error && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}
              </div>
          ) : (
            <div className="grid gap-3 py-2">
              <div className="flex items-center justify-between gap-2 sticky top-0 bg-background py-2 -mt-2 z-10">
                  <div className="text-sm text-muted-foreground">
                    Review and edit the {cards.length} generated cards. They will be created as{' '}
                    {createLabel.toLowerCase()}.
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleGenerate('fewer')}
                      disabled={isGenerating || isCreating}
                      title="Regenerate with fewer cards"
                    >
                      <Minus className="h-3 w-3 mr-1" />
                      Fewer
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleGenerate()}
                      disabled={isGenerating || isCreating}
                      title="Regenerate cards"
                    >
                      <RefreshCw className={cn('h-3 w-3', isGenerating && 'animate-spin')} />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleGenerate('more')}
                      disabled={isGenerating || isCreating}
                      title="Regenerate with more cards"
                    >
                      More
                      <Plus className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
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

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          {step === 'review' ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStep('configure')
                setError(null)
              }}
              disabled={isCreating}
            >
              Back
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating || isCreating}>
              Close
            </Button>
          )}

          {step === 'configure' ? (
            <Button type="button" onClick={handleGenerate} disabled={!canGenerate || isCreating}>
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate split cards'
              )}
            </Button>
          ) : (
            <Button type="button" onClick={handleCreate} disabled={isCreating || validCards.length === 0}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                `Create ${validCards.length} ${createLabel.toLowerCase()}`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
