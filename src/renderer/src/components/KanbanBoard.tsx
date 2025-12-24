import { useState, useCallback } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners
} from '@dnd-kit/core'
import { KanbanColumn } from './KanbanColumn'
import { KanbanCard } from './KanbanCard'
import { ScrollArea } from './ui/scroll-area'
import { KANBAN_COLUMNS, type Card, type CardLink, type CardStatus } from '../../../shared/types'

interface KanbanBoardProps {
  cards: Card[]
  cardLinksByCardId: Record<string, CardLink[]>
  selectedCardId: string | null
  onSelectCard: (id: string | null) => void
  onMoveCard: (cardId: string, status: CardStatus) => void
  onAddCard: () => void
  onGenerateCards: () => void
}

export function KanbanBoard({
  cards,
  cardLinksByCardId,
  selectedCardId,
  onSelectCard,
  onMoveCard,
  onAddCard,
  onGenerateCards
}: KanbanBoardProps): React.JSX.Element {
  const [activeCard, setActiveCard] = useState<Card | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    })
  )

  const getCardsByStatus = useCallback(
    (status: CardStatus): Card[] => {
      return cards.filter((card) => card.status === status)
    },
    [cards]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const card = cards.find((c) => c.id === active.id)
      if (card) {
        setActiveCard(card)
      }
    },
    [cards]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveCard(null)

      if (!over) return

      const activeId = active.id as string
      const overId = over.id as string

      // Check if dropped over a column
      const targetStatus = KANBAN_COLUMNS.find((col) => col.id === overId)?.id
      if (targetStatus) {
        const card = cards.find((c) => c.id === activeId)
        if (card && card.status !== targetStatus) {
          onMoveCard(activeId, targetStatus)
        }
        return
      }

      // Check if dropped over another card
      const targetCard = cards.find((c) => c.id === overId)
      if (targetCard) {
        const card = cards.find((c) => c.id === activeId)
        if (card && card.status !== targetCard.status) {
          onMoveCard(activeId, targetCard.status)
        }
      }
    },
    [cards, onMoveCard]
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <ScrollArea className="h-full overflow-x-auto">
        <div className="flex h-full gap-4 p-4" onClick={() => onSelectCard(null)}>
          {KANBAN_COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              id={column.id}
              label={column.label}
              color={column.color}
              cards={getCardsByStatus(column.id)}
              cardLinksByCardId={cardLinksByCardId}
              selectedCardId={selectedCardId}
              onSelectCard={onSelectCard}
              onAddCard={column.id === 'draft' ? onAddCard : undefined}
              onGenerateCards={column.id === 'draft' ? onGenerateCards : undefined}
            />
          ))}
        </div>
      </ScrollArea>

      <DragOverlay>
        {activeCard && (
          <div className="drag-overlay">
            <KanbanCard
              card={activeCard}
              linkedPRs={cardLinksByCardId[activeCard.id]}
              isSelected={false}
              onClick={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
