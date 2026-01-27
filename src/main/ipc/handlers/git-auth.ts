import { ipcMain } from 'electron'
import type {
  GetGitAuthStatePayload,
  GetGitAuthStateResult,
  SetGitAuthModePayload,
  FixRemotePayload,
  TestGitAuthPayload
} from '@shared/types'
import { getProject } from '../../db/projects'
import { parsePolicyJson, mergePolicyUpdate } from '@shared/utils'
import { updateProjectPolicyJson } from '../../db'
import { applyPreferredAuth, detectGitAuthState } from '../../utils/git-auth'

export function registerGitAuthHandlers(): void {
  ipcMain.handle('gitAuth:getState', async (_e, payload: GetGitAuthStatePayload): Promise<GetGitAuthStateResult> => {
    const project = getProject(payload.projectId)
    if (!project) {
      return { success: false, state: { remoteUrl: null, protocol: 'unknown', host: null, hasCredentialHelper: false, hasGhAuth: false, hasGlabAuth: false, sshOk: false }, mode: 'auto', forceSshRewrite: false }
    }

    const policy = parsePolicyJson(project.policy_json)
    const mode = policy.repo?.gitAuth?.mode ?? 'auto'
    const forceSshRewrite = policy.repo?.gitAuth?.forceSshRewrite ?? false
    const state = await detectGitAuthState(project.local_path)

    return { success: true, state, mode, forceSshRewrite }
  })

  ipcMain.handle('gitAuth:setMode', async (_e, payload: SetGitAuthModePayload) => {
    const project = getProject(payload.projectId)
    if (!project) return { success: false, error: 'Project not found' }

    const policy = parsePolicyJson(project.policy_json)
    const updated = mergePolicyUpdate(policy, {
      repo: {
        gitAuth: {
          mode: payload.mode,
          forceSshRewrite: payload.forceSshRewrite ?? policy.repo?.gitAuth?.forceSshRewrite ?? false
        }
      }
    })
    updateProjectPolicyJson(payload.projectId, JSON.stringify(updated))
    return { success: true }
  })

  ipcMain.handle('gitAuth:fixRemote', async (_e, payload: FixRemotePayload) => {
    const project = getProject(payload.projectId)
    if (!project) return { success: false, error: 'Project not found' }
    const policy = parsePolicyJson(project.policy_json)
    const mode = policy.repo?.gitAuth?.mode ?? 'auto'
    const force = policy.repo?.gitAuth?.forceSshRewrite ?? true
    const result = await applyPreferredAuth(project.local_path, mode, force)
    if (result.error) return { success: false, error: result.error }
    return { success: true, newUrl: result.newUrl, state: result.state }
  })

  ipcMain.handle('gitAuth:test', async (_e, payload: TestGitAuthPayload) => {
    const project = getProject(payload.projectId)
    if (!project) return { success: false, error: 'Project not found' }
    const state = await detectGitAuthState(project.local_path)
    return { success: true, state }
  })
}
