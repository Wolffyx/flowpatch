import type { CardStatus } from './card'
import type { Card } from './card'

export type DependencyType = 'blocks' | 'blocked_by'

export interface CardDependency {
  id: string
  project_id: string
  card_id: string
  depends_on_card_id: string
  blocking_statuses: CardStatus[]
  required_status: CardStatus
  is_active: number
  created_at: string
  updated_at: string
}

export interface CardDependencyWithCard extends CardDependency {
  depends_on_card?: Card
  card?: Card
}

export interface DependencyCheckResult {
  canMove: boolean
  blockedBy: CardDependencyWithCard[]
  reason?: string
}
