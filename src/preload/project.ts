import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectAPI, ProjectInfo } from './interfaces/project'
import { createListener } from './utils'

const projectOpenedListeners = new Set<(info: ProjectInfo) => void>()
const projectClosingListeners = new Set<() => void>()
let lastProjectInfo: ProjectInfo | null = null

ipcRenderer.on('projectOpened', (_event, info: ProjectInfo) => {
  lastProjectInfo = info
  projectOpenedListeners.forEach((l) => l(info))
})

ipcRenderer.on('projectClosing', () => {
  lastProjectInfo = null
  projectClosingListeners.forEach((l) => l())
})

const getProjectId = (): string => {
  if (!lastProjectInfo?.projectId) throw new Error('No active project')
  return lastProjectInfo.projectId
}

const projectAPI: ProjectAPI = {
  onProjectOpened: (callback) => {
    projectOpenedListeners.add(callback)
    if (lastProjectInfo) {
      queueMicrotask(() => {
        if (lastProjectInfo && projectOpenedListeners.has(callback)) {
          callback(lastProjectInfo)
        }
      })
    }
    return () => projectOpenedListeners.delete(callback)
  },

  onProjectClosing: (callback) => {
    projectClosingListeners.add(callback)
    return () => projectClosingListeners.delete(callback)
  },

  getProject: (id) => ipcRenderer.invoke('getProject', { projectId: id }),

  getRepoOnboardingState: (id) => ipcRenderer.invoke('getRepoOnboardingState', { projectId: id }),

  getCards: () => ipcRenderer.invoke('project:getCards'),

  getCardLinks: () => ipcRenderer.invoke('project:getCardLinks'),

  moveCard: (id, status) => ipcRenderer.invoke('moveCard', { cardId: id, status }),

  ensureProjectRemote: (id) => ipcRenderer.invoke('ensureProjectRemote', { projectId: id }),

  createCard: async (data) => {
    const result = await ipcRenderer.invoke('createCard', {
      projectId: getProjectId(),
      title: data.title,
      body: data.body,
      createType: data.createType
    })
    if (result?.error) throw new Error(result.error)
    if (!result?.card) throw new Error('Failed to create card')
    return result.card
  },

  splitCard: (data) => ipcRenderer.invoke('splitCard', data),

  editCardBody: (id, body) => ipcRenderer.invoke('editCardBody', { cardId: id, body }),

  deleteCard: (id) => ipcRenderer.invoke('deleteCard', { cardId: id }),

  pushCardToRemote: (id) => ipcRenderer.invoke('pushCardToRemote', { cardId: id }),

  updateCardTimestamp: (id, timestamp) =>
    ipcRenderer.invoke('updateCardTimestamp', { cardId: id, timestamp }),

  sync: () => ipcRenderer.invoke('project:sync'),

  onSyncComplete: (cb) => createListener('syncComplete', cb),

  isWorkerEnabled: () => ipcRenderer.invoke('project:isWorkerEnabled'),

  toggleWorker: (enabled) => ipcRenderer.invoke('project:toggleWorker', { enabled }),

  runWorker: (id) => ipcRenderer.invoke('project:runWorker', { cardId: id }),

  cancelWorker: (id) => ipcRenderer.invoke('project:cancelWorker', { jobId: id }),

  getCardTestInfo: (projectId, id) =>
    ipcRenderer.invoke('getCardTestInfo', { projectId, cardId: id }),

  startDevServer: (params) => ipcRenderer.invoke('startDevServer', params),

  stopDevServer: (id) => ipcRenderer.invoke('stopDevServer', { cardId: id }),

  getDevServerStatus: (id) => ipcRenderer.invoke('getDevServerStatus', { cardId: id }),

  onDevServerOutput: (cb) =>
    createListener('dev-server:output', cb as (...args: unknown[]) => void),

  onDevServerStatus: (cb) =>
    createListener('dev-server:status', cb as (...args: unknown[]) => void),

  onDevServerPort: (cb) => createListener('dev-server:port', cb as (...args: unknown[]) => void),

  getPendingApprovals: () => {
    const projectId = lastProjectInfo?.projectId
    return ipcRenderer.invoke('getPendingApprovals', projectId ? { projectId } : undefined)
  },

  getPlanApproval: (params) => ipcRenderer.invoke('getPlanApproval', params),

  approvePlan: (id, notes) => ipcRenderer.invoke('approvePlan', { approvalId: id, notes }),

  rejectPlan: (id, notes) => ipcRenderer.invoke('rejectPlan', { approvalId: id, notes }),

  skipPlanApproval: (id) => ipcRenderer.invoke('skipPlanApproval', { approvalId: id }),

  onPlanApprovalRequired: (cb) =>
    createListener('planApprovalRequired', cb as (...args: unknown[]) => void),

  getFollowUpInstructions: (params) => {
    return ipcRenderer.invoke('getFollowUpInstructions', { ...params, projectId: getProjectId() })
  },

  createFollowUpInstruction: (data) => {
    return ipcRenderer.invoke('createFollowUpInstruction', { ...data, projectId: getProjectId() })
  },

  deleteFollowUpInstruction: (id) =>
    ipcRenderer.invoke('deleteFollowUpInstruction', { instructionId: id }),

  countPendingInstructions: (id) => ipcRenderer.invoke('countPendingInstructions', { jobId: id }),

  getTotalUsage: () => ipcRenderer.invoke('usage:getTotal'),

  getUsageWithLimits: () => ipcRenderer.invoke('usage:getWithLimits'),

  setToolLimits: (toolType, limits) =>
    ipcRenderer.invoke('usage:setToolLimits', {
      toolType,
      hourlyTokenLimit: limits.hourlyTokenLimit,
      dailyTokenLimit: limits.dailyTokenLimit,
      monthlyTokenLimit: limits.monthlyTokenLimit,
      hourlyCostLimitUsd: limits.hourlyCostLimitUsd,
      dailyCostLimitUsd: limits.dailyCostLimitUsd,
      monthlyCostLimitUsd: limits.monthlyCostLimitUsd
    }),

  getDiffFiles: (id) => ipcRenderer.invoke('diff:getFiles', id),

  getDiffStats: (id) => ipcRenderer.invoke('diff:getStats', id),

  getFileDiff: (id, path) => ipcRenderer.invoke('diff:getFileDiff', id, path),

  getUnifiedDiff: (id, path) => ipcRenderer.invoke('diff:getUnifiedDiff', id, path),

  sendChatMessage: (params) => {
    return ipcRenderer.invoke('chat:sendMessage', { ...params, projectId: getProjectId() })
  },

  getChatMessages: (id, limit) => ipcRenderer.invoke('chat:getMessages', { jobId: id, limit }),

  getChatMessagesByCard: (id, limit) =>
    ipcRenderer.invoke('chat:getMessagesByCard', { cardId: id, limit }),

  getChatSummary: (id) => ipcRenderer.invoke('chat:getSummary', id),

  getChatUnreadCount: (id) => ipcRenderer.invoke('chat:getUnreadCount', id),

  markChatAsRead: (id) => ipcRenderer.invoke('chat:markAsRead', id),

  clearChatHistory: (id) => ipcRenderer.invoke('chat:clearHistory', id),

  onChatMessage: (cb) => createListener('agentChatMessage', cb as (...args: unknown[]) => void),

  getAIProfiles: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.resolve({ profiles: [], error: 'No active project' })
    return ipcRenderer.invoke('aiProfiles:list', projectId)
  },

  getAIProfile: (id) => ipcRenderer.invoke('aiProfiles:get', id),

  getDefaultAIProfile: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.resolve({ profile: null, error: 'No active project' })
    return ipcRenderer.invoke('aiProfiles:getDefault', projectId)
  },

  createAIProfile: (data) => {
    return ipcRenderer.invoke('aiProfiles:create', { ...data, projectId: getProjectId() })
  },

  updateAIProfile: (id, data) => ipcRenderer.invoke('aiProfiles:update', { profileId: id, data }),

  deleteAIProfile: (id) => ipcRenderer.invoke('aiProfiles:delete', id),

  setDefaultAIProfile: (id) => ipcRenderer.invoke('aiProfiles:setDefault', id),

  duplicateAIProfile: (id, name) =>
    ipcRenderer.invoke('aiProfiles:duplicate', { profileId: id, newName: name }),

  getFeatureSuggestions: (options) => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.resolve({ suggestions: [], error: 'No active project' })
    return ipcRenderer.invoke('featureSuggestions:list', { projectId, ...options })
  },

  getFeatureSuggestion: (id) => ipcRenderer.invoke('featureSuggestions:get', id),

  createFeatureSuggestion: (data) => {
    return ipcRenderer.invoke('featureSuggestions:create', { ...data, projectId: getProjectId() })
  },

  updateFeatureSuggestion: (id, data) =>
    ipcRenderer.invoke('featureSuggestions:update', { suggestionId: id, data }),

  updateFeatureSuggestionStatus: (id, status) =>
    ipcRenderer.invoke('featureSuggestions:updateStatus', { suggestionId: id, status }),

  deleteFeatureSuggestion: (id) => ipcRenderer.invoke('featureSuggestions:delete', id),

  voteOnSuggestion: (id, voteType, voterId) =>
    ipcRenderer.invoke('featureSuggestions:vote', { suggestionId: id, voteType, voterId }),

  getUserVote: (id, voterId) =>
    ipcRenderer.invoke('featureSuggestions:getUserVote', { suggestionId: id, voterId }),

  createDependency: (data) => {
    return ipcRenderer.invoke('dependencies:create', { ...data, projectId: getProjectId() })
  },

  getDependency: (id) => ipcRenderer.invoke('dependencies:get', id),

  getDependenciesForCard: (id) => ipcRenderer.invoke('dependencies:getForCard', id),

  getDependenciesForCardWithCards: (id) =>
    ipcRenderer.invoke('dependencies:getForCardWithCards', id),

  getDependentsOfCard: (id) => ipcRenderer.invoke('dependencies:getDependents', id),

  getDependenciesByProject: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.resolve({ dependencies: [], error: 'No active project' })
    return ipcRenderer.invoke('dependencies:getByProject', projectId)
  },

  countDependenciesForCard: (id) => ipcRenderer.invoke('dependencies:countForCard', id),

  checkCanMoveToStatus: (id, status) =>
    ipcRenderer.invoke('dependencies:checkCanMove', { cardId: id, targetStatus: status }),

  checkWouldCreateCycle: (id, dependsOnId) =>
    ipcRenderer.invoke('dependencies:checkCycle', { cardId: id, dependsOnCardId: dependsOnId }),

  updateDependency: (id, data) =>
    ipcRenderer.invoke('dependencies:update', { dependencyId: id, data }),

  toggleDependency: (id, isActive) =>
    ipcRenderer.invoke('dependencies:toggle', { dependencyId: id, isActive }),

  deleteDependency: (id) => ipcRenderer.invoke('dependencies:delete', id),

  deleteDependencyBetween: (id, dependsOnId) =>
    ipcRenderer.invoke('dependencies:deleteBetween', { cardId: id, dependsOnCardId: dependsOnId }),

  onStateUpdate: (cb) => createListener('stateUpdated', cb),

  onWorkerLog: (cb) => createListener('workerLog', cb as (...args: unknown[]) => void),

  getJobs: () => ipcRenderer.invoke('project:getJobs'),

  getEvents: (limit) => ipcRenderer.invoke('project:getEvents', { limit }),

  getWorkspaceStatus: () => ipcRenderer.invoke('project:getWorkspaceStatus'),

  ensureWorkspace: () => ipcRenderer.invoke('project:ensureWorkspace'),

  indexBuild: () => ipcRenderer.invoke('project:indexBuild'),

  indexRefresh: () => ipcRenderer.invoke('project:indexRefresh'),

  indexWatchStart: () => ipcRenderer.invoke('project:indexWatchStart'),

  indexWatchStop: () => ipcRenderer.invoke('project:indexWatchStop'),

  validateConfig: () => ipcRenderer.invoke('project:validateConfig'),

  docsRefresh: () => ipcRenderer.invoke('project:docsRefresh'),

  contextPreview: (task) => ipcRenderer.invoke('project:contextPreview', { task }),

  repairWorkspace: () => ipcRenderer.invoke('project:repairWorkspace'),

  migrateWorkspace: () => ipcRenderer.invoke('project:migrateWorkspace'),

  openWorkspaceFolder: () => ipcRenderer.invoke('project:openWorkspaceFolder'),

  retrieve: (kind, query, limit) => ipcRenderer.invoke('project:retrieve', { kind, query, limit }),

  getFlowPatchConfig: () => ipcRenderer.invoke('project:getFlowPatchConfig'),

  createPlanFile: () => ipcRenderer.invoke('project:createPlanFile'),

  syncConfig: (priorityOverride) => {
    return ipcRenderer.invoke('syncProjectConfig', { projectId: getProjectId(), priorityOverride })
  },

  getConfig: () => ipcRenderer.invoke('getProjectConfig', { projectId: getProjectId() }),

  updateFeatureConfig: (key, config) => {
    return ipcRenderer.invoke('updateFeatureConfig', {
      projectId: getProjectId(),
      featureKey: key,
      config
    })
  },

  getConfigSyncPriority: () =>
    ipcRenderer.invoke('getConfigSyncPriority', { projectId: getProjectId() }),

  setConfigSyncPriority: (priority) =>
    ipcRenderer.invoke('setConfigSyncPriority', { projectId: getProjectId(), priority }),

  startConfigWatcher: () =>
    ipcRenderer.invoke('startConfigFileWatcher', { projectId: getProjectId() }),

  stopConfigWatcher: () =>
    ipcRenderer.invoke('stopConfigFileWatcher', { projectId: getProjectId() }),

  onConfigChanged: (cb) => createListener('configChanged', cb as (...args: unknown[]) => void),

  // Diagnostic methods for debugging worker issues
  getCardEligibilityDiagnostic: (cardId: string) => {
    const projectId = lastProjectInfo?.projectId
    return ipcRenderer.invoke('getCardEligibilityDiagnostic', { cardId, projectId })
  },

  getReadyCardsNotProcessing: () => {
    const projectId = lastProjectInfo?.projectId
    if (!projectId) return Promise.resolve({ diagnostics: [], error: 'No active project' })
    return ipcRenderer.invoke('getReadyCardsNotProcessing', { projectId })
  }
}

const allowedInvokeChannels = [
  'getThemePreference',
  'setThemePreference',
  'getSystemTheme',
  'generateCardDescription',
  'generateCardList',
  'generateSplitCards',
  'listWorktrees',
  'openWorktreeFolder',
  'removeWorktree',
  'recreateWorktree',
  'getCardTestInfo',
  'startDevServer',
  'stopDevServer',
  'getDevServerStatus',
  'getRepoOnboardingState',
  'listRepoLabels',
  'applyLabelConfig',
  'dismissLabelWizard',
  'dismissStarterCardsWizard',
  'completeStarterCardsWizard',
  'dismissGithubProjectPrompt',
  'createGithubProjectV2',
  'listGithubRepositoryProjects',
  'linkGithubProjectV2',
  'getSyncSchedulerStatus',
  'getCardEligibilityDiagnostic',
  'getReadyCardsNotProcessing'
]

const allowedSendChannels = ['openExternal']

const allowedOnChannels = [
  'themeChanged',
  'dev-server:output',
  'dev-server:status',
  'dev-server:port'
]

const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      if (!allowedInvokeChannels.includes(channel))
        throw new Error(`Channel ${channel} not allowed`)
      return ipcRenderer.invoke(channel, ...args)
    },
    send: (channel: string, ...args: unknown[]) => {
      if (!allowedSendChannels.includes(channel)) throw new Error(`Channel ${channel} not allowed`)
      ipcRenderer.send(channel, ...args)
    },
    on: (channel: string, cb: (...args: unknown[]) => void) => {
      if (!allowedOnChannels.includes(channel))
        throw new Error(`Channel ${channel} not allowed for on()`)
      ipcRenderer.on(channel, cb)
    },
    removeListener: (channel: string, cb: (...args: unknown[]) => void) => {
      if (!allowedOnChannels.includes(channel))
        throw new Error(`Channel ${channel} not allowed for removeListener()`)
      ipcRenderer.removeListener(channel, cb)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('projectAPI', projectAPI)
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error('Failed to expose projectAPI:', error)
  }
} else {
  // @ts-ignore
  window.projectAPI = projectAPI
  // @ts-ignore
  window.electron = electronAPI
}
