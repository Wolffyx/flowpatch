/**
 * Test Fixtures: Projects
 *
 * Sample project data for testing.
 */
import type { Project } from '../../src/shared/types'

export const mockProject = (overrides: Partial<Project> = {}): Project => ({
  id: `project-${Date.now()}`,
  name: 'Test Project',
  local_path: '/tmp/test-project',
  selected_remote_name: null,
  remote_repo_key: null,
  provider_hint: 'auto',
  policy_json: null,
  worker_enabled: 0,
  last_sync_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides
})

export const mockProjects = {
  basic: mockProject({ id: 'project-basic', name: 'Basic Project' }),
  withWorker: mockProject({
    id: 'project-worker',
    name: 'Worker Project',
    worker_enabled: 1
  }),
  github: mockProject({
    id: 'project-github',
    name: 'GitHub Project',
    provider_hint: 'github',
    remote_repo_key: 'owner/repo'
  }),
  gitlab: mockProject({
    id: 'project-gitlab',
    name: 'GitLab Project',
    provider_hint: 'gitlab',
    remote_repo_key: 'group/project'
  })
}
