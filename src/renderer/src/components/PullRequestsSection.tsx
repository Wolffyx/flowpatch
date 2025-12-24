import { GitPullRequest } from 'lucide-react'
import { ScrollArea } from './ui/scroll-area'
import { cn } from '../lib/utils'
import { PullRequestCard } from './PullRequestCard'
import type { Card } from '../../../shared/types'

interface PullRequestsSectionProps {
  cards: Card[]
  selectedCardId: string | null
  onSelectCard: (id: string) => void
}

export function PullRequestsSection({
  cards,
  selectedCardId,
  onSelectCard
}: PullRequestsSectionProps): React.JSX.Element {
  return (
    <div className="flex h-full w-80 flex-col border-r bg-background">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Pull Requests</h3>
          <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full">
            {cards.length}
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1 p-2">
        <div className={cn('space-y-2', cards.length === 0 && 'h-full')}>
          {cards.map((card) => (
            <PullRequestCard
              key={card.id}
              card={card}
              isSelected={card.id === selectedCardId}
              onClick={() => onSelectCard(card.id)}
            />
          ))}
          {cards.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No pull requests
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
