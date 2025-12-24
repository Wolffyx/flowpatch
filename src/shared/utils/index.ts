/**
 * Shared utility modules.
 * Re-exports all utilities for convenient importing.
 */

// ID generation
export { generateId, cryptoRandomId, cryptoId } from './id'

// Policy utilities
export {
  parsePolicyJson,
  mergePolicyUpdate,
  getStatusLabelFromPolicy,
  getAllStatusLabelsFromPolicy,
  isWorkerEnabled,
  getToolPreference
} from './policy'

// Git utilities
export type { GitProvider, ParsedRemoteUrl } from './git'
export {
  parseRemoteUrl,
  detectProviderFromRemote,
  parseRepoKey,
  isGitHubRepoKey,
  isGitLabRepoKey
} from './git'

// Label utilities
export {
  normalizeLabelName,
  normalizeLabelForMatching,
  labelExists,
  findMatchingLabel,
  extractStatusFromLabel,
  createStatusLabel
} from './label'

// Re-export logging from existing utils
export { logAction } from '../utils'
