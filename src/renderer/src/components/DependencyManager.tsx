import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { ScrollArea } from './ui/scroll-area'
import { cn } from '../lib/utils'
import {
  Link2,
  Link2Off,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  ArrowRight
} from 'lucide-react'
import type { Card, CardStatus } from '../../../shared/types'

interface CardDependencyWithCard {
  id: string
  project_id: string
  card_id: string
  depends_on_card_id: string
  blocking_statuses: CardStatus[]
  required_status: CardStatus
  is_active: number
  created_at: string
  updated_at: string
  depends_on_card?: {
    id: string
    project_id: string
    title: string
    status: CardStatus
  }
  card?: {
    id: string
    project_id: string
    title: string
    status: CardStatus
  }
}

interface DependencyManagerProps {
  card: Card
}

const STATUS_COLORS: Record<CardStatus, string> = {
  draft: 'bg-gray-500',
  ready: 'bg-blue-500',
  in_progress: 'bg-yellow-500',
  in_review: 'bg-purple-500',
  testing: 'bg-orange-500',
  done: 'bg-green-500'
}

const STATUS_LABELS: Record<CardStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  in_progress: 'In Progress',
  in_review: 'In Review',
  testing: 'Testing',
  done: 'Done'
}

export function DependencyManager({ card }: DependencyManagerProps): React.JSX.Element {
  const [dependencies, setDependencies] = useState<CardDependencyWithCard[]>([])
  const [dependents, setDependents] = useState<CardDependencyWithCard[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [availableCards, setAvailableCards] = useState<Card[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadDependencies = useCallback(async () => {
    setLoading(true)
    try {
      // Get dependencies (what this card depends on)
      const depsResult = await window.projectAPI.getDependenciesForCardWithCards(card.id)
      if (depsResult.error) {
        toast.error('Failed to load dependencies', { description: depsResult.error })
      } else {
        setDependencies(depsResult.dependencies)
      }

      // Get dependents (what depends on this card)
      const dependentsResult = await window.projectAPI.getDependentsOfCard(card.id)
      if (dependentsResult.error) {
        toast.error('Failed to load dependents', { description: dependentsResult.error })
      } else {
        // For dependents, we need to enrich with card info
        setDependents(dependentsResult.dependencies as CardDependencyWithCard[])
      }
    } catch (err) {
      toast.error('Failed to load dependencies', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setLoading(false)
    }
  }, [card.id])

  const loadAvailableCards = useCallback(async () => {
    try {
      const cards = await window.projectAPI.getCards()
      // Filter out current card and cards that are already dependencies
      const existingDepIds = dependencies.map((d) => d.depends_on_card_id)
      const filtered = cards.filter(
        (c: Card) => c.id !== card.id && !existingDepIds.includes(c.id)
      )
      setAvailableCards(filtered)
    } catch (err) {
      toast.error('Failed to load cards')
    }
  }, [card.id, dependencies])

  useEffect(() => {
    loadDependencies()
  }, [loadDependencies])

  useEffect(() => {
    if (showAddDialog) {
      loadAvailableCards()
    }
  }, [showAddDialog, loadAvailableCards])

  const handleAddDependency = async () => {
    if (!selectedCardId) return

    setSaving(true)
    try {
      // Check for cycle first
      const cycleCheck = await window.projectAPI.checkWouldCreateCycle(card.id, selectedCardId)
      if (cycleCheck.wouldCreateCycle) {
        toast.error('Cannot add dependency', {
          description: 'This would create a circular dependency'
        })
        return
      }

      const result = await window.projectAPI.createDependency({
        cardId: card.id,
        dependsOnCardId: selectedCardId
      })

      if (result.error) {
        toast.error('Failed to add dependency', { description: result.error })
      } else {
        toast.success('Dependency added')
        setShowAddDialog(false)
        setSelectedCardId(null)
        loadDependencies()
      }
    } catch (err) {
      toast.error('Failed to add dependency', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveDependency = async (dependencyId: string) => {
    try {
      const result = await window.projectAPI.deleteDependency(dependencyId)
      if (result.error) {
        toast.error('Failed to remove dependency', { description: result.error })
      } else {
        toast.success('Dependency removed')
        loadDependencies()
      }
    } catch (err) {
      toast.error('Failed to remove dependency', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }

  const handleToggleDependency = async (dependencyId: string, isActive: boolean) => {
    try {
      const result = await window.projectAPI.toggleDependency(dependencyId, isActive)
      if (result.error) {
        toast.error('Failed to update dependency', { description: result.error })
      } else {
        loadDependencies()
      }
    } catch (err) {
      toast.error('Failed to update dependency')
    }
  }

  const isDependencyMet = (dep: CardDependencyWithCard): boolean => {
    if (!dep.depends_on_card) return false
    const statusOrder: CardStatus[] = [
      'draft',
      'ready',
      'in_progress',
      'in_review',
      'testing',
      'done'
    ]
    const currentIndex = statusOrder.indexOf(dep.depends_on_card.status)
    const requiredIndex = statusOrder.indexOf(dep.required_status)
    return currentIndex >= requiredIndex
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Dependencies
        </h4>
        <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Loading...
        </div>
      ) : (
        <div className="space-y-4">
          {/* What this card depends on */}
          {dependencies.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Depends on ({dependencies.length})
              </div>
              <div className="space-y-2">
                {dependencies.map((dep) => {
                  const isMet = isDependencyMet(dep)
                  const isActive = dep.is_active === 1
                  return (
                    <div
                      key={dep.id}
                      className={cn(
                        'flex items-center gap-2 p-2 rounded-md border',
                        !isActive && 'opacity-50',
                        isMet ? 'border-green-500/30 bg-green-500/5' : 'border-yellow-500/30 bg-yellow-500/5'
                      )}
                    >
                      {isMet ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {dep.depends_on_card?.title ?? 'Unknown card'}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {dep.depends_on_card && (
                            <Badge
                              variant="secondary"
                              className={cn(
                                'text-xs h-5',
                                STATUS_COLORS[dep.depends_on_card.status]
                              )}
                            >
                              {STATUS_LABELS[dep.depends_on_card.status]}
                            </Badge>
                          )}
                          <ArrowRight className="h-3 w-3" />
                          <span>needs {STATUS_LABELS[dep.required_status]}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleToggleDependency(dep.id, !isActive)}
                          title={isActive ? 'Disable' : 'Enable'}
                        >
                          {isActive ? (
                            <Link2 className="h-3.5 w-3.5" />
                          ) : (
                            <Link2Off className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveDependency(dep.id)}
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-2">
              No dependencies
            </div>
          )}

          {/* What depends on this card */}
          {dependents.length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Blocking ({dependents.length})
              </div>
              <div className="space-y-1">
                {dependents.map((dep) => (
                  <div
                    key={dep.id}
                    className="text-sm text-muted-foreground flex items-center gap-2"
                  >
                    <span className="truncate">
                      {dep.card?.title ?? `Card #${dep.card_id.slice(0, 8)}`}
                    </span>
                    {dep.card?.status && (
                      <Badge
                        variant="secondary"
                        className={cn('text-xs h-5', STATUS_COLORS[dep.card.status])}
                      >
                        {STATUS_LABELS[dep.card.status]}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Dependency Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Dependency</DialogTitle>
            <DialogDescription>
              Select a card that must be completed before this card can proceed.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {availableCards.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No available cards to add as dependencies.
              </div>
            ) : (
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-2 pr-4">
                  {availableCards.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCardId(c.id)}
                      className={cn(
                        'w-full text-left p-3 rounded-md border transition-colors',
                        selectedCardId === c.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:bg-muted'
                      )}
                    >
                      <div className="font-medium text-sm truncate">{c.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <div
                          className={cn(
                            'h-2 w-2 rounded-full',
                            STATUS_COLORS[c.status]
                          )}
                        />
                        <span className="text-xs text-muted-foreground">
                          {STATUS_LABELS[c.status]}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddDependency}
              disabled={!selectedCardId || saving}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Dependency'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
