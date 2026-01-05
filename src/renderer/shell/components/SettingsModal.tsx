/**
 * Settings Modal Component
 *
 * Sidebar-style settings dialog matching the original SettingsDialog design:
 * - Appearance: Theme settings
 * - Features: Board settings, cancel behavior, repo integration
 * - Shortcuts: Keyboard shortcuts editor
 * - AI Agents: Tool preference, API keys
 * - Danger Zone: Unlink project
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../src/components/ui/dialog'
import { Button } from '../../src/components/ui/button'
import { Switch } from '../../src/components/ui/switch'
import { Input } from '../../src/components/ui/input'
import { ScrollArea } from '../../src/components/ui/scroll-area'
import { cn } from '../../src/lib/utils'
import {
  Sun,
  Moon,
  Monitor,
  Palette,
  Settings2,
  Key,
  Bot,
  AlertTriangle,
  Unlink,
  Sparkles,
  Code,
  Check,
  Loader2,
  Eye,
  EyeOff,
  Brain,
  Zap,
  ClipboardList,
  Users,
  User,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Star,
  Volume2,
  VolumeX,
  RefreshCw
} from 'lucide-react'
import { ShortcutsEditor } from '../../src/components/ShortcutsEditor'
import type { ShortcutBinding } from '@shared/shortcuts'
import type { Project, ThinkingMode, PlanningMode, PolicyConfig, MergeStrategy, ConflictResolution, AIProfile, AIModelProvider } from '@shared/types'

type SettingsSection = 'appearance' | 'features' | 'shortcuts' | 'ai-agents' | 'usage-limits' | 'danger-zone'
type ThemePreference = 'light' | 'dark' | 'system'
type WorkerToolPreference = 'auto' | 'claude' | 'codex'

interface ThinkingSettings {
  enabled: boolean
  mode: ThinkingMode
  budgetTokens: number | undefined
}

interface PlanningSettings {
  enabled: boolean
  mode: PlanningMode
  approvalRequired: boolean
}

function readThinkingSettings(project: Project | null): ThinkingSettings {
  const defaults: ThinkingSettings = {
    enabled: true,
    mode: 'medium',
    budgetTokens: undefined
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy?.features?.thinking?.enabled ?? defaults.enabled,
      mode: policy?.features?.thinking?.mode ?? defaults.mode,
      budgetTokens: policy?.features?.thinking?.budgetTokens ?? defaults.budgetTokens
    }
  } catch {
    return defaults
  }
}

function readPlanningSettings(project: Project | null): PlanningSettings {
  const defaults: PlanningSettings = {
    enabled: true,
    mode: 'lite',
    approvalRequired: false
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy?.features?.planning?.enabled ?? defaults.enabled,
      mode: policy?.features?.planning?.mode ?? defaults.mode,
      approvalRequired: policy?.features?.planning?.approvalRequired ?? defaults.approvalRequired
    }
  } catch {
    return defaults
  }
}

interface MultiAgentSettings {
  enabled: boolean
  mergeStrategy: MergeStrategy
  conflictResolution: ConflictResolution
  maxAgentsPerCard: number | undefined
}

function readMultiAgentSettings(project: Project | null): MultiAgentSettings {
  const defaults: MultiAgentSettings = {
    enabled: false,
    mergeStrategy: 'sequential',
    conflictResolution: 'auto',
    maxAgentsPerCard: undefined
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy?.features?.multiAgent?.enabled ?? defaults.enabled,
      mergeStrategy: policy?.features?.multiAgent?.mergeStrategy ?? defaults.mergeStrategy,
      conflictResolution: policy?.features?.multiAgent?.conflictResolution ?? defaults.conflictResolution,
      maxAgentsPerCard: policy?.features?.multiAgent?.maxAgentsPerCard ?? defaults.maxAgentsPerCard
    }
  } catch {
    return defaults
  }
}

interface E2ESettings {
  enabled: boolean
  maxRetries: number
  timeoutMinutes: number
  createTestsIfMissing: boolean
  testCommand: string
}

function readE2ESettings(project: Project | null): E2ESettings {
  const defaults: E2ESettings = {
    enabled: false,
    maxRetries: 3,
    timeoutMinutes: 10,
    createTestsIfMissing: true,
    testCommand: ''
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      enabled: policy?.worker?.e2e?.enabled ?? defaults.enabled,
      maxRetries: policy?.worker?.e2e?.maxRetries ?? defaults.maxRetries,
      timeoutMinutes: policy?.worker?.e2e?.timeoutMinutes ?? defaults.timeoutMinutes,
      createTestsIfMissing: policy?.worker?.e2e?.createTestsIfMissing ?? defaults.createTestsIfMissing,
      testCommand: policy?.worker?.e2e?.testCommand ?? defaults.testCommand
    }
  } catch {
    return defaults
  }
}

interface NotificationsSettings {
  audioEnabled: boolean
  soundOnComplete: boolean
  soundOnError: boolean
  soundOnApproval: boolean
}

function readNotificationsSettings(project: Project | null): NotificationsSettings {
  const defaults: NotificationsSettings = {
    audioEnabled: false,
    soundOnComplete: true,
    soundOnError: true,
    soundOnApproval: true
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      audioEnabled: policy?.features?.notifications?.audioEnabled ?? defaults.audioEnabled,
      soundOnComplete: policy?.features?.notifications?.soundOnComplete ?? defaults.soundOnComplete,
      soundOnError: policy?.features?.notifications?.soundOnError ?? defaults.soundOnError,
      soundOnApproval: policy?.features?.notifications?.soundOnApproval ?? defaults.soundOnApproval
    }
  } catch {
    return defaults
  }
}

interface SyncSettings {
  pollInterval: number
  autoSyncOnAction: boolean
}

function readSyncSettings(project: Project | null): SyncSettings {
  const defaults: SyncSettings = {
    pollInterval: 180000,
    autoSyncOnAction: true
  }
  if (!project?.policy_json) return defaults
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return {
      pollInterval: policy?.sync?.pollInterval ?? defaults.pollInterval,
      autoSyncOnAction: policy?.sync?.autoSyncOnAction ?? defaults.autoSyncOnAction
    }
  } catch {
    return defaults
  }
}

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
}

interface ToolLimitsState {
  hourlyTokenLimit: string
  dailyTokenLimit: string
  monthlyTokenLimit: string
  hourlyCostLimit: string
  dailyCostLimit: string
  monthlyCostLimit: string
}

const SETTINGS_SECTIONS: {
  id: SettingsSection
  label: string
  icon: typeof Palette
}[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'features', label: 'Features', icon: Settings2 },
  { id: 'shortcuts', label: 'Shortcuts', icon: Key },
  { id: 'ai-agents', label: 'AI Agents', icon: Bot },
  { id: 'usage-limits', label: 'Usage & Limits', icon: Zap },
  { id: 'danger-zone', label: 'Danger Zone', icon: AlertTriangle }
]

export function SettingsModal({
  open,
  onOpenChange,
  project
}: SettingsModalProps): React.JSX.Element {
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const [themePreference, setThemePreference] = useState<ThemePreference>('system')
  const [shortcuts, setShortcuts] = useState<ShortcutBinding[]>([])
  const [shortcutsLoading, setShortcutsLoading] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Project-specific settings
  const [toolPreference, setToolPreference] = useState<WorkerToolPreference>('auto')
  const [rollbackOnCancel, setRollbackOnCancel] = useState(false)
  const [baseBranch, setBaseBranch] = useState('')
  const [showPullRequestsSection, setShowPullRequestsSection] = useState(false)

  // API Keys
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [savingAnthropicKey, setSavingAnthropicKey] = useState(false)
  const [savingOpenaiKey, setSavingOpenaiKey] = useState(false)
  const [savingBaseBranch, setSavingBaseBranch] = useState(false)

  // Unlink confirmation
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)

  // Thinking mode state
  const [thinkingEnabled, setThinkingEnabled] = useState(
    () => readThinkingSettings(project).enabled
  )
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(
    () => readThinkingSettings(project).mode
  )
  const [thinkingBudgetTokens, setThinkingBudgetTokens] = useState<string>(
    () => readThinkingSettings(project).budgetTokens?.toString() || ''
  )

  // Planning mode state
  const [planningEnabled, setPlanningEnabled] = useState(
    () => readPlanningSettings(project).enabled
  )
  const [planningMode, setPlanningMode] = useState<PlanningMode>(
    () => readPlanningSettings(project).mode
  )
  const [planApprovalRequired, setPlanApprovalRequired] = useState(
    () => readPlanningSettings(project).approvalRequired
  )

  // Multi-Agent state
  const [multiAgentEnabled, setMultiAgentEnabled] = useState(
    () => readMultiAgentSettings(project).enabled
  )
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>(
    () => readMultiAgentSettings(project).mergeStrategy
  )
  const [conflictResolution, setConflictResolution] = useState<ConflictResolution>(
    () => readMultiAgentSettings(project).conflictResolution
  )
  const [maxAgentsPerCard, setMaxAgentsPerCard] = useState<string>(
    () => readMultiAgentSettings(project).maxAgentsPerCard?.toString() || ''
  )

  // E2E Testing state
  const [e2eEnabled, setE2eEnabled] = useState(() => readE2ESettings(project).enabled)
  const [e2eMaxRetries, setE2eMaxRetries] = useState(() => readE2ESettings(project).maxRetries)
  const [e2eTimeoutMinutes, setE2eTimeoutMinutes] = useState(
    () => readE2ESettings(project).timeoutMinutes
  )
  const [e2eCreateTestsIfMissing, setE2eCreateTestsIfMissing] = useState(
    () => readE2ESettings(project).createTestsIfMissing
  )
  const [e2eTestCommand, setE2eTestCommand] = useState(
    () => readE2ESettings(project).testCommand
  )

  // Audio notifications state
  const [audioEnabled, setAudioEnabled] = useState(
    () => readNotificationsSettings(project).audioEnabled
  )
  const [soundOnComplete, setSoundOnComplete] = useState(
    () => readNotificationsSettings(project).soundOnComplete
  )
  const [soundOnError, setSoundOnError] = useState(
    () => readNotificationsSettings(project).soundOnError
  )
  const [soundOnApproval, setSoundOnApproval] = useState(
    () => readNotificationsSettings(project).soundOnApproval
  )

  // Sync settings state
  const [syncPollInterval, setSyncPollInterval] = useState(
    () => Math.round(readSyncSettings(project).pollInterval / 60000)
  )
  const [autoSyncOnAction, setAutoSyncOnAction] = useState(
    () => readSyncSettings(project).autoSyncOnAction
  )

  // Usage Limits state
  const [claudeLimits, setClaudeLimits] = useState<ToolLimitsState>({
    hourlyTokenLimit: '',
    dailyTokenLimit: '',
    monthlyTokenLimit: '',
    hourlyCostLimit: '',
    dailyCostLimit: '',
    monthlyCostLimit: ''
  })
  const [codexLimits, setCodexLimits] = useState<ToolLimitsState>({
    hourlyTokenLimit: '',
    dailyTokenLimit: '',
    monthlyTokenLimit: '',
    hourlyCostLimit: '',
    dailyCostLimit: '',
    monthlyCostLimit: ''
  })
  const [limitsLoading, setLimitsLoading] = useState(false)
  const [savingLimits, setSavingLimits] = useState(false)

  // AI Profiles state
  const [aiProfiles, setAiProfiles] = useState<AIProfile[]>([])
  const [aiProfilesLoading, setAiProfilesLoading] = useState(false)
  const [editingProfile, setEditingProfile] = useState<AIProfile | null>(null)
  const [isCreatingProfile, setIsCreatingProfile] = useState(false)
  const [profileFormData, setProfileFormData] = useState<{
    name: string
    description: string
    modelProvider: AIModelProvider
    modelName: string
    temperature: string
    maxTokens: string
    topP: string
    systemPrompt: string
    thinkingEnabled: boolean
    thinkingMode: ThinkingMode
    thinkingBudgetTokens: string
    planningEnabled: boolean
    planningMode: PlanningMode
  }>({
    name: '',
    description: '',
    modelProvider: 'auto',
    modelName: '',
    temperature: '',
    maxTokens: '',
    topP: '',
    systemPrompt: '',
    thinkingEnabled: false,
    thinkingMode: 'medium',
    thinkingBudgetTokens: '',
    planningEnabled: false,
    planningMode: 'lite'
  })
  const [savingProfile, setSavingProfile] = useState(false)

  const supportsShortcuts =
    typeof window.shellAPI.getShortcuts === 'function' &&
    typeof window.shellAPI.setShortcuts === 'function' &&
    typeof window.shellAPI.onShortcutsUpdated === 'function'

  // Reset to appearance section when dialog opens
  useEffect(() => {
    if (open) {
      setActiveSection('appearance')
      setShowUnlinkConfirm(false)
      loadSettings()
    }
  }, [open])

  // Load shortcuts when section is selected
  useEffect(() => {
    if (!open || activeSection !== 'shortcuts') return
    loadShortcuts()
  }, [open, activeSection])

  // Subscribe to shortcut updates
  useEffect(() => {
    if (!open || !supportsShortcuts) return
    return window.shellAPI.onShortcutsUpdated(async () => {
      const shortcutsData = await window.shellAPI.getShortcuts()
      setShortcuts(shortcutsData)
    })
  }, [open, supportsShortcuts])

  const loadSettings = async (): Promise<void> => {
    setIsLoading(true)
    try {
      const theme = await window.shellAPI.getThemePreference()
      setThemePreference(theme)

      // Load API keys
      try {
        const anthropic = await window.electron.ipcRenderer.invoke('getApiKey', {
          key: 'anthropic'
        })
        const openai = await window.electron.ipcRenderer.invoke('getApiKey', { key: 'openai' })
        setAnthropicApiKey(anthropic || '')
        setOpenaiApiKey(openai || '')
      } catch {
        // API keys feature may not be implemented yet
      }

      // Load project-specific settings if project is selected
      if (project) {
        loadProjectSettings(project)
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadProjectSettings = (proj: Project): void => {
    if (!proj.policy_json) {
      setToolPreference('auto')
      setRollbackOnCancel(false)
      setBaseBranch('')
      setShowPullRequestsSection(false)
      return
    }
    try {
      const policy = JSON.parse(proj.policy_json)
      const pref = policy?.worker?.toolPreference
      if (pref === 'claude' || pref === 'codex' || pref === 'auto') {
        setToolPreference(pref)
      } else {
        setToolPreference('auto')
      }
      setRollbackOnCancel(!!policy?.worker?.rollbackOnCancel)
      const configuredBaseBranch =
        (policy?.worker?.baseBranch || policy?.worker?.worktree?.baseBranch || '').trim()
      setBaseBranch(configuredBaseBranch)
      setShowPullRequestsSection(!!policy?.ui?.showPullRequestsSection)

      // Sync thinking settings
      const thinking = readThinkingSettings(proj)
      setThinkingEnabled(thinking.enabled)
      setThinkingMode(thinking.mode)
      setThinkingBudgetTokens(thinking.budgetTokens?.toString() || '')

      // Sync planning settings
      const planning = readPlanningSettings(proj)
      setPlanningEnabled(planning.enabled)
      setPlanningMode(planning.mode)
      setPlanApprovalRequired(planning.approvalRequired)

      // Sync multi-agent settings
      const multiAgent = readMultiAgentSettings(proj)
      setMultiAgentEnabled(multiAgent.enabled)
      setMergeStrategy(multiAgent.mergeStrategy)
      setConflictResolution(multiAgent.conflictResolution)
      setMaxAgentsPerCard(multiAgent.maxAgentsPerCard?.toString() || '')

      // Sync E2E settings
      const e2e = readE2ESettings(proj)
      setE2eEnabled(e2e.enabled)
      setE2eMaxRetries(e2e.maxRetries)
      setE2eTimeoutMinutes(e2e.timeoutMinutes)
      setE2eCreateTestsIfMissing(e2e.createTestsIfMissing)
      setE2eTestCommand(e2e.testCommand)

      // Sync notifications settings
      const notifications = readNotificationsSettings(proj)
      setAudioEnabled(notifications.audioEnabled)
      setSoundOnComplete(notifications.soundOnComplete)
      setSoundOnError(notifications.soundOnError)
      setSoundOnApproval(notifications.soundOnApproval)
    } catch {
      setToolPreference('auto')
      setRollbackOnCancel(false)
      setBaseBranch('')
      setShowPullRequestsSection(false)
      // Reset thinking/planning/multiAgent to defaults on error
      setThinkingEnabled(true)
      setThinkingMode('medium')
      setThinkingBudgetTokens('')
      setPlanningEnabled(true)
      setPlanningMode('lite')
      setPlanApprovalRequired(false)
      setMultiAgentEnabled(false)
      setMergeStrategy('sequential')
      setConflictResolution('auto')
      setMaxAgentsPerCard('')
      // Reset E2E to defaults
      setE2eEnabled(false)
      setE2eMaxRetries(3)
      setE2eTimeoutMinutes(10)
      setE2eCreateTestsIfMissing(true)
      setE2eTestCommand('')
      // Reset notifications to defaults
      setAudioEnabled(false)
      setSoundOnComplete(true)
      setSoundOnError(true)
      setSoundOnApproval(true)
    }
  }

  const loadShortcuts = useCallback(async (): Promise<void> => {
    if (!supportsShortcuts) return
    setShortcutsLoading(true)
    try {
      const data = await window.shellAPI.getShortcuts()
      setShortcuts(data)
    } catch {
      setShortcuts([])
    } finally {
      setShortcutsLoading(false)
    }
  }, [supportsShortcuts])

  const handleThemeChange = async (theme: ThemePreference): Promise<void> => {
    try {
      await window.shellAPI.setThemePreference(theme)
      setThemePreference(theme)
      const resolved = theme === 'system' ? await window.shellAPI.getSystemTheme() : theme
      document.documentElement.classList.toggle('dark', resolved === 'dark')
      toast.success('Theme updated', {
        description: `Switched to ${theme} theme`
      })
    } catch (error) {
      console.error('Failed to save theme:', error)
      toast.error('Failed to update theme', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  const handleShortcutsPatch = useCallback(
    async (patch: Record<string, string | null>): Promise<void> => {
      if (!supportsShortcuts) return
      await window.shellAPI.setShortcuts(patch)
      await loadShortcuts()
      toast.success('Shortcut updated')
    },
    [supportsShortcuts, loadShortcuts]
  )

  const handleToolPreferenceChange = useCallback(
    async (newPref: WorkerToolPreference): Promise<void> => {
      if (!project) return
      const previousValue = toolPreference
      setToolPreference(newPref)
      try {
        await window.electron.ipcRenderer.invoke('updateProjectPolicy', {
          projectId: project.id,
          policy: { worker: { toolPreference: newPref } }
        })
        toast.success('AI tool preference updated', {
          description: `Worker will use ${newPref === 'auto' ? 'Auto' : newPref === 'claude' ? 'Claude Code' : 'Codex'}`
        })
      } catch (err) {
        setToolPreference(previousValue)
        console.error('Failed to update tool preference:', err)
        toast.error('Failed to update tool preference', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [project, toolPreference]
  )

  const handleRollbackOnCancelChange = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (!project) return
      const previousValue = rollbackOnCancel
      setRollbackOnCancel(enabled)
      try {
        await window.electron.ipcRenderer.invoke('updateProjectPolicy', {
          projectId: project.id,
          policy: { worker: { rollbackOnCancel: enabled } }
        })
        toast.success('Cancel behavior updated', {
          description: enabled
            ? 'Changes will be rolled back on cancel'
            : 'Changes will be kept on cancel'
        })
      } catch (err) {
        setRollbackOnCancel(previousValue)
        console.error('Failed to update cancel behavior:', err)
        toast.error('Failed to update cancel behavior', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [project, rollbackOnCancel]
  )

  const handleBaseBranchSave = useCallback(async (): Promise<void> => {
    if (!project) return
    const value = baseBranch.trim()
    setSavingBaseBranch(true)
    try {
      await window.electron.ipcRenderer.invoke('updateProjectPolicy', {
        projectId: project.id,
        policy: {
          worker: {
            baseBranch: value || undefined,
            worktree: { baseBranch: value || undefined }
          }
        }
      })
      toast.success('Base branch updated', {
        description: value
          ? `Worker will pull ${value} before starting`
          : 'Worker will auto-detect the main branch'
      })
    } catch (err) {
      console.error('Failed to update base branch:', err)
      toast.error('Failed to update base branch', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSavingBaseBranch(false)
    }
  }, [project, baseBranch])

  const handleShowPRsSectionChange = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (!project) return
      const previousValue = showPullRequestsSection
      setShowPullRequestsSection(enabled)
      try {
        await window.electron.ipcRenderer.invoke('updateProjectPolicy', {
          projectId: project.id,
          policy: { ui: { showPullRequestsSection: enabled } }
        })
        toast.success('Board layout updated', {
          description: enabled
            ? 'Pull requests section is now visible'
            : 'Pull requests section is now hidden'
        })
      } catch (err) {
        setShowPullRequestsSection(previousValue)
        console.error('Failed to update board layout:', err)
        toast.error('Failed to update board layout', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [project, showPullRequestsSection]
  )

  const handleSaveAnthropicKey = useCallback(async (): Promise<void> => {
    setSavingAnthropicKey(true)
    try {
      await window.electron.ipcRenderer.invoke('setApiKey', {
        key: 'anthropic',
        value: anthropicApiKey
      })
      toast.success('Anthropic API key saved')
    } catch (err) {
      console.error('Failed to save Anthropic API key:', err)
      toast.error('Failed to save Anthropic API key', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSavingAnthropicKey(false)
    }
  }, [anthropicApiKey])

  const handleSaveOpenaiKey = useCallback(async (): Promise<void> => {
    setSavingOpenaiKey(true)
    try {
      await window.electron.ipcRenderer.invoke('setApiKey', {
        key: 'openai',
        value: openaiApiKey
      })
      toast.success('OpenAI API key saved')
    } catch (err) {
      console.error('Failed to save OpenAI API key:', err)
      toast.error('Failed to save OpenAI API key', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSavingOpenaiKey(false)
    }
  }, [openaiApiKey])

  // Thinking mode handlers
  const updateThinkingSetting = useCallback(
    async (update: Partial<ThinkingSettings>): Promise<void> => {
      if (!project) return
      try {
        await window.electron.ipcRenderer.invoke('updateFeatureConfig', {
          projectId: project.id,
          featureKey: 'thinking',
          config: update
        })
        toast.success('Thinking settings updated')
      } catch (err) {
        console.error('Failed to update thinking settings:', err)
        toast.error('Failed to update thinking settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        // Reload settings on error
        const thinking = readThinkingSettings(project)
        setThinkingEnabled(thinking.enabled)
        setThinkingMode(thinking.mode)
        setThinkingBudgetTokens(thinking.budgetTokens?.toString() || '')
      }
    },
    [project]
  )

  const handleThinkingEnabledChange = useCallback(
    (enabled: boolean): void => {
      setThinkingEnabled(enabled)
      updateThinkingSetting({ enabled })
    },
    [updateThinkingSetting]
  )

  const handleThinkingModeChange = useCallback(
    (mode: ThinkingMode): void => {
      setThinkingMode(mode)
      updateThinkingSetting({ mode })
    },
    [updateThinkingSetting]
  )

  const handleThinkingBudgetChange = useCallback((value: string): void => {
    setThinkingBudgetTokens(value)
  }, [])

  const handleThinkingBudgetBlur = useCallback((): void => {
    const num = parseInt(thinkingBudgetTokens, 10)
    if (num > 0) {
      updateThinkingSetting({ budgetTokens: num })
    } else if (thinkingBudgetTokens === '') {
      updateThinkingSetting({ budgetTokens: undefined })
    }
  }, [thinkingBudgetTokens, updateThinkingSetting])

  // Planning mode handlers
  const updatePlanningSetting = useCallback(
    async (update: Partial<PlanningSettings>): Promise<void> => {
      if (!project) return
      try {
        await window.electron.ipcRenderer.invoke('updateFeatureConfig', {
          projectId: project.id,
          featureKey: 'planning',
          config: update
        })
        toast.success('Planning settings updated')
      } catch (err) {
        console.error('Failed to update planning settings:', err)
        toast.error('Failed to update planning settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        // Reload settings on error
        const planning = readPlanningSettings(project)
        setPlanningEnabled(planning.enabled)
        setPlanningMode(planning.mode)
      }
    },
    [project]
  )

  const handlePlanningEnabledChange = useCallback(
    (enabled: boolean): void => {
      setPlanningEnabled(enabled)
      updatePlanningSetting({ enabled })
    },
    [updatePlanningSetting]
  )

  const handlePlanningModeChange = useCallback(
    (mode: PlanningMode): void => {
      setPlanningMode(mode)
      updatePlanningSetting({ mode })
    },
    [updatePlanningSetting]
  )

  // Multi-Agent handlers
  const updateMultiAgentSetting = useCallback(
    async (update: Partial<MultiAgentSettings>): Promise<void> => {
      if (!project) return
      try {
        await window.electron.ipcRenderer.invoke('updateFeatureConfig', {
          projectId: project.id,
          featureKey: 'multiAgent',
          config: update
        })
        toast.success('Multi-Agent settings updated')
      } catch (err) {
        console.error('Failed to update Multi-Agent settings:', err)
        toast.error('Failed to update Multi-Agent settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        // Reload settings on error
        const multiAgent = readMultiAgentSettings(project)
        setMultiAgentEnabled(multiAgent.enabled)
        setMergeStrategy(multiAgent.mergeStrategy)
        setConflictResolution(multiAgent.conflictResolution)
        setMaxAgentsPerCard(multiAgent.maxAgentsPerCard?.toString() || '')
      }
    },
    [project]
  )

  const handleMultiAgentEnabledChange = useCallback(
    (enabled: boolean): void => {
      setMultiAgentEnabled(enabled)
      updateMultiAgentSetting({ enabled })
    },
    [updateMultiAgentSetting]
  )

  const handleMergeStrategyChange = useCallback(
    (strategy: MergeStrategy): void => {
      setMergeStrategy(strategy)
      updateMultiAgentSetting({ mergeStrategy: strategy })
    },
    [updateMultiAgentSetting]
  )

  const handleConflictResolutionChange = useCallback(
    (resolution: ConflictResolution): void => {
      setConflictResolution(resolution)
      updateMultiAgentSetting({ conflictResolution: resolution })
    },
    [updateMultiAgentSetting]
  )

  const handleMaxAgentsPerCardChange = useCallback((value: string): void => {
    setMaxAgentsPerCard(value)
  }, [])

  const handleMaxAgentsPerCardBlur = useCallback((): void => {
    const num = parseInt(maxAgentsPerCard, 10)
    if (num > 0) {
      updateMultiAgentSetting({ maxAgentsPerCard: num })
    } else if (maxAgentsPerCard === '') {
      updateMultiAgentSetting({ maxAgentsPerCard: undefined })
    }
  }, [maxAgentsPerCard, updateMultiAgentSetting])

  const handlePlanApprovalRequiredChange = useCallback(
    (required: boolean): void => {
      setPlanApprovalRequired(required)
      updatePlanningSetting({ approvalRequired: required })
    },
    [updatePlanningSetting]
  )

  // E2E Testing handlers
  const updateE2ESetting = useCallback(
    async (update: Partial<E2ESettings>): Promise<void> => {
      if (!project) return
      try {
        await window.electron.ipcRenderer.invoke('updateE2ESettings', {
          projectId: project.id,
          e2eConfig: update
        })
        toast.success('E2E settings updated')
      } catch (err) {
        toast.error('Failed to update E2E settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        // Reload settings on error
        const e2e = readE2ESettings(project)
        setE2eEnabled(e2e.enabled)
        setE2eMaxRetries(e2e.maxRetries)
        setE2eTimeoutMinutes(e2e.timeoutMinutes)
        setE2eCreateTestsIfMissing(e2e.createTestsIfMissing)
        setE2eTestCommand(e2e.testCommand)
      }
    },
    [project]
  )

  const handleE2eEnabledChange = useCallback(
    (enabled: boolean): void => {
      setE2eEnabled(enabled)
      updateE2ESetting({ enabled })
    },
    [updateE2ESetting]
  )

  const handleE2eMaxRetriesChange = useCallback(
    (value: string): void => {
      const num = parseInt(value, 10)
      if (num >= 1 && num <= 10) {
        setE2eMaxRetries(num)
        updateE2ESetting({ maxRetries: num })
      }
    },
    [updateE2ESetting]
  )

  const handleE2eTimeoutChange = useCallback(
    (value: string): void => {
      const num = parseInt(value, 10)
      if (num >= 1 && num <= 60) {
        setE2eTimeoutMinutes(num)
        updateE2ESetting({ timeoutMinutes: num })
      }
    },
    [updateE2ESetting]
  )

  const handleE2eCreateTestsChange = useCallback(
    (enabled: boolean): void => {
      setE2eCreateTestsIfMissing(enabled)
      updateE2ESetting({ createTestsIfMissing: enabled })
    },
    [updateE2ESetting]
  )

  const handleE2eTestCommandChange = useCallback((value: string): void => {
    setE2eTestCommand(value)
  }, [])

  const handleE2eTestCommandBlur = useCallback((): void => {
    updateE2ESetting({ testCommand: e2eTestCommand || undefined })
  }, [e2eTestCommand, updateE2ESetting])

  // Audio notifications handlers
  const updateNotificationSetting = useCallback(
    async (update: Partial<NotificationsSettings>): Promise<void> => {
      try {
        await window.electron.ipcRenderer.invoke('updateFeatureConfig', {
          projectId: project?.id,
          feature: 'notifications',
          config: update
        })
        toast.success('Notification settings updated')
      } catch (err) {
        toast.error('Failed to update notification settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
        const notifications = readNotificationsSettings(project)
        setAudioEnabled(notifications.audioEnabled)
        setSoundOnComplete(notifications.soundOnComplete)
        setSoundOnError(notifications.soundOnError)
        setSoundOnApproval(notifications.soundOnApproval)
      }
    },
    [project]
  )

  const handleAudioEnabledChange = useCallback(
    (enabled: boolean): void => {
      setAudioEnabled(enabled)
      updateNotificationSetting({ audioEnabled: enabled })
    },
    [updateNotificationSetting]
  )

  const handleSoundOnCompleteChange = useCallback(
    (enabled: boolean): void => {
      setSoundOnComplete(enabled)
      updateNotificationSetting({ soundOnComplete: enabled })
    },
    [updateNotificationSetting]
  )

  const handleSoundOnErrorChange = useCallback(
    (enabled: boolean): void => {
      setSoundOnError(enabled)
      updateNotificationSetting({ soundOnError: enabled })
    },
    [updateNotificationSetting]
  )

  const handleSoundOnApprovalChange = useCallback(
    (enabled: boolean): void => {
      setSoundOnApproval(enabled)
      updateNotificationSetting({ soundOnApproval: enabled })
    },
    [updateNotificationSetting]
  )

  // Sync settings handlers
  const updateSyncSetting = useCallback(
    async (update: { pollInterval?: number; autoSyncOnAction?: boolean }): Promise<void> => {
      if (!project) return
      try {
        await window.electron.ipcRenderer.invoke('updateSyncSettings', {
          projectId: project.id,
          ...update
        })
        toast.success('Sync settings updated')
      } catch (err) {
        // Rollback state on error
        const sync = readSyncSettings(project)
        setSyncPollInterval(Math.round(sync.pollInterval / 60000))
        setAutoSyncOnAction(sync.autoSyncOnAction)
        toast.error('Failed to update sync settings', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [project]
  )

  const handleSyncPollIntervalChange = useCallback(
    (minutes: number): void => {
      const clamped = Math.max(1, Math.min(60, minutes))
      setSyncPollInterval(clamped)
      updateSyncSetting({ pollInterval: clamped * 60000 })
    },
    [updateSyncSetting]
  )

  const handleAutoSyncOnActionChange = useCallback(
    (enabled: boolean): void => {
      setAutoSyncOnAction(enabled)
      updateSyncSetting({ autoSyncOnAction: enabled })
    },
    [updateSyncSetting]
  )

  // AI Profiles handlers
  const loadAIProfiles = useCallback(async (): Promise<void> => {
    if (!project?.id) return
    setAiProfilesLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('aiProfiles:list', project.id)
      if (result.error) {
        toast.error('Failed to load AI profiles', { description: result.error })
      } else {
        setAiProfiles(result.profiles || [])
      }
    } catch (err) {
      toast.error('Failed to load AI profiles', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setAiProfilesLoading(false)
    }
  }, [project])

  useEffect(() => {
    if (open && activeSection === 'ai-agents') {
      loadAIProfiles()
    }
  }, [open, activeSection, loadAIProfiles])

  // Load usage limits when section is opened
  const loadUsageLimits = useCallback(async (): Promise<void> => {
    if (!project) return
    setLimitsLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('usage:getWithLimits')
      const usageData = result.usageWithLimits

      // Find claude and codex limits
      const claudeData = usageData.find((t) => t.tool_type === 'claude')
      const codexData = usageData.find((t) => t.tool_type === 'codex')

      if (claudeData?.limits) {
        setClaudeLimits({
          hourlyTokenLimit: claudeData.limits.hourly_token_limit?.toString() || '',
          dailyTokenLimit: claudeData.limits.daily_token_limit?.toString() || '',
          monthlyTokenLimit: claudeData.limits.monthly_token_limit?.toString() || '',
          hourlyCostLimit: claudeData.limits.hourly_cost_limit_usd?.toString() || '',
          dailyCostLimit: claudeData.limits.daily_cost_limit_usd?.toString() || '',
          monthlyCostLimit: claudeData.limits.monthly_cost_limit_usd?.toString() || ''
        })
      }
      if (codexData?.limits) {
        setCodexLimits({
          hourlyTokenLimit: codexData.limits.hourly_token_limit?.toString() || '',
          dailyTokenLimit: codexData.limits.daily_token_limit?.toString() || '',
          monthlyTokenLimit: codexData.limits.monthly_token_limit?.toString() || '',
          hourlyCostLimit: codexData.limits.hourly_cost_limit_usd?.toString() || '',
          dailyCostLimit: codexData.limits.daily_cost_limit_usd?.toString() || '',
          monthlyCostLimit: codexData.limits.monthly_cost_limit_usd?.toString() || ''
        })
      }
    } catch (err) {
      console.error('Failed to load usage limits:', err)
    } finally {
      setLimitsLoading(false)
    }
  }, [project])

  useEffect(() => {
    if (open && activeSection === 'usage-limits') {
      loadUsageLimits()
    }
  }, [open, activeSection, loadUsageLimits])

  // Save limits for a tool
  const saveToolLimits = useCallback(
    async (toolType: 'claude' | 'codex', limits: ToolLimitsState): Promise<void> => {
      setSavingLimits(true)
      try {
        await window.electron.ipcRenderer.invoke('usage:setToolLimits', {
          toolType,
          hourlyTokenLimit: limits.hourlyTokenLimit ? parseInt(limits.hourlyTokenLimit, 10) : null,
          dailyTokenLimit: limits.dailyTokenLimit ? parseInt(limits.dailyTokenLimit, 10) : null,
          monthlyTokenLimit: limits.monthlyTokenLimit ? parseInt(limits.monthlyTokenLimit, 10) : null,
          hourlyCostLimitUsd: limits.hourlyCostLimit ? parseFloat(limits.hourlyCostLimit) : null,
          dailyCostLimitUsd: limits.dailyCostLimit ? parseFloat(limits.dailyCostLimit) : null,
          monthlyCostLimitUsd: limits.monthlyCostLimit ? parseFloat(limits.monthlyCostLimit) : null
        })
        toast.success(`${toolType === 'claude' ? 'Claude' : 'Codex'} limits saved`)
      } catch (err) {
        toast.error(`Failed to save ${toolType} limits`)
        console.error(err)
      } finally {
        setSavingLimits(false)
      }
    },
    []
  )

  const resetProfileForm = useCallback((): void => {
    setProfileFormData({
      name: '',
      description: '',
      modelProvider: 'auto',
      modelName: '',
      temperature: '',
      maxTokens: '',
      topP: '',
      systemPrompt: '',
      thinkingEnabled: false,
      thinkingMode: 'medium',
      thinkingBudgetTokens: '',
      planningEnabled: false,
      planningMode: 'lite'
    })
  }, [])

  const handleCreateProfile = useCallback((): void => {
    resetProfileForm()
    setEditingProfile(null)
    setIsCreatingProfile(true)
  }, [resetProfileForm])

  const handleEditProfile = useCallback((profile: AIProfile): void => {
    setProfileFormData({
      name: profile.name,
      description: profile.description || '',
      modelProvider: profile.model_provider,
      modelName: profile.model_name || '',
      temperature: profile.temperature?.toString() || '',
      maxTokens: profile.max_tokens?.toString() || '',
      topP: profile.top_p?.toString() || '',
      systemPrompt: profile.system_prompt || '',
      thinkingEnabled: profile.thinking_enabled ?? false,
      thinkingMode: profile.thinking_mode || 'medium',
      thinkingBudgetTokens: profile.thinking_budget_tokens?.toString() || '',
      planningEnabled: profile.planning_enabled ?? false,
      planningMode: profile.planning_mode || 'lite'
    })
    setEditingProfile(profile)
    setIsCreatingProfile(true)
  }, [])

  const handleCancelProfileEdit = useCallback((): void => {
    setIsCreatingProfile(false)
    setEditingProfile(null)
    resetProfileForm()
  }, [resetProfileForm])

  const handleSaveProfile = useCallback(async (): Promise<void> => {
    if (!profileFormData.name.trim()) {
      toast.error('Profile name is required')
      return
    }

    setSavingProfile(true)
    try {
      const data = {
        name: profileFormData.name.trim(),
        description: profileFormData.description.trim() || undefined,
        modelProvider: profileFormData.modelProvider,
        modelName: profileFormData.modelName.trim() || undefined,
        temperature: profileFormData.temperature ? parseFloat(profileFormData.temperature) : undefined,
        maxTokens: profileFormData.maxTokens ? parseInt(profileFormData.maxTokens, 10) : undefined,
        topP: profileFormData.topP ? parseFloat(profileFormData.topP) : undefined,
        systemPrompt: profileFormData.systemPrompt.trim() || undefined,
        thinkingEnabled: profileFormData.thinkingEnabled,
        thinkingMode: profileFormData.thinkingMode,
        thinkingBudgetTokens: profileFormData.thinkingBudgetTokens
          ? parseInt(profileFormData.thinkingBudgetTokens, 10)
          : undefined,
        planningEnabled: profileFormData.planningEnabled,
        planningMode: profileFormData.planningMode
      }

      if (editingProfile) {
        const result = await window.electron.ipcRenderer.invoke('aiProfiles:update', {
          profileId: editingProfile.id,
          data
        })
        if (result.error) {
          toast.error('Failed to update profile', { description: result.error })
        } else {
          toast.success('Profile updated')
          setIsCreatingProfile(false)
          setEditingProfile(null)
          resetProfileForm()
          loadAIProfiles()
        }
      } else {
        const result = await window.electron.ipcRenderer.invoke('aiProfiles:create', {
          projectId: project?.id,
          ...data
        })
        if (result.error) {
          toast.error('Failed to create profile', { description: result.error })
        } else {
          toast.success('Profile created')
          setIsCreatingProfile(false)
          resetProfileForm()
          loadAIProfiles()
        }
      }
    } catch (err) {
      toast.error('Failed to save profile', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSavingProfile(false)
    }
  }, [profileFormData, editingProfile, resetProfileForm, loadAIProfiles, project])

  const handleDeleteProfile = useCallback(
    async (profileId: string): Promise<void> => {
      try {
        const result = await window.electron.ipcRenderer.invoke('aiProfiles:delete', profileId)
        if (result.error) {
          toast.error('Failed to delete profile', { description: result.error })
        } else {
          toast.success('Profile deleted')
          loadAIProfiles()
        }
      } catch (err) {
        toast.error('Failed to delete profile', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [loadAIProfiles]
  )

  const handleSetDefaultProfile = useCallback(
    async (profileId: string): Promise<void> => {
      try {
        const result = await window.electron.ipcRenderer.invoke('aiProfiles:setDefault', profileId)
        if (result.error) {
          toast.error('Failed to set default profile', { description: result.error })
        } else {
          toast.success('Default profile set')
          loadAIProfiles()
        }
      } catch (err) {
        toast.error('Failed to set default profile', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [loadAIProfiles]
  )

  const handleDuplicateProfile = useCallback(
    async (profileId: string, currentName: string): Promise<void> => {
      try {
        const result = await window.electron.ipcRenderer.invoke('aiProfiles:duplicate', {
          profileId,
          newName: `${currentName} (Copy)`
        })
        if (result.error) {
          toast.error('Failed to duplicate profile', { description: result.error })
        } else {
          toast.success('Profile duplicated')
          loadAIProfiles()
        }
      } catch (err) {
        toast.error('Failed to duplicate profile', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [loadAIProfiles]
  )

  const handleReconfigureLabels = useCallback(async (): Promise<void> => {
    console.log('[SettingsModal] handleReconfigureLabels called, project:', project?.id)
    console.log('[SettingsModal] window.electron:', window.electron)
    console.log('[SettingsModal] window.electron?.ipcRenderer:', window.electron?.ipcRenderer)
    if (!project) {
      console.log('[SettingsModal] No project, returning early')
      return
    }
    try {
      console.log('[SettingsModal] Calling resetLabelWizard...')
      const result = await window.electron.ipcRenderer.invoke('resetLabelWizard', {
        projectId: project.id
      })
      console.log('[SettingsModal] resetLabelWizard result:', result)
      toast.success('Label setup reopened')
      onOpenChange(false)
    } catch (err) {
      console.error('[SettingsModal] Failed to reopen label setup:', err)
      toast.error('Failed to reopen label setup', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }, [project, onOpenChange])

  const handleReopenGithubProjectPrompt = useCallback(async (): Promise<void> => {
    if (!project) return
    try {
      await window.electron.ipcRenderer.invoke('resetGithubProjectPrompt', {
        projectId: project.id
      })
      toast.success('GitHub Project prompt reopened')
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to reopen GitHub Project prompt:', err)
      toast.error('Failed to reopen GitHub Project prompt', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }, [project, onOpenChange])

  const handleUnlink = useCallback(async (): Promise<void> => {
    if (!project) return
    setIsUnlinking(true)
    try {
      await window.electron.ipcRenderer.invoke('unlinkProject', { projectId: project.id })
      toast.success('Project unlinked', {
        description: `"${project.name}" has been removed from Patchwork`
      })
      setShowUnlinkConfirm(false)
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to unlink project:', err)
      toast.error('Failed to unlink project', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setIsUnlinking(false)
    }
  }, [project, onOpenChange])

  const themeOptions: {
    id: ThemePreference
    title: string
    description: string
    icon: ReactNode
  }[] = [
    {
      id: 'light',
      title: 'Light',
      description: 'Use light theme regardless of system preference.',
      icon: <Sun className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'dark',
      title: 'Dark',
      description: 'Use dark theme regardless of system preference.',
      icon: <Moon className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'system',
      title: 'System',
      description: 'Automatically match your operating system theme.',
      icon: <Monitor className="h-4 w-4 text-foreground/70" />
    }
  ]

  const toolOptions: {
    id: WorkerToolPreference
    title: string
    description: string
    icon: ReactNode
  }[] = [
    {
      id: 'auto',
      title: 'Auto',
      description: 'Use Claude Code if available; otherwise use Codex.',
      icon: <Sparkles className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'claude',
      title: 'Claude Code',
      description: 'Prefer the Claude Code CLI when the worker runs.',
      icon: <Bot className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'codex',
      title: 'Codex',
      description: 'Prefer the Codex CLI when the worker runs.',
      icon: <Code className="h-4 w-4 text-foreground/70" />
    }
  ]

  const thinkingModeOptions: {
    id: ThinkingMode
    title: string
    description: string
    tokens: string
    icon: ReactNode
  }[] = [
    {
      id: 'none',
      title: 'None',
      description: 'Standard processing without extended thinking.',
      tokens: '0',
      icon: <Zap className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'medium',
      title: 'Medium',
      description: 'Balanced thinking for most tasks.',
      tokens: '~1K',
      icon: <Brain className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'deep',
      title: 'Deep',
      description: 'More thorough analysis for complex problems.',
      tokens: '~4K',
      icon: <Brain className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'ultra',
      title: 'Ultra',
      description: 'Maximum thinking depth for difficult tasks.',
      tokens: '~16K',
      icon: <Brain className="h-4 w-4 text-foreground/70" />
    }
  ]

  const planningModeOptions: {
    id: PlanningMode
    title: string
    description: string
    icon: ReactNode
  }[] = [
    {
      id: 'skip',
      title: 'Skip',
      description: 'No planning phase, proceed directly to implementation.',
      icon: <Zap className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'lite',
      title: 'Lite',
      description: 'Basic plan with task overview and high-level approach.',
      icon: <ClipboardList className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'spec',
      title: 'Spec',
      description: 'Detailed specification with file analysis and dependencies.',
      icon: <ClipboardList className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'full',
      title: 'Full',
      description: 'Comprehensive plan with risk analysis and verification steps.',
      icon: <ClipboardList className="h-4 w-4 text-foreground/70" />
    }
  ]

  const mergeStrategyOptions: {
    id: MergeStrategy
    title: string
    description: string
    icon: ReactNode
  }[] = [
    {
      id: 'sequential',
      title: 'Sequential',
      description: 'Agents work one at a time, changes applied in order.',
      icon: <Users className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'parallel-merge',
      title: 'Parallel Merge',
      description: 'Agents work simultaneously, changes merged at the end.',
      icon: <Users className="h-4 w-4 text-foreground/70" />
    }
  ]

  const conflictResolutionOptions: {
    id: ConflictResolution
    title: string
    description: string
    icon: ReactNode
  }[] = [
    {
      id: 'auto',
      title: 'Automatic',
      description: 'AI automatically resolves merge conflicts.',
      icon: <Sparkles className="h-4 w-4 text-foreground/70" />
    },
    {
      id: 'manual',
      title: 'Manual',
      description: 'Pause for user review when conflicts occur.',
      icon: <AlertTriangle className="h-4 w-4 text-foreground/70" />
    }
  ]

  const renderSectionContent = (): ReactNode => {
    switch (activeSection) {
      case 'appearance':
        return (
          <div className="grid gap-4">
            <div>
              <h3 className="text-sm font-medium mb-1">Theme</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Choose how Patchwork looks to you.
              </p>
            </div>
            <div className="grid gap-2">
              {themeOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleThemeChange(opt.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    themePreference === opt.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border',
                      themePreference === opt.id
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground'
                    )}
                  >
                    {themePreference === opt.id && <Check className="h-3 w-3" />}
                  </div>
                  {opt.icon}
                  <div className="flex-1">
                    <div className="font-medium">{opt.title}</div>
                    <div className="text-xs text-muted-foreground">{opt.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )

      case 'features':
        return (
          <div className="grid gap-6">
            {project && (
              <>
                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">Cancel Behavior</h3>
                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Rollback changes on cancel</div>
                      <div className="text-xs text-muted-foreground">
                        If you move a running card back to Draft (or forward to In
                        Review/Testing/Done), the worker is canceled. Enable this to attempt to roll
                        back the worker&apos;s local changes.
                      </div>
                    </div>
                    <Switch
                      checked={rollbackOnCancel}
                      onCheckedChange={handleRollbackOnCancelChange}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">Worker Base Branch</h3>
                  <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1 space-y-2">
                      <div className="font-medium text-sm">Pull latest before starting</div>
                      <div className="text-xs text-muted-foreground">
                        The worker will pull this branch before working on Ready items. Leave blank
                        to auto-detect from the remote default.
                      </div>
                      <Input
                        value={baseBranch}
                        onChange={(e) => setBaseBranch(e.target.value)}
                        placeholder="main or master"
                        className="max-w-[240px]"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBaseBranchSave}
                      disabled={savingBaseBranch}
                    >
                      {savingBaseBranch ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">Board Settings</h3>
                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Show Pull Requests section</div>
                      <div className="text-xs text-muted-foreground">
                        When enabled, pull requests / merge requests are shown in a separate section
                        (and removed from the Kanban columns).
                      </div>
                    </div>
                    <Switch
                      checked={showPullRequestsSection}
                      onCheckedChange={handleShowPRsSectionChange}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">Repo Integration</h3>
                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Issue label mapping</div>
                      <div className="text-xs text-muted-foreground">
                        Configure (or re-run) the label mapping wizard for this repo.
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleReconfigureLabels}>
                      Configure
                    </Button>
                  </div>

                  {project.remote_repo_key?.startsWith('github:') && (
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <div className="flex-1">
                        <div className="font-medium text-sm">GitHub Projects V2</div>
                        <div className="text-xs text-muted-foreground">
                          Reopen the prompt to create a GitHub Project for status syncing.
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={handleReopenGithubProjectPrompt}>
                        Reopen
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid gap-2">
                  <h3 className="text-sm font-medium">E2E Testing</h3>
                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Enable E2E Testing</div>
                      <div className="text-xs text-muted-foreground">
                        Run end-to-end tests after the worker completes tasks to verify changes.
                      </div>
                    </div>
                    <Switch checked={e2eEnabled} onCheckedChange={handleE2eEnabledChange} />
                  </div>

                  {e2eEnabled && (
                    <>
                      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                        <div className="flex-1">
                          <div className="font-medium text-sm">Create Tests If Missing</div>
                          <div className="text-xs text-muted-foreground">
                            Allow AI to create test files if none exist for the changed code.
                          </div>
                        </div>
                        <Switch
                          checked={e2eCreateTestsIfMissing}
                          onCheckedChange={handleE2eCreateTestsChange}
                        />
                      </div>

                      <div className="rounded-lg border p-3">
                        <div className="font-medium text-sm mb-1">Max Retries</div>
                        <div className="text-xs text-muted-foreground mb-2">
                          Number of times to retry failing tests (1-10)
                        </div>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={e2eMaxRetries}
                          onChange={(e) => handleE2eMaxRetriesChange(e.target.value)}
                          className="max-w-[100px]"
                        />
                      </div>

                      <div className="rounded-lg border p-3">
                        <div className="font-medium text-sm mb-1">Timeout (minutes)</div>
                        <div className="text-xs text-muted-foreground mb-2">
                          Maximum time to wait for tests to complete (1-60)
                        </div>
                        <Input
                          type="number"
                          min={1}
                          max={60}
                          value={e2eTimeoutMinutes}
                          onChange={(e) => handleE2eTimeoutChange(e.target.value)}
                          className="max-w-[100px]"
                        />
                      </div>

                      <div className="rounded-lg border p-3">
                        <div className="font-medium text-sm mb-1">Test Command</div>
                        <div className="text-xs text-muted-foreground mb-2">
                          Custom command to run tests (leave empty for auto-detection)
                        </div>
                        <Input
                          value={e2eTestCommand}
                          onChange={(e) => handleE2eTestCommandChange(e.target.value)}
                          onBlur={handleE2eTestCommandBlur}
                          placeholder="npm test"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    {audioEnabled ? (
                      <Volume2 className="h-4 w-4 text-foreground/70" />
                    ) : (
                      <VolumeX className="h-4 w-4 text-foreground/70" />
                    )}
                    <h3 className="text-sm font-medium">Audio Notifications</h3>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Enable Audio</div>
                      <div className="text-xs text-muted-foreground">
                        Play sounds for worker events like task completion and errors.
                      </div>
                    </div>
                    <Switch checked={audioEnabled} onCheckedChange={handleAudioEnabledChange} />
                  </div>

                  {audioEnabled && (
                    <>
                      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                        <div className="flex-1">
                          <div className="font-medium text-sm">Sound on Complete</div>
                          <div className="text-xs text-muted-foreground">
                            Play a sound when a task completes successfully.
                          </div>
                        </div>
                        <Switch
                          checked={soundOnComplete}
                          onCheckedChange={handleSoundOnCompleteChange}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                        <div className="flex-1">
                          <div className="font-medium text-sm">Sound on Error</div>
                          <div className="text-xs text-muted-foreground">
                            Play a sound when a task fails.
                          </div>
                        </div>
                        <Switch checked={soundOnError} onCheckedChange={handleSoundOnErrorChange} />
                      </div>

                      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                        <div className="flex-1">
                          <div className="font-medium text-sm">Sound on Approval Required</div>
                          <div className="text-xs text-muted-foreground">
                            Play a sound when a task needs your approval.
                          </div>
                        </div>
                        <Switch
                          checked={soundOnApproval}
                          onCheckedChange={handleSoundOnApprovalChange}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Sync Settings */}
                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-foreground/70" />
                    <h3 className="text-sm font-medium">Sync Settings</h3>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Sync Interval</div>
                      <div className="text-xs text-muted-foreground">
                        How often to poll for card updates from remote (in minutes)
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={syncPollInterval}
                      onChange={(e) => handleSyncPollIntervalChange(Number(e.target.value))}
                      className="w-20"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Auto-sync on Actions</div>
                      <div className="text-xs text-muted-foreground">
                        Automatically sync after card moves and worker completions
                      </div>
                    </div>
                    <Switch
                      checked={autoSyncOnAction}
                      onCheckedChange={handleAutoSyncOnActionChange}
                    />
                  </div>
                </div>
              </>
            )}

            {!project && (
              <div className="text-sm text-muted-foreground">
                Select a project to configure its features.
              </div>
            )}
          </div>
        )

      case 'ai-agents':
        return (
          <div className="grid gap-6">
            {/* AI Profiles Section */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-foreground/70" />
                  <h3 className="text-sm font-medium">AI Profiles</h3>
                </div>
                {!isCreatingProfile && (
                  <Button variant="outline" size="sm" onClick={handleCreateProfile}>
                    <Plus className="h-3 w-3 mr-1" />
                    New Profile
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Create and manage AI configuration presets for different use cases.
              </p>

              {isCreatingProfile ? (
                <div className="border rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm">
                      {editingProfile ? 'Edit Profile' : 'New Profile'}
                    </h4>
                    <Button variant="ghost" size="sm" onClick={handleCancelProfileEdit}>
                      Cancel
                    </Button>
                  </div>

                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <label className="text-xs font-medium">Name *</label>
                      <Input
                        placeholder="e.g., Fast Coding, Deep Analysis"
                        value={profileFormData.name}
                        onChange={(e) =>
                          setProfileFormData((prev) => ({ ...prev, name: e.target.value }))
                        }
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <label className="text-xs font-medium">Description</label>
                      <Input
                        placeholder="Brief description of this profile"
                        value={profileFormData.description}
                        onChange={(e) =>
                          setProfileFormData((prev) => ({ ...prev, description: e.target.value }))
                        }
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <label className="text-xs font-medium">Model Provider</label>
                        <select
                          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                          value={profileFormData.modelProvider}
                          onChange={(e) =>
                            setProfileFormData((prev) => ({
                              ...prev,
                              modelProvider: e.target.value as AIModelProvider
                            }))
                          }
                        >
                          <option value="auto">Auto</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="openai">OpenAI</option>
                        </select>
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-xs font-medium">Model Name</label>
                        <Input
                          placeholder="e.g., claude-3-opus"
                          value={profileFormData.modelName}
                          onChange={(e) =>
                            setProfileFormData((prev) => ({ ...prev, modelName: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="grid gap-1.5">
                        <label className="text-xs font-medium">Temperature</label>
                        <Input
                          type="number"
                          min="0"
                          max="2"
                          step="0.1"
                          placeholder="0.0-2.0"
                          value={profileFormData.temperature}
                          onChange={(e) =>
                            setProfileFormData((prev) => ({ ...prev, temperature: e.target.value }))
                          }
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-xs font-medium">Max Tokens</label>
                        <Input
                          type="number"
                          min="1"
                          placeholder="e.g., 4096"
                          value={profileFormData.maxTokens}
                          onChange={(e) =>
                            setProfileFormData((prev) => ({ ...prev, maxTokens: e.target.value }))
                          }
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-xs font-medium">Top P</label>
                        <Input
                          type="number"
                          min="0"
                          max="1"
                          step="0.1"
                          placeholder="0.0-1.0"
                          value={profileFormData.topP}
                          onChange={(e) =>
                            setProfileFormData((prev) => ({ ...prev, topP: e.target.value }))
                          }
                        />
                      </div>
                    </div>

                    <div className="grid gap-1.5">
                      <label className="text-xs font-medium">System Prompt</label>
                      <textarea
                        className="min-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y"
                        placeholder="Custom system instructions for this profile"
                        value={profileFormData.systemPrompt}
                        onChange={(e) =>
                          setProfileFormData((prev) => ({ ...prev, systemPrompt: e.target.value }))
                        }
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <div className="font-medium text-sm">Extended Thinking</div>
                          <div className="text-xs text-muted-foreground">Enable deeper reasoning</div>
                        </div>
                        <Switch
                          checked={profileFormData.thinkingEnabled}
                          onCheckedChange={(checked) =>
                            setProfileFormData((prev) => ({ ...prev, thinkingEnabled: checked }))
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <div className="font-medium text-sm">Planning</div>
                          <div className="text-xs text-muted-foreground">Generate plan first</div>
                        </div>
                        <Switch
                          checked={profileFormData.planningEnabled}
                          onCheckedChange={(checked) =>
                            setProfileFormData((prev) => ({ ...prev, planningEnabled: checked }))
                          }
                        />
                      </div>
                    </div>

                    {profileFormData.thinkingEnabled && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <label className="text-xs font-medium">Thinking Mode</label>
                          <select
                            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                            value={profileFormData.thinkingMode}
                            onChange={(e) =>
                              setProfileFormData((prev) => ({
                                ...prev,
                                thinkingMode: e.target.value as ThinkingMode
                              }))
                            }
                          >
                            <option value="medium">Medium (~1K tokens)</option>
                            <option value="deep">Deep (~4K tokens)</option>
                            <option value="ultra">Ultra (~16K tokens)</option>
                          </select>
                        </div>

                        <div className="grid gap-1.5">
                          <label className="text-xs font-medium">Custom Budget</label>
                          <Input
                            type="number"
                            min="0"
                            placeholder="Token budget"
                            value={profileFormData.thinkingBudgetTokens}
                            onChange={(e) =>
                              setProfileFormData((prev) => ({
                                ...prev,
                                thinkingBudgetTokens: e.target.value
                              }))
                            }
                          />
                        </div>
                      </div>
                    )}

                    {profileFormData.planningEnabled && (
                      <div className="grid gap-1.5">
                        <label className="text-xs font-medium">Planning Mode</label>
                        <select
                          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                          value={profileFormData.planningMode}
                          onChange={(e) =>
                            setProfileFormData((prev) => ({
                              ...prev,
                              planningMode: e.target.value as PlanningMode
                            }))
                          }
                        >
                          <option value="lite">Lite - Basic task overview</option>
                          <option value="spec">Spec - Detailed specification</option>
                          <option value="full">Full - Comprehensive plan</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={handleCancelProfileEdit}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile}>
                      {savingProfile ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Saving...
                        </>
                      ) : editingProfile ? (
                        'Save Changes'
                      ) : (
                        'Create Profile'
                      )}
                    </Button>
                  </div>
                </div>
              ) : aiProfilesLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading profiles...
                </div>
              ) : aiProfiles.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No profiles yet. Create one to save AI configuration presets.
                </div>
              ) : (
                <div className="grid gap-2">
                  {aiProfiles.map((profile) => (
                    <div
                      key={profile.id}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-lg border p-3',
                        profile.is_default && 'border-primary bg-primary/5'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{profile.name}</span>
                          {profile.is_default && (
                            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              Default
                            </span>
                          )}
                        </div>
                        {profile.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {profile.description}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span className="capitalize">{profile.model_provider}</span>
                          {profile.model_name && <span>• {profile.model_name}</span>}
                          {profile.thinking_enabled && <span>• Thinking</span>}
                          {profile.planning_enabled && <span>• Planning</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!profile.is_default && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title="Set as default"
                            onClick={() => handleSetDefaultProfile(profile.id)}
                          >
                            <Star className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Duplicate"
                          onClick={() => handleDuplicateProfile(profile.id, profile.name)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Edit"
                          onClick={() => handleEditProfile(profile)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          title="Delete"
                          onClick={() => handleDeleteProfile(profile.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {project && (
              <div className="border-t pt-4 grid gap-2">
                <h3 className="text-sm font-medium">Tool Preference</h3>
                <p className="text-xs text-muted-foreground">
                  Select which AI tool the worker should use.
                </p>
                <div className="grid gap-2">
                  {toolOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleToolPreferenceChange(opt.id)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                        toolPreference === opt.id
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted/50'
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-full border',
                          toolPreference === opt.id
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground'
                        )}
                      >
                        {toolPreference === opt.id && <Check className="h-3 w-3" />}
                      </div>
                      {opt.icon}
                      <div className="flex-1">
                        <div className="font-medium">{opt.title}</div>
                        <div className="text-xs text-muted-foreground">{opt.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Stored in this project&apos;s policy (database). The worker still falls back if
                  the selected CLI isn&apos;t installed.
                </p>
              </div>
            )}

            {project && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="h-4 w-4 text-foreground/70" />
                  <h3 className="text-sm font-medium">Extended Thinking</h3>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border p-3 mb-3">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Enable Extended Thinking</div>
                    <div className="text-xs text-muted-foreground">
                      Allow Claude to &quot;think&quot; longer before responding, improving complex reasoning.
                    </div>
                  </div>
                  <Switch checked={thinkingEnabled} onCheckedChange={handleThinkingEnabledChange} />
                </div>

                {thinkingEnabled && (
                  <>
                    <p className="text-xs text-muted-foreground mb-2">
                      Select thinking depth (more tokens = longer thinking time):
                    </p>
                    <div className="grid gap-2 mb-3">
                      {thinkingModeOptions
                        .filter((opt) => opt.id !== 'none')
                        .map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleThinkingModeChange(opt.id)}
                            className={cn(
                              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                              thinkingMode === opt.id
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/50'
                            )}
                          >
                            <div
                              className={cn(
                                'flex h-4 w-4 items-center justify-center rounded-full border',
                                thinkingMode === opt.id
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground'
                              )}
                            >
                              {thinkingMode === opt.id && <Check className="h-3 w-3" />}
                            </div>
                            {opt.icon}
                            <div className="flex-1">
                              <div className="font-medium">
                                {opt.title}{' '}
                                <span className="text-xs text-muted-foreground">
                                  ({opt.tokens} tokens)
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground">{opt.description}</div>
                            </div>
                          </button>
                        ))}
                    </div>

                    <div className="rounded-lg border p-3">
                      <div className="font-medium text-sm mb-1">Custom Token Budget</div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Override the default budget (leave empty to use mode default)
                      </div>
                      <Input
                        type="number"
                        min={0}
                        placeholder="e.g. 2048"
                        value={thinkingBudgetTokens}
                        onChange={(e) => handleThinkingBudgetChange(e.target.value)}
                        onBlur={handleThinkingBudgetBlur}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {project && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <ClipboardList className="h-4 w-4 text-foreground/70" />
                  <h3 className="text-sm font-medium">Planning Mode</h3>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border p-3 mb-3">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Enable Planning</div>
                    <div className="text-xs text-muted-foreground">
                      Generate an implementation plan before coding to improve task success.
                    </div>
                  </div>
                  <Switch checked={planningEnabled} onCheckedChange={handlePlanningEnabledChange} />
                </div>

                {planningEnabled && (
                  <>
                    <p className="text-xs text-muted-foreground mb-2">
                      Select planning depth (more detail = better guidance for AI):
                    </p>
                    <div className="grid gap-2">
                      {planningModeOptions
                        .filter((opt) => opt.id !== 'skip')
                        .map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handlePlanningModeChange(opt.id)}
                            className={cn(
                              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                              planningMode === opt.id
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/50'
                            )}
                          >
                            <div
                              className={cn(
                                'flex h-4 w-4 items-center justify-center rounded-full border',
                                planningMode === opt.id
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground'
                              )}
                            >
                              {planningMode === opt.id && <Check className="h-3 w-3" />}
                            </div>
                            {opt.icon}
                            <div className="flex-1">
                              <div className="font-medium">{opt.title}</div>
                              <div className="text-xs text-muted-foreground">{opt.description}</div>
                            </div>
                          </button>
                        ))}
                    </div>

                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3 mt-3">
                      <div className="flex-1">
                        <div className="font-medium text-sm">Require Plan Approval</div>
                        <div className="text-xs text-muted-foreground">
                          Pause for user approval before implementing the plan.
                        </div>
                      </div>
                      <Switch
                        checked={planApprovalRequired}
                        onCheckedChange={handlePlanApprovalRequiredChange}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {project && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-4 w-4 text-foreground/70" />
                  <h3 className="text-sm font-medium">Multi-Agent Mode</h3>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border p-3 mb-3">
                  <div className="flex-1">
                    <div className="font-medium text-sm">Enable Multi-Agent</div>
                    <div className="text-xs text-muted-foreground">
                      Allow multiple AI agents to work on different cards concurrently.
                    </div>
                  </div>
                  <Switch checked={multiAgentEnabled} onCheckedChange={handleMultiAgentEnabledChange} />
                </div>

                {multiAgentEnabled && (
                  <>
                    <div className="mb-4">
                      <p className="text-xs text-muted-foreground mb-2">
                        How agents coordinate their work:
                      </p>
                      <div className="grid gap-2">
                        {mergeStrategyOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleMergeStrategyChange(opt.id)}
                            className={cn(
                              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                              mergeStrategy === opt.id
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/50'
                            )}
                          >
                            <div
                              className={cn(
                                'flex h-4 w-4 items-center justify-center rounded-full border',
                                mergeStrategy === opt.id
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground'
                              )}
                            >
                              {mergeStrategy === opt.id && <Check className="h-3 w-3" />}
                            </div>
                            {opt.icon}
                            <div className="flex-1">
                              <div className="font-medium">{opt.title}</div>
                              <div className="text-xs text-muted-foreground">{opt.description}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mb-4">
                      <p className="text-xs text-muted-foreground mb-2">
                        How to handle merge conflicts:
                      </p>
                      <div className="grid gap-2">
                        {conflictResolutionOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleConflictResolutionChange(opt.id)}
                            className={cn(
                              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                              conflictResolution === opt.id
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/50'
                            )}
                          >
                            <div
                              className={cn(
                                'flex h-4 w-4 items-center justify-center rounded-full border',
                                conflictResolution === opt.id
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground'
                              )}
                            >
                              {conflictResolution === opt.id && <Check className="h-3 w-3" />}
                            </div>
                            {opt.icon}
                            <div className="flex-1">
                              <div className="font-medium">{opt.title}</div>
                              <div className="text-xs text-muted-foreground">{opt.description}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border p-3">
                      <div className="font-medium text-sm mb-1">Max Agents Per Card</div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Maximum concurrent agents working on a single card (leave empty for unlimited)
                      </div>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        placeholder="e.g. 3"
                        value={maxAgentsPerCard}
                        onChange={(e) => handleMaxAgentsPerCardChange(e.target.value)}
                        onBlur={handleMaxAgentsPerCardBlur}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            <div className={cn(project && 'border-t pt-4')}>
              <div className="flex items-center gap-2 mb-3">
                <Key className="h-4 w-4 text-foreground/70" />
                <h3 className="text-sm font-medium">API Keys</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Configure API keys for direct AI integration. These keys are stored globally and
                used across all projects.
              </p>
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">Anthropic API Key</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showAnthropicKey ? 'text' : 'password'}
                        placeholder="sk-ant-..."
                        value={anthropicApiKey}
                        onChange={(e) => setAnthropicApiKey(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showAnthropicKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveAnthropicKey}
                      disabled={savingAnthropicKey}
                    >
                      {savingAnthropicKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium">OpenAI API Key</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showOpenaiKey ? 'text' : 'password'}
                        placeholder="sk-..."
                        value={openaiApiKey}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showOpenaiKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveOpenaiKey}
                      disabled={savingOpenaiKey}
                    >
                      {savingOpenaiKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )

      case 'usage-limits':
        return (
          <div className="grid gap-6">
            <div>
              <h3 className="text-sm font-medium mb-1">Usage & Spending Limits</h3>
              <p className="text-xs text-muted-foreground">
                Set daily and monthly limits for token usage and cost per AI tool. Leave empty for
                no limit. When limits are reached, the worker will try to fall back to the other
                tool or pause.
              </p>
            </div>

            {limitsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Claude Limits */}
                <div className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-foreground/70" />
                    <h4 className="font-medium text-sm">Claude Code</h4>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Hourly Token Limit</label>
                      <Input
                        type="number"
                        placeholder="e.g., 50000"
                        value={claudeLimits.hourlyTokenLimit}
                        onChange={(e) =>
                          setClaudeLimits((prev) => ({
                            ...prev,
                            hourlyTokenLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Daily Token Limit</label>
                      <Input
                        type="number"
                        placeholder="e.g., 100000"
                        value={claudeLimits.dailyTokenLimit}
                        onChange={(e) =>
                          setClaudeLimits((prev) => ({
                            ...prev,
                            dailyTokenLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Monthly Token Limit</label>
                      <Input
                        type="number"
                        placeholder="e.g., 3000000"
                        value={claudeLimits.monthlyTokenLimit}
                        onChange={(e) =>
                          setClaudeLimits((prev) => ({
                            ...prev,
                            monthlyTokenLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Hourly Cost Limit ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g., 5.00"
                        value={claudeLimits.hourlyCostLimit}
                        onChange={(e) =>
                          setClaudeLimits((prev) => ({
                            ...prev,
                            hourlyCostLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Daily Cost Limit ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g., 10.00"
                        value={claudeLimits.dailyCostLimit}
                        onChange={(e) =>
                          setClaudeLimits((prev) => ({
                            ...prev,
                            dailyCostLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Monthly Cost Limit ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g., 50.00"
                        value={claudeLimits.monthlyCostLimit}
                        onChange={(e) =>
                          setClaudeLimits((prev) => ({
                            ...prev,
                            monthlyCostLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingLimits}
                    onClick={() => saveToolLimits('claude', claudeLimits)}
                  >
                    {savingLimits ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Save Claude Limits
                  </Button>
                </div>

                {/* Codex Limits */}
                <div className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Code className="h-4 w-4 text-foreground/70" />
                    <h4 className="font-medium text-sm">Codex (OpenAI)</h4>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Hourly Token Limit</label>
                      <Input
                        type="number"
                        placeholder="e.g., 50000"
                        value={codexLimits.hourlyTokenLimit}
                        onChange={(e) =>
                          setCodexLimits((prev) => ({
                            ...prev,
                            hourlyTokenLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Daily Token Limit</label>
                      <Input
                        type="number"
                        placeholder="e.g., 100000"
                        value={codexLimits.dailyTokenLimit}
                        onChange={(e) =>
                          setCodexLimits((prev) => ({
                            ...prev,
                            dailyTokenLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Monthly Token Limit</label>
                      <Input
                        type="number"
                        placeholder="e.g., 3000000"
                        value={codexLimits.monthlyTokenLimit}
                        onChange={(e) =>
                          setCodexLimits((prev) => ({
                            ...prev,
                            monthlyTokenLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Hourly Cost Limit ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g., 5.00"
                        value={codexLimits.hourlyCostLimit}
                        onChange={(e) =>
                          setCodexLimits((prev) => ({
                            ...prev,
                            hourlyCostLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Daily Cost Limit ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g., 10.00"
                        value={codexLimits.dailyCostLimit}
                        onChange={(e) =>
                          setCodexLimits((prev) => ({
                            ...prev,
                            dailyCostLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Monthly Cost Limit ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="e.g., 50.00"
                        value={codexLimits.monthlyCostLimit}
                        onChange={(e) =>
                          setCodexLimits((prev) => ({
                            ...prev,
                            monthlyCostLimit: e.target.value
                          }))
                        }
                      />
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingLimits}
                    onClick={() => saveToolLimits('codex', codexLimits)}
                  >
                    {savingLimits ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Save Codex Limits
                  </Button>
                </div>

                {/* Info note */}
                <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                  <p className="font-medium mb-1">How limits work:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Hourly limits reset at the top of each hour</li>
                    <li>Daily limits reset at midnight (local time)</li>
                    <li>Monthly limits reset on the 1st of each month</li>
                    <li>
                      When a limit is reached, the worker tries the other tool if available
                    </li>
                    <li>Token counts are estimated (~4 characters per token)</li>
                  </ul>
                </div>
              </>
            )}
          </div>
        )

      case 'danger-zone':
        return (
          <div className="grid gap-4">
            {project ? (
              <div className="rounded-lg border border-destructive/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Unlink className="h-4 w-4 text-destructive" />
                  <h3 className="text-sm font-medium text-destructive">Unlink Project</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  Remove this project from Patchwork. Your files and repository will not be deleted
                  — only the project entry in Patchwork will be removed.
                </p>
                <Button
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => setShowUnlinkConfirm(true)}
                >
                  <Unlink className="h-4 w-4 mr-2" />
                  Unlink Project
                </Button>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Select a project to access danger zone options.
              </div>
            )}
          </div>
        )

      case 'shortcuts':
        return (
          <div className="grid gap-4">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Keyboard Shortcuts</h3>
            </div>
            {!supportsShortcuts ? (
              <div className="text-sm text-muted-foreground">
                Shortcuts are not available in this session. Restart the app to load the updated
                preload.
              </div>
            ) : shortcutsLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading shortcuts...
              </div>
            ) : (
              <ShortcutsEditor bindings={shortcuts} onPatch={handleShortcutsPatch} />
            )}
          </div>
        )

      default:
        return null
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Configure appearance and project settings.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-1 min-h-0">
            {/* Sidebar */}
            <nav className="w-12 sm:w-44 shrink-0 border-r py-4 group hover:w-44 transition-all duration-200">
              <div className="flex flex-col gap-1 px-2">
                {SETTINGS_SECTIONS.map((section) => {
                  const Icon = section.icon
                  const isActive = activeSection === section.id
                  const isDanger = section.id === 'danger-zone'

                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors text-sm',
                        isActive && !isDanger && 'bg-muted font-medium text-foreground',
                        isActive && isDanger && 'bg-destructive/10 text-destructive font-medium',
                        !isActive &&
                          !isDanger &&
                          'text-foreground/80 hover:text-foreground hover:bg-muted/50',
                        isDanger &&
                          !isActive &&
                          'text-destructive/80 hover:text-destructive hover:bg-destructive/5'
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          isDanger ? 'text-destructive' : 'text-foreground/70',
                          isActive && !isDanger && 'text-foreground'
                        )}
                      />
                      <span className="hidden sm:inline group-hover:inline truncate">
                        {section.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </nav>

            {/* Content */}
            <ScrollArea className="flex-1">
              <div className="p-6">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : (
                  renderSectionContent()
                )}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter className="px-6 py-4 border-t shrink-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlink Confirmation Dialog */}
      <Dialog open={showUnlinkConfirm} onOpenChange={setShowUnlinkConfirm}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Unlink Project
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to unlink &quot;{project?.name}&quot;? This will remove the
              project from Patchwork but will not delete your files.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowUnlinkConfirm(false)}
              disabled={isUnlinking}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleUnlink}
              disabled={isUnlinking}
            >
              {isUnlinking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Unlinking...
                </>
              ) : (
                'Unlink'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
