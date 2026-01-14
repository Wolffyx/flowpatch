import { useState, useCallback, useRef } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragMoveEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection
} from '@dnd-kit/core'
import type { CollisionDetection } from '@dnd-kit/core'
import { KanbanColumn } from './KanbanColumn'
import { KanbanCard } from './KanbanCard'
import { useDragAutoScroll } from '../hooks/useDragAutoScroll'
import { KANBAN_COLUMNS, type Card, type CardLink, type CardStatus } from '../../../shared/types'

// Custom collision detection: use pointer position first, fall back to rect intersection
const kanbanCollisionDetection: CollisionDetection = (args) => {
  // First, try pointer-based detection (most accurate for cursor position)
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) {
    return pointerCollisions
  }
  // Fall back to rectangle intersection
  return rectIntersection(args)
}

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
  const [overColumnId, setOverColumnId] = useState<CardStatus | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { onDragMove: autoScrollOnDragMove, cleanup: cleanupAutoScroll } =
    useDragAutoScroll(scrollContainerRef)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5
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

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event
      if (!over) {
        setOverColumnId(null)
        return
      }

      const overId = over.id as string

      // Check if directly over a column
      const column = KANBAN_COLUMNS.find((col) => col.id === overId)
      if (column) {
        setOverColumnId(column.id)
        return
      }

      // Check if over a card - get its parent column status
      const overCard = cards.find((c) => c.id === overId)
      if (overCard) {
        setOverColumnId(overCard.status)
        return
      }

      setOverColumnId(null)
    },
    [cards]
  )

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      autoScrollOnDragMove(event)
    },
    [autoScrollOnDragMove]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      cleanupAutoScroll()
      setOverColumnId(null)
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
    [cleanupAutoScroll, cards, onMoveCard]
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={scrollContainerRef}
        className="h-full overflow-x-auto overflow-y-hidden kanban-scroll"
      >
        <div
          className="flex h-full gap-4 p-4 min-w-max"
          onClick={() => onSelectCard(null)}
        >
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
              isOverColumn={overColumnId === column.id}
              onAddCard={column.id === 'draft' ? onAddCard : undefined}
              onGenerateCards={column.id === 'draft' ? onGenerateCards : undefined}
            />
          ))}
        </div>
      </div>

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
