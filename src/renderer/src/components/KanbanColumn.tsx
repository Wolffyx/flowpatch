import type { MouseEvent } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, Sparkles, Inbox } from 'lucide-react'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { KanbanCard } from './KanbanCard'
import { cn } from '../lib/utils'
import type { Card, CardLink, CardStatus } from '../../../shared/types'

interface KanbanColumnProps {
  id: CardStatus
  label: string
  color: string
  cards: Card[]
  cardLinksByCardId: Record<string, CardLink[]>
  selectedCardId: string | null
  onSelectCard: (id: string) => void
  onCardContextMenu?: (event: MouseEvent, card: Card) => void
  isOverColumn?: boolean
  onAddCard?: () => void
  onGenerateCards?: () => void
}

export function KanbanColumn({
  id,
  label,
  color,
  cards,
  cardLinksByCardId,
  selectedCardId,
  onSelectCard,
  onCardContextMenu,
  isOverColumn = false,
  onAddCard,
  onGenerateCards
}: KanbanColumnProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { status: id }
  })

  // Highlight when either directly over OR parent says we're the target
  const showHighlight = isOver || isOverColumn

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full w-[280px] min-w-[240px] max-w-[320px] flex-col rounded-xl border bg-muted/30',
        'transition-all duration-200',
        showHighlight && 'ring-2 ring-primary ring-inset bg-primary/5'
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between p-3 pb-2">
        <div className="flex items-center gap-2.5">
          <div className={cn('h-3 w-3 rounded-full ring-2 ring-offset-2 ring-offset-background', color)} />
          <h3 className="font-semibold text-sm">{label}</h3>
          <span
            className={cn(
              'text-xs font-medium px-2 py-0.5 rounded-full',
              'bg-muted text-muted-foreground',
              cards.length > 0 && 'bg-primary/10 text-primary'
            )}
          >
            {cards.length}
          </span>
        </div>
        {id === 'draft' && (
          <div className="flex items-center gap-0.5">
            {onGenerateCards && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                    onClick={onGenerateCards}
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Generate cards with AI</p>
                </TooltipContent>
              </Tooltip>
            )}
            {onAddCard && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                    onClick={onAddCard}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Add new card</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {/* Cards container */}
      <ScrollArea className="flex-1 px-2 pb-2 pt-2">
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {cards.map((card) => (
              <KanbanCard
                key={card.id}
                card={card}
                linkedPRs={cardLinksByCardId[card.id]}
                isSelected={card.id === selectedCardId}
                onClick={() => onSelectCard(card.id)}
                onContextMenu={onCardContextMenu}
              />
            ))}
          </div>
        </SortableContext>

        {/* Empty state */}
        {cards.length === 0 && (
          <div
            className={cn(
              'flex flex-col items-center justify-center py-8 px-4',
              'text-muted-foreground rounded-lg',
              'border-2 border-dashed border-muted transition-colors',
              showHighlight && 'border-primary/50 bg-primary/5'
            )}
          >
            <Inbox className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm font-medium">No cards</p>
            <p className="text-xs opacity-70">
              {showHighlight ? 'Drop card here' : 'Drag cards here'}
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
