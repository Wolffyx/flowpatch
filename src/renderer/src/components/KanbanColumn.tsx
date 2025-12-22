import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
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
  onAddCard?: () => void
}

export function KanbanColumn({
  id,
  label,
  color,
  cards,
  cardLinksByCardId,
  selectedCardId,
  onSelectCard,
  onAddCard
}: KanbanColumnProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { status: id }
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full min-w-[200px] flex-1 flex-col rounded-lg border bg-card',
        isOver && 'ring-2 ring-primary ring-inset'
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <div className={cn('h-3 w-3 rounded-full', color)} />
          <h3 className="font-medium">{label}</h3>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {cards.length}
          </span>
        </div>
        {id === 'draft' && onAddCard && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onAddCard}>
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Cards */}
      <ScrollArea className="flex-1 p-2">
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {cards.map((card) => (
              <KanbanCard
                key={card.id}
                card={card}
                linkedPRs={cardLinksByCardId[card.id]}
                isSelected={card.id === selectedCardId}
                onClick={() => onSelectCard(card.id)}
              />
            ))}
          </div>
        </SortableContext>

        {cards.length === 0 && (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No cards
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
