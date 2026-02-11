/**
 * Unit tests for card IPC handlers: createCard and splitCard pass draft status label
 * and sub-issue linking is preserved/hardened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

const createIssueMock = vi.fn()
const getStatusLabelMock = vi.fn((status: string) => (status === 'draft' ? 'Draft' : 'Ready'))
const addSubIssueMock = vi.fn().mockResolvedValue(true)

const fakeAdapter = {
  providerKey: 'github',
  checkAuth: vi.fn().mockResolvedValue({ authenticated: true }),
  getStatusLabel: getStatusLabelMock,
  createIssue: createIssueMock,
  addSubIssue: addSubIssueMock,
  updateIssueBody: vi.fn().mockResolvedValue(true),
  get provider() {
    return 'github'
  },
  get isLocal() {
    return false
  }
}

const mockCard = {
  id: 'card-1',
  project_id: 'proj-1',
  provider: 'github',
  type: 'issue' as const,
  title: 'Parent',
  body: null,
  status: 'draft' as const,
  ready_eligible: 0,
  assignees_json: null,
  labels_json: null,
  remote_url: 'https://github.com/o/r/issues/1',
  remote_repo_key: 'github:owner/repo',
  remote_number_or_iid: '1',
  remote_node_id: 'node-parent',
  updated_remote_at: null,
  updated_local_at: new Date().toISOString(),
  sync_state: 'ok' as const,
  last_error: null,
  has_conflicts: 0
}

const mockProject = {
  id: 'proj-1',
  name: 'Test',
  local_path: '/tmp/repo',
  selected_remote_name: null,
  remote_repo_key: 'github:owner/repo',
  provider_hint: 'auto' as const,
  policy_json: JSON.stringify({ sync: { statusLabels: { draft: 'Draft' } } }),
  worker_enabled: 0,
  last_sync_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
}

vi.mock('../../db', () => ({
  getProject: vi.fn(),
  getCard: vi.fn(),
  createLocalTestCard: vi.fn(() => ({ ...mockCard, id: 'local-1' })),
  updateCardStatus: vi.fn(),
  updateCardLabels: vi.fn(),
  upsertCard: vi.fn((c: unknown) => c),
  createEvent: vi.fn(),
  createJob: vi.fn(),
  getActiveWorkerJobForCard: vi.fn(() => null),
  cancelJob: vi.fn(),
  updateJobState: vi.fn(),
  checkCanMoveToStatus: vi.fn(() => ({ canMove: true, blockedBy: [] })),
  deleteCard: vi.fn(),
  createCardDependency: vi.fn(),
  updateCardTimestamp: vi.fn(),
  deleteFailedWorkerRunJobsForCard: vi.fn()
}))

vi.mock('../../adapters', () => ({
  AdapterRegistry: { create: vi.fn() },
  isGithubAdapter: vi.fn((a: { providerKey: string }) => a.providerKey === 'github')
}))

vi.mock('../../sync/engine', () => ({ SyncEngine: vi.fn() }))
vi.mock('../../sync/scheduler', () => ({ triggerProjectSync: vi.fn() }))
vi.mock('../../worker/loop', () => ({ wakeUpWorkerLoop: vi.fn() }))

const db = await import('../../db')
const adapters = await import('../../adapters')

describe('card handlers – draft label and sub-issue linking', () => {
  const handlers: Record<string, (event: unknown, ...args: unknown[]) => Promise<unknown>> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, fn: (event: any, ...args: any[]) => any) => {
      handlers[channel] = fn as (event: unknown, ...args: unknown[]) => Promise<unknown>
    })
    createIssueMock.mockResolvedValue({
      number: 42,
      url: 'https://github.com/o/r/issues/42',
      card: { ...mockCard, id: 'child-1', remote_number_or_iid: '42', remote_node_id: 'node-child' },
      issueId: 12345
    })
    getStatusLabelMock.mockImplementation((s: string) => (s === 'draft' ? 'Draft' : 'Ready'))
  })

  it('createCard (github_issue) calls adapter.createIssue with draft status label', async () => {
    vi.mocked(db.getProject).mockReturnValue(mockProject as never)
    vi.mocked(adapters.AdapterRegistry.create).mockReturnValue(fakeAdapter as never)

    const { registerCardHandlers } = await import('./card')
    registerCardHandlers(vi.fn())

    const handler = handlers['createCard']
    expect(handler).toBeDefined()

    await (handler as (...args: unknown[]) => Promise<unknown>)(
      null,
      {
        projectId: 'proj-1',
        title: 'New issue',
        body: 'Description',
        createType: 'github_issue'
      }
    )

    expect(createIssueMock).toHaveBeenCalledTimes(1)
    expect(createIssueMock).toHaveBeenCalledWith('New issue', 'Description', ['Draft'])
    expect(getStatusLabelMock).toHaveBeenCalledWith('draft')
  })

  it('splitCard (repo_issue) calls adapter.createIssue with draft status label for each child', async () => {
    vi.mocked(db.getProject).mockReturnValue(mockProject as never)
    vi.mocked(db.getCard).mockReturnValue(mockCard as never)
    vi.mocked(adapters.AdapterRegistry.create).mockReturnValue(fakeAdapter as never)

    const { registerCardHandlers } = await import('./card')
    registerCardHandlers(vi.fn())

    const handler = handlers['splitCard']
    expect(handler).toBeDefined()

    await (handler as (...args: unknown[]) => Promise<unknown>)(
      null,
      {
        cardId: 'card-1',
        items: [
          { title: 'Child A', body: undefined },
          { title: 'Child B', body: 'Body B' }
        ]
      }
    )

    expect(createIssueMock).toHaveBeenCalledTimes(2)
    expect(createIssueMock).toHaveBeenNthCalledWith(1, 'Child A', expect.any(String), ['Draft'])
    expect(createIssueMock).toHaveBeenNthCalledWith(2, 'Child B', expect.any(String), ['Draft'])
    expect(getStatusLabelMock).toHaveBeenCalledWith('draft')
    expect(addSubIssueMock).toHaveBeenCalledTimes(2)
    expect(addSubIssueMock).toHaveBeenNthCalledWith(1, 'node-parent', 'node-child', 1, 42, 12345)
    expect(addSubIssueMock).toHaveBeenNthCalledWith(2, 'node-parent', 'node-child', 1, 42, 12345)
  })

  it('splitCard skips addSubIssue when parent has no remote_number_or_iid', async () => {
    const parentWithoutRemote = { ...mockCard, remote_number_or_iid: null, remote_node_id: null }
    vi.mocked(db.getProject).mockReturnValue(mockProject as never)
    vi.mocked(db.getCard).mockReturnValue(parentWithoutRemote as never)
    vi.mocked(adapters.AdapterRegistry.create).mockReturnValue(fakeAdapter as never)

    const { registerCardHandlers } = await import('./card')
    registerCardHandlers(vi.fn())

    const handler = handlers['splitCard']
    await (handler as (...args: unknown[]) => Promise<unknown>)(
      null,
      { cardId: 'card-1', items: [{ title: 'Only child' }] }
    )

    expect(createIssueMock).toHaveBeenCalledWith('Only child', expect.any(String), ['Draft'])
    expect(addSubIssueMock).not.toHaveBeenCalled()
  })
})
