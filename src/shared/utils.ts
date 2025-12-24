/**
 * Shared Utilities
 *
 * Re-exports all utilities from the utils directory.
 */

// Logging utility (original)
export const logAction = (action: string, payload?: unknown): void => {
  const timestamp = new Date().toISOString()
  if (payload !== undefined) {
    console.log(`[Main][${timestamp}] ${action}`, payload)
  } else {
    console.log(`[Main][${timestamp}] ${action}`)
  }
}

// Re-export from utils directory modules
export { generateId, cryptoRandomId, cryptoId } from './utils/id'

export {
  parsePolicyJson,
  mergePolicyUpdate,
  getStatusLabelFromPolicy,
  getAllStatusLabelsFromPolicy,
  isWorkerEnabled,
  getToolPreference
} from './utils/policy'

export type { GitProvider, ParsedRemoteUrl } from './utils/git'
export {
  parseRemoteUrl,
  detectProviderFromRemote,
  parseRepoKey,
  isGitHubRepoKey,
  isGitLabRepoKey
} from './utils/git'

export {
  normalizeLabelName,
  normalizeLabelForMatching,
  labelExists,
  findMatchingLabel,
  extractStatusFromLabel,
  createStatusLabel
} from './utils/label'
