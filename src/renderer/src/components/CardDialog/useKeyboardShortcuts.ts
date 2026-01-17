import { useEffect } from 'react'
import type { Card, CardStatus } from '../../../../shared/types'

interface UseKeyboardShortcutsProps {
  card: Card | null
  isEditingDescription: boolean
  showTestButton: boolean
  onStartEdit: () => void
  onSaveDescription: () => void
  onCancelEdit: () => void
  onRunWorker: (cardId: string) => void
  onOpenTestDialog: () => void
  onMoveCard: (cardId: string, status: CardStatus) => void
}

export function useKeyboardShortcuts({
  card,
  isEditingDescription,
  showTestButton,
  onStartEdit,
  onSaveDescription,
  onCancelEdit,
  onRunWorker,
  onOpenTestDialog,
  onMoveCard
}: UseKeyboardShortcutsProps) {
  useEffect(() => {
    if (!card) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Allow ESC and Ctrl/Cmd+S even in inputs
        if (e.key === 'Escape') {
          if (isEditingDescription) {
            e.preventDefault()
            onCancelEdit()
          }
          return
        }
        if (e.key === 's' && (e.metaKey || e.ctrlKey) && isEditingDescription) {
          e.preventDefault()
          onSaveDescription()
        }
        return
      }

      switch (e.key.toLowerCase()) {
        case 'e':
          if (!isEditingDescription) {
            e.preventDefault()
            onStartEdit()
          }
          break
        case 'w':
          if (card.ready_eligible === 1 && card.provider !== 'local') {
            e.preventDefault()
            onRunWorker(card.id)
          }
          break
        case 't':
          if (showTestButton) {
            e.preventDefault()
            onOpenTestDialog()
          }
          break
        case '1':
          e.preventDefault()
          onMoveCard(card.id, 'draft')
          break
        case '2':
          e.preventDefault()
          onMoveCard(card.id, 'ready')
          break
        case '3':
          e.preventDefault()
          onMoveCard(card.id, 'in_progress')
          break
        case '4':
          e.preventDefault()
          onMoveCard(card.id, 'in_review')
          break
        case '5':
          e.preventDefault()
          onMoveCard(card.id, 'testing')
          break
        case '6':
          e.preventDefault()
          onMoveCard(card.id, 'done')
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    card,
    isEditingDescription,
    showTestButton,
    onStartEdit,
    onSaveDescription,
    onCancelEdit,
    onRunWorker,
    onOpenTestDialog,
    onMoveCard
  ])
}
