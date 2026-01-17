/**
 * Test Fixtures: Cards
 *
 * Sample card data for testing.
 */
import type { Card, CardStatus } from '../../src/shared/types'

export const mockCard = (overrides: Partial<Card> = {}): Card => ({
  id: `card-${Date.now()}`,
  project_id: 'test-project-1',
  provider: 'local',
  type: 'issue',
  title: 'Test Card',
  body: 'Test card body',
  status: 'draft' as CardStatus,
  ready_eligible: 0,
  assignees_json: null,
  labels_json: null,
  remote_url: null,
  remote_repo_key: null,
  remote_number_or_iid: null,
  remote_node_id: null,
  updated_remote_at: null,
  updated_local_at: new Date().toISOString(),
  sync_state: 'ok',
  last_error: null,
  has_conflicts: 0,
  ...overrides
})

export const mockCards = {
  draft: mockCard({ id: 'card-draft', status: 'draft' }),
  ready: mockCard({ id: 'card-ready', status: 'ready' }),
  inProgress: mockCard({ id: 'card-in-progress', status: 'in_progress' }),
  testing: mockCard({ id: 'card-testing', status: 'testing' }),
  inReview: mockCard({ id: 'card-in-review', status: 'in_review' }),
  done: mockCard({ id: 'card-done', status: 'done' })
}
