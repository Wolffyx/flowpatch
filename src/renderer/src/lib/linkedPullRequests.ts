import type { Card, CardLink } from '@shared/types'

export interface LinkedPullRequestIndex {
  urls: Set<string>
  numbers: Set<string>
}

export function buildLinkedPullRequestIndex(
  cardLinks: CardLink[] | null | undefined
): LinkedPullRequestIndex {
  const urls = new Set<string>()
  const numbers = new Set<string>()

  for (const link of cardLinks ?? []) {
    if (link.linked_type !== 'pr' && link.linked_type !== 'mr') continue
    if (link.linked_url) urls.add(link.linked_url)
    if (link.linked_number_or_iid) numbers.add(link.linked_number_or_iid)
  }

  return { urls, numbers }
}

export function isLinkedPullRequestCard(card: Card, index: LinkedPullRequestIndex): boolean {
  if (card.type !== 'pr' && card.type !== 'mr') return false
  if (card.remote_url && index.urls.has(card.remote_url)) return true
  if (card.remote_number_or_iid && index.numbers.has(card.remote_number_or_iid)) return true
  return false
}

export function filterOutLinkedPullRequestCards(
  cards: Card[],
  index: LinkedPullRequestIndex
): Card[] {
  return cards.filter((card) => !isLinkedPullRequestCard(card, index))
}
