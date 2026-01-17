/**
 * IPC handlers for repo onboarding operations.
 * Handles: label wizard, GitHub project prompts, label management
 */

import { ipcMain } from 'electron'
import { getProject, getAppSetting, setAppSetting, updateProjectPolicyJson, listCards } from '../../db'
import { AdapterRegistry } from '../../adapters'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { parsePolicyJson, labelExists } from '@shared/utils'
import type {
  RepoLabel,
  RepoOnboardingState,
  ApplyLabelConfigPayload,
  CreateRepoLabelsPayload,
  CreateRepoLabelsResult,
  ListRepoLabelsPayload,
  ListRepoLabelsResult
} from '@shared/types'

const execFileAsync = promisify(execFile)

// ============================================================================
// Onboarding State Helpers
// ============================================================================

function getOnboardingKey(projectId: string, key: string): string {
  return `onboarding:${projectId}:${key}`
}

export function getOnboardingBool(projectId: string, key: string): boolean {
  return getAppSetting(getOnboardingKey(projectId, key)) === '1'
}

export function setOnboardingBool(projectId: string, key: string, value: boolean): void {
  setAppSetting(getOnboardingKey(projectId, key), value ? '1' : '0')
}

async function execCli(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { cwd })
  return stdout.toString()
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerOnboardingHandlers(notifyRenderer: () => void): void {
  // Get repo onboarding state
  ipcMain.handle(
    'getRepoOnboardingState',
    (_e, payload: { projectId: string }): RepoOnboardingState => {
      if (!payload?.projectId)
        return {
          shouldPromptGithubProject: false,
          shouldShowLabelWizard: false,
          shouldShowStarterCardsWizard: false
        }

      const project = getProject(payload.projectId)
      if (!project) {
        return {
          shouldPromptGithubProject: false,
          shouldShowLabelWizard: false,
          shouldShowStarterCardsWizard: false
        }
      }

      const hasRemote = !!project.remote_repo_key
      const isGithub = project.remote_repo_key?.startsWith('github:') ?? false
      const isGitlab = project.remote_repo_key?.startsWith('gitlab:') ?? false
      const labelsCompleted = getOnboardingBool(payload.projectId, 'labelsCompleted')
      const labelsDismissed = getOnboardingBool(payload.projectId, 'labelsDismissed')

      const shouldShowLabelWizard =
        hasRemote && (isGithub || isGitlab) && !labelsCompleted && !labelsDismissed

      let shouldPromptGithubProject = false
      if (isGithub) {
        const promptDismissed = getOnboardingBool(payload.projectId, 'githubProjectDismissed')
        const policy = parsePolicyJson(project.policy_json)
        const enabled = policy.sync?.githubProjectsV2?.enabled
        const existingProjectId = policy.sync?.githubProjectsV2?.projectId
        shouldPromptGithubProject =
          !!project.last_sync_at && !promptDismissed && enabled !== false && !existingProjectId
      }

      const starterEligible = getOnboardingBool(payload.projectId, 'starterCardsEligible')
      const starterDismissed = getOnboardingBool(payload.projectId, 'starterCardsDismissed')
      const starterCompleted = getOnboardingBool(payload.projectId, 'starterCardsCompleted')
      const hasNoCards = listCards(payload.projectId).length === 0
      const shouldShowStarterCardsWizard =
        starterEligible && !starterDismissed && !starterCompleted && hasNoCards

      return { shouldPromptGithubProject, shouldShowLabelWizard, shouldShowStarterCardsWizard }
    }
  )

  // Dismiss label wizard
  ipcMain.handle('dismissLabelWizard', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }
    setOnboardingBool(payload.projectId, 'labelsDismissed', true)
    return { success: true }
  })

  // Reset label wizard
  ipcMain.handle('resetLabelWizard', (_e, payload: { projectId: string }) => {
    console.log('[Main] resetLabelWizard called with payload:', payload)
    if (!payload?.projectId) {
      console.log('[Main] resetLabelWizard: No projectId provided')
      return { error: 'Project ID required' }
    }
    console.log('[Main] resetLabelWizard: Setting onboarding bools for project:', payload.projectId)
    setOnboardingBool(payload.projectId, 'labelsDismissed', false)
    setOnboardingBool(payload.projectId, 'labelsCompleted', false)
    console.log('[Main] resetLabelWizard: Calling notifyRenderer()')
    notifyRenderer()
    console.log('[Main] resetLabelWizard: Done, returning success')
    return { success: true }
  })

  // Dismiss starter cards wizard
  ipcMain.handle('dismissStarterCardsWizard', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }
    setOnboardingBool(payload.projectId, 'starterCardsDismissed', true)
    return { success: true }
  })

  // Complete starter cards wizard
  ipcMain.handle('completeStarterCardsWizard', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }
    setOnboardingBool(payload.projectId, 'starterCardsCompleted', true)
    return { success: true }
  })

  // Dismiss GitHub project prompt
  ipcMain.handle('dismissGithubProjectPrompt', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }
    setOnboardingBool(payload.projectId, 'githubProjectDismissed', true)
    return { success: true }
  })

  // Reset GitHub project prompt
  ipcMain.handle('resetGithubProjectPrompt', (_e, payload: { projectId: string }) => {
    if (!payload?.projectId) return { error: 'Project ID required' }

    // Clear the dismissed flag
    setOnboardingBool(payload.projectId, 'githubProjectDismissed', false)

    // Also clear any existing projectId to allow re-detection or re-creation
    const project = getProject(payload.projectId)
    if (project) {
      const policy = parsePolicyJson(project.policy_json)
      if (policy.sync?.githubProjectsV2?.projectId) {
        delete policy.sync.githubProjectsV2.projectId
        // Also reset enabled to undefined (auto-detect)
        delete policy.sync.githubProjectsV2.enabled
        updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))
      }
    }

    notifyRenderer()
    return { success: true }
  })

  // List repo labels
  ipcMain.handle(
    'listRepoLabels',
    async (_e, payload: ListRepoLabelsPayload): Promise<ListRepoLabelsResult> => {
      if (!payload?.projectId) return { labels: [], error: 'Project ID required' }
      const project = getProject(payload.projectId)
      if (!project) return { labels: [], error: 'Project not found' }
      if (!project.remote_repo_key) return { labels: [], error: 'No remote configured' }

      const policy = parsePolicyJson(project.policy_json)
      try {
        // Use adapter registry to create adapter
        const adapter = AdapterRegistry.create({
          repoKey: project.remote_repo_key,
          providerHint: project.provider_hint,
          repoPath: project.local_path,
          policy
        })

        // LocalAdapter returns empty array, which is expected
        const labels = await adapter.listRepoLabels()
        return { labels }
      } catch (error) {
        return { labels: [], error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // Create repo labels
  ipcMain.handle(
    'createRepoLabels',
    async (_e, payload: CreateRepoLabelsPayload): Promise<CreateRepoLabelsResult> => {
      if (!payload?.projectId) return { created: [], skipped: [], error: 'Project ID required' }
      const project = getProject(payload.projectId)
      if (!project) return { created: [], skipped: [], error: 'Project not found' }
      if (!project.remote_repo_key)
        return { created: [], skipped: [], error: 'No remote configured' }

      const policy = parsePolicyJson(project.policy_json)
      const labelsToCreate = (payload.labels || []).filter((l) => (l.name || '').trim().length > 0)
      if (labelsToCreate.length === 0) return { created: [], skipped: [] }

      try {
        // Use adapter registry to create adapter
        const adapter = AdapterRegistry.create({
          repoKey: project.remote_repo_key,
          providerHint: project.provider_hint,
          repoPath: project.local_path,
          policy
        })

        const existing = await adapter.listRepoLabels()
        const created: string[] = []
        const skipped: string[] = []

        for (const label of labelsToCreate) {
          if (labelExists(label.name, existing)) {
            skipped.push(label.name)
            continue
          }
          const res = await adapter.createRepoLabel(label)
          if (res.created) created.push(label.name)
          else skipped.push(label.name)
        }

        return { created, skipped }
      } catch (error) {
        return { created: [], skipped: [], error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // Apply label config
  ipcMain.handle('applyLabelConfig', async (_e, payload: ApplyLabelConfigPayload) => {
    if (!payload?.projectId) return { error: 'Project ID required' }
    const project = getProject(payload.projectId)
    if (!project) return { error: 'Project not found' }

    const readyLabel = (payload.readyLabel || '').trim()
    const statusLabels = payload.statusLabels
    if (!readyLabel) return { error: 'Ready label is required' }
    if (
      !statusLabels?.draft ||
      !statusLabels.ready ||
      !statusLabels.inProgress ||
      !statusLabels.inReview ||
      !statusLabels.testing ||
      !statusLabels.done
    ) {
      return { error: 'All status labels are required' }
    }

    const policy = parsePolicyJson(project.policy_json)
    policy.sync = policy.sync ?? {}
    policy.sync.readyLabel = readyLabel
    policy.sync.statusLabels = statusLabels

    if (payload.createMissingLabels && project.remote_repo_key) {
      const requested: RepoLabel[] = [
        { name: readyLabel },
        { name: statusLabels.draft },
        { name: statusLabels.ready },
        { name: statusLabels.inProgress },
        { name: statusLabels.inReview },
        { name: statusLabels.testing },
        { name: statusLabels.done }
      ]

      try {
        // Use adapter registry to create adapter
        const adapter = AdapterRegistry.create({
          repoKey: project.remote_repo_key,
          providerHint: project.provider_hint,
          repoPath: project.local_path,
          policy
        })

        const existing = await adapter.listRepoLabels()
        for (const label of requested) {
          if (labelExists(label.name, existing)) continue
          await adapter.createRepoLabel(label)
        }
      } catch (error) {
        // Log but don't fail - label creation is optional
        console.warn('Failed to create missing labels:', error)
      }
    }

    updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))
    setOnboardingBool(payload.projectId, 'labelsCompleted', true)
    notifyRenderer()
    return { success: true, project: getProject(payload.projectId) }
  })

  // List GitHub Projects V2 linked to repository
  ipcMain.handle(
    'listGithubRepositoryProjects',
    async (_e, payload: { projectId: string }) => {
      if (!payload?.projectId) return { projects: [], error: 'Project ID required' }

      const project = getProject(payload.projectId)
      if (!project) return { projects: [], error: 'Project not found' }
      if (!project.remote_repo_key?.startsWith('github:'))
        return { projects: [], error: 'Project is not GitHub-backed' }

      const policy = parsePolicyJson(project.policy_json)

      try {
        const adapter = AdapterRegistry.create({
          repoKey: project.remote_repo_key,
          providerHint: project.provider_hint,
          repoPath: project.local_path,
          policy
        })

        // Check if adapter has listRepositoryProjects method (GitHub only)
        if ('listRepositoryProjects' in adapter && typeof adapter.listRepositoryProjects === 'function') {
          const projects = await (adapter as { listRepositoryProjects: () => Promise<Array<{ id: string; title: string; number: number }>> }).listRepositoryProjects()
          return { projects }
        }

        return { projects: [] }
      } catch (error) {
        return { projects: [], error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // Link an existing GitHub Project V2 to this project
  ipcMain.handle(
    'linkGithubProjectV2',
    async (_e, payload: { projectId: string; githubProjectId: string }) => {
      if (!payload?.projectId) return { error: 'Project ID required' }
      if (!payload?.githubProjectId) return { error: 'GitHub Project ID required' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }
      if (!project.remote_repo_key?.startsWith('github:'))
        return { error: 'Project is not GitHub-backed' }

      const policy = parsePolicyJson(project.policy_json)
      policy.sync = policy.sync ?? {}
      policy.sync.githubProjectsV2 = policy.sync.githubProjectsV2 ?? {}
      policy.sync.githubProjectsV2.enabled = true
      policy.sync.githubProjectsV2.projectId = payload.githubProjectId
      updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))

      setOnboardingBool(payload.projectId, 'githubProjectDismissed', true)
      notifyRenderer()
      return { success: true, projectId: payload.githubProjectId }
    }
  )

  // Create GitHub Project V2
  ipcMain.handle(
    'createGithubProjectV2',
    async (_e, payload: { projectId: string; title?: string }) => {
      if (!payload?.projectId) return { error: 'Project ID required' }

      const project = getProject(payload.projectId)
      if (!project) return { error: 'Project not found' }
      if (!project.remote_repo_key?.startsWith('github:'))
        return { error: 'Project is not GitHub-backed' }

      const policy = parsePolicyJson(project.policy_json)
      if (policy.sync?.githubProjectsV2?.enabled === false) {
        return { error: 'GitHub Projects integration is disabled by policy' }
      }

      const repoKey = project.remote_repo_key.replace(/^github:/, '')
      const [owner, repo] = repoKey.split('/')
      if (!owner || !repo) return { error: 'Invalid GitHub repo key' }

      const title = (payload.title || '').trim() || `${project.name} Kanban`

      try {
        const ownerQuery = `
          query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              owner { id login }
            }
          }
        `

        const ownerResRaw = await execCli(
          'gh',
          [
            'api',
            'graphql',
            '-f',
            `query=${ownerQuery}`,
            '-F',
            `owner=${owner}`,
            '-F',
            `repo=${repo}`
          ],
          project.local_path
        )
        const ownerRes = JSON.parse(ownerResRaw) as {
          data?: { repository?: { owner?: { id: string } } }
          errors?: { message: string }[]
        }
        const ownerId = ownerRes.data?.repository?.owner?.id
        if (!ownerId) {
          return { error: ownerRes.errors?.[0]?.message || 'Failed to resolve repository owner' }
        }

        const createMutation = `
          mutation($ownerId: ID!, $title: String!) {
            createProjectV2(input: { ownerId: $ownerId, title: $title }) {
              projectV2 { id url title }
            }
          }
        `

        const createResRaw = await execCli(
          'gh',
          [
            'api',
            'graphql',
            '-f',
            `query=${createMutation}`,
            '-F',
            `ownerId=${ownerId}`,
            '-F',
            `title=${title}`
          ],
          project.local_path
        )
        const createRes = JSON.parse(createResRaw) as {
          data?: { createProjectV2?: { projectV2?: { id: string; url?: string; title?: string } } }
          errors?: { message: string }[]
        }
        const created = createRes.data?.createProjectV2?.projectV2
        if (!created?.id) {
          return { error: createRes.errors?.[0]?.message || 'Failed to create GitHub Project' }
        }

        policy.sync = policy.sync ?? {}
        policy.sync.githubProjectsV2 = policy.sync.githubProjectsV2 ?? {}
        policy.sync.githubProjectsV2.enabled = true
        policy.sync.githubProjectsV2.projectId = created.id
        updateProjectPolicyJson(payload.projectId, JSON.stringify(policy))

        setOnboardingBool(payload.projectId, 'githubProjectDismissed', true)
        notifyRenderer()
        return { success: true, projectId: created.id, url: created.url, title: created.title }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
}
