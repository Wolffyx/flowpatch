import { useEffect, useMemo, useRef } from 'react'
import { Scissors, ArrowRight } from 'lucide-react'
import type { Card } from '../../../shared/types'

interface CardContextMenuProps {
  open: boolean
  position: { x: number; y: number } | null
  card: Card | null
  onClose: () => void
  onOpenCard: (card: Card) => void
  onSplitCard: (card: Card) => void
}

export function CardContextMenu({
  open,
  position,
  card,
  onClose,
  onOpenCard,
  onSplitCard
}: CardContextMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handleMouseDown = (event: MouseEvent): void => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    const handleScroll = (): void => onClose()

    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [onClose, open])

  const safePosition = useMemo(() => {
    if (!position) return { x: 0, y: 0 }
    const width = 220
    const height = 120
    const maxX = Math.max(0, window.innerWidth - width)
    const maxY = Math.max(0, window.innerHeight - height)
    return {
      x: Math.min(position.x, maxX),
      y: Math.min(position.y, maxY)
    }
  }, [position])

  if (!open || !position || !card) return null

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-56 rounded-md border bg-popover text-popover-foreground shadow-md"
      style={{ left: safePosition.x, top: safePosition.y }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
        onClick={() => {
          onOpenCard(card)
          onClose()
        }}
      >
        <ArrowRight className="h-4 w-4" />
        Open card
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
        onClick={() => {
          onSplitCard(card)
          onClose()
        }}
      >
        <Scissors className="h-4 w-4" />
        Split with AI
      </button>
    </div>
  )
}
