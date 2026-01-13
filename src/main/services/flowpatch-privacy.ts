import { createHash } from 'crypto'
import type { FlowPatchPrivacyOverride, PrivacyMode } from './flowpatch-config'

export type PrivacyCategory = 'secrets' | 'privateKeys' | 'credentials' | 'localConfigs'

export interface PrivacyDecision {
  allowed: boolean
  reason: string
}

function globToRegExp(glob: string): RegExp {
  // Minimal glob support: **, *, ?
  // - ** matches any chars including /
  // - * matches any chars excluding /
  // - ? matches a single char excluding /
  const escaped = glob
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§DOUBLESTAR§§')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/§§DOUBLESTAR§§/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function normalizePath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\.?\//, '')
}

const CATEGORY_GLOBS: Record<PrivacyCategory, string[]> = {
  secrets: ['**/.env', '**/.env.*', '**/secrets/**', '**/*secret*', '**/*token*'],
  privateKeys: ['**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.kdbx'],
  credentials: ['**/.npmrc', '**/.netrc', '**/*.credentials*', '**/*credential*'],
  localConfigs: ['**/*.sqlite', '**/*.db', '**/*.log']
}

const DEFAULT_ALLOW_GLOBS = ['**/*.env.example', '**/*.env.sample', '**/*.env.template']

const DEFAULT_DENY_CATEGORIES_STANDARD: PrivacyCategory[] = [
  'secrets',
  'privateKeys',
  'credentials',
  'localConfigs'
]

const DEFAULT_DENY_CATEGORIES_STRICT: PrivacyCategory[] = DEFAULT_DENY_CATEGORIES_STANDARD

export interface EffectivePrivacyPolicy {
  mode: PrivacyMode
  allow: RegExp[]
  deny: RegExp[]
  denyCategories: PrivacyCategory[]
}

export function buildEffectivePrivacyPolicy(
  override?: FlowPatchPrivacyOverride
): EffectivePrivacyPolicy {
  const mode: PrivacyMode = override?.mode ?? 'standard'
  if (mode === 'off') {
    return { mode, allow: [], deny: [], denyCategories: [] }
  }

  const defaultCategories =
    mode === 'strict' ? DEFAULT_DENY_CATEGORIES_STRICT : DEFAULT_DENY_CATEGORIES_STANDARD
  const denyCategories = (
    override?.denyCategories?.length ? override.denyCategories : defaultCategories
  )
    .map((c) => String(c))
    .filter((c): c is PrivacyCategory => c in CATEGORY_GLOBS)

  const denyGlobs = [
    ...denyCategories.flatMap((c) => CATEGORY_GLOBS[c]),
    ...(override?.denyGlobs ?? [])
  ]
  const allowGlobs = [...DEFAULT_ALLOW_GLOBS, ...(override?.allowGlobs ?? [])]

  return {
    mode,
    allow: allowGlobs.map(globToRegExp),
    deny: denyGlobs.map(globToRegExp),
    denyCategories
  }
}

export function decidePathPrivacy(
  policy: EffectivePrivacyPolicy,
  relPathRaw: string
): PrivacyDecision {
  const relPath = normalizePath(relPathRaw)
  if (policy.mode === 'off') return { allowed: true, reason: 'privacy:off' }

  const allowedByAllow = policy.allow.some((r) => r.test(relPath))
  const deniedByDeny = policy.deny.some((r) => r.test(relPath))

  if (deniedByDeny && !allowedByAllow) return { allowed: false, reason: 'privacy:denied' }
  if (allowedByAllow) return { allowed: true, reason: 'privacy:allowlist' }
  return { allowed: true, reason: 'privacy:ok' }
}

export function stableId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}
