import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import YAML from 'yaml'

export type PrivacyMode = 'strict' | 'standard' | 'off'

export interface PatchworkBudgets {
  maxFiles: number
  maxLinesPerFile: number
  maxTotalLines: number
  maxTotalBytes?: number
}

export interface PatchworkPrivacyOverride {
  mode?: PrivacyMode
  denyCategories?: string[]
  allowGlobs?: string[]
  denyGlobs?: string[]
}

export interface PatchworkConfig {
  schemaVersion: number
  generatedBy?: string
  budgets: PatchworkBudgets
  privacy?: PatchworkPrivacyOverride
  workspaces?: string[]
  approval?: {
    confirmIndexBuild?: boolean
    confirmIndexRefresh?: boolean
    confirmWatchToggle?: boolean
    confirmDocsRefresh?: boolean
    confirmContextPreview?: boolean
    confirmRepair?: boolean
    confirmMigrate?: boolean
  }
}

export interface PatchworkConfigDiagnostics {
  errors: string[]
  warnings: string[]
}

export const DEFAULT_BUDGETS: PatchworkBudgets = {
  maxFiles: 12,
  maxLinesPerFile: 200,
  maxTotalLines: 1200,
  maxTotalBytes: 250_000
}

export function readPatchworkConfig(repoRoot: string): {
  config: PatchworkConfig
  diagnostics: PatchworkConfigDiagnostics
} {
  const errors: string[] = []
  const warnings: string[] = []

  const configPath = join(repoRoot, '.patchwork', 'config.yml')
  if (!existsSync(configPath)) {
    warnings.push('Missing .patchwork/config.yml; using defaults')
    return {
      config: { schemaVersion: 1, budgets: { ...DEFAULT_BUDGETS } },
      diagnostics: { errors, warnings }
    }
  }

  let parsed: any
  try {
    parsed = YAML.parse(readFileSync(configPath, 'utf-8'))
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Failed to parse YAML')
    return {
      config: { schemaVersion: 1, budgets: { ...DEFAULT_BUDGETS } },
      diagnostics: { errors, warnings }
    }
  }

  const schemaVersion = Number(parsed?.schemaVersion ?? 1)
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
    warnings.push('Invalid schemaVersion; using 1')
  }

  const budgetsRaw = parsed?.budgets ?? {}
  const budgets: PatchworkBudgets = {
    maxFiles: Number(budgetsRaw.maxFiles ?? DEFAULT_BUDGETS.maxFiles),
    maxLinesPerFile: Number(budgetsRaw.maxLinesPerFile ?? DEFAULT_BUDGETS.maxLinesPerFile),
    maxTotalLines: Number(budgetsRaw.maxTotalLines ?? DEFAULT_BUDGETS.maxTotalLines),
    maxTotalBytes:
      budgetsRaw.maxTotalBytes != null
        ? Number(budgetsRaw.maxTotalBytes)
        : DEFAULT_BUDGETS.maxTotalBytes
  }

  if (!Number.isFinite(budgets.maxFiles) || budgets.maxFiles <= 0)
    errors.push('budgets.maxFiles must be > 0')
  if (!Number.isFinite(budgets.maxLinesPerFile) || budgets.maxLinesPerFile <= 0)
    errors.push('budgets.maxLinesPerFile must be > 0')
  if (!Number.isFinite(budgets.maxTotalLines) || budgets.maxTotalLines <= 0)
    errors.push('budgets.maxTotalLines must be > 0')
  if (
    budgets.maxTotalBytes != null &&
    (!Number.isFinite(budgets.maxTotalBytes) || budgets.maxTotalBytes <= 0)
  ) {
    errors.push('budgets.maxTotalBytes must be > 0')
  }

  let privacy: PatchworkPrivacyOverride | undefined
  if (parsed?.privacy && typeof parsed.privacy === 'object') {
    const mode = parsed.privacy.mode as PrivacyMode | undefined
    if (mode && mode !== 'strict' && mode !== 'standard' && mode !== 'off') {
      warnings.push('privacy.mode must be strict|standard|off; ignoring')
    }
    privacy = {
      mode: mode === 'strict' || mode === 'standard' || mode === 'off' ? mode : undefined,
      denyCategories: Array.isArray(parsed.privacy.denyCategories)
        ? parsed.privacy.denyCategories.map(String)
        : undefined,
      allowGlobs: Array.isArray(parsed.privacy.allowGlobs)
        ? parsed.privacy.allowGlobs.map(String)
        : undefined,
      denyGlobs: Array.isArray(parsed.privacy.denyGlobs)
        ? parsed.privacy.denyGlobs.map(String)
        : undefined
    }
  }

  const workspaces = Array.isArray(parsed?.workspaces)
    ? parsed.workspaces.map(String).filter(Boolean)
    : undefined

  const approvalRaw = parsed?.approval
  const approval =
    approvalRaw && typeof approvalRaw === 'object'
      ? {
          confirmIndexBuild:
            typeof approvalRaw.confirmIndexBuild === 'boolean'
              ? approvalRaw.confirmIndexBuild
              : true,
          confirmIndexRefresh:
            typeof approvalRaw.confirmIndexRefresh === 'boolean'
              ? approvalRaw.confirmIndexRefresh
              : true,
          confirmWatchToggle:
            typeof approvalRaw.confirmWatchToggle === 'boolean'
              ? approvalRaw.confirmWatchToggle
              : true,
          confirmDocsRefresh:
            typeof approvalRaw.confirmDocsRefresh === 'boolean'
              ? approvalRaw.confirmDocsRefresh
              : true,
          confirmContextPreview:
            typeof approvalRaw.confirmContextPreview === 'boolean'
              ? approvalRaw.confirmContextPreview
              : true,
          confirmRepair:
            typeof approvalRaw.confirmRepair === 'boolean' ? approvalRaw.confirmRepair : true,
          confirmMigrate:
            typeof approvalRaw.confirmMigrate === 'boolean' ? approvalRaw.confirmMigrate : true
        }
      : {
          confirmIndexBuild: true,
          confirmIndexRefresh: true,
          confirmWatchToggle: true,
          confirmDocsRefresh: true,
          confirmContextPreview: true,
          confirmRepair: true,
          confirmMigrate: true
        }

  return {
    config: {
      schemaVersion: Number.isFinite(schemaVersion) && schemaVersion >= 1 ? schemaVersion : 1,
      generatedBy: typeof parsed?.generatedBy === 'string' ? parsed.generatedBy : undefined,
      budgets,
      privacy,
      workspaces,
      approval
    },
    diagnostics: { errors, warnings }
  }
}
