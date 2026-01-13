import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { cn } from '../lib/utils'
import {
  Check,
  Loader2,
  Sparkles,
  Bot,
  Code,
  Sun,
  Moon,
  Monitor,
  Palette,
  Settings2,
  AlertTriangle,
  Key,
  Unlink,
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
  VolumeX
} from 'lucide-react'
import type { PolicyConfig, Project, ThemePreference, ThinkingMode, PlanningMode, MergeStrategy, ConflictResolution, AIProfile, AIModelProvider } from '../../../shared/types'
import { useTheme } from '../context/ThemeContext'
import { ShortcutsEditor } from './ShortcutsEditor'
import type { ShortcutBinding } from '@shared/shortcuts'

export type WorkerToolPreference = 'auto' | 'claude' | 'codex'
type SettingsSection = 'appearance' | 'features' | 'shortcuts' | 'ai-agents' | 'danger-zone'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  onSetWorkerToolPreference: (toolPreference: WorkerToolPreference) => Promise<void>
  onSetWorkerRollbackOnCancel: (rollbackOnCancel: boolean) => Promise<void>
  onSetShowPullRequestsSection: (showPullRequestsSection: boolean) => Promise<void>
}

function readToolPreference(project: Project): WorkerToolPreference {
  if (!project.policy_json) return 'auto'
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    const pref = policy?.worker?.toolPreference
    if (pref === 'claude' || pref === 'codex' || pref === 'auto') return pref
    return 'auto'
  } catch {
    return 'auto'
  }
}

function readRollbackOnCancel(project: Project): boolean {
  if (!project.policy_json) return false
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return !!policy?.worker?.rollbackOnCancel
  } catch {
    return false
  }
}

function readShowPullRequestsSection(project: Project): boolean {
  if (!project.policy_json) return false
  try {
    const policy = JSON.parse(project.policy_json) as PolicyConfig
    return !!policy?.ui?.showPullRequestsSection
  } catch {
    return false
  }
}

interface E2ESettings {
  enabled: boolean
  maxRetries: number
  timeoutMinutes: number
  createTestsIfMissing: boolean
  testCommand: string
}

interface ThinkingSettings {
  enabled: boolean
  mode: ThinkingMode
  budgetTokens: number | undefined
}

function readThinkingSettings(project: Project): ThinkingSettings {
  const defaults: ThinkingSettings = {
    enabled: true,
    mode: 'medium',
    budgetTokens: undefined
  }
  if (!project.policy_json) return defaults
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

interface PlanningSettings {
  enabled: boolean
  mode: PlanningMode
  approvalRequired: boolean
}

function readPlanningSettings(project: Project): PlanningSettings {
  const defaults: PlanningSettings = {
    enabled: true,
    mode: 'lite',
    approvalRequired: false
  }
  if (!project.policy_json) return defaults
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

function readMultiAgentSettings(project: Project): MultiAgentSettings {
  const defaults: MultiAgentSettings = {
    enabled: false,
    mergeStrategy: 'sequential',
    conflictResolution: 'auto',
    maxAgentsPerCard: undefined
  }
  if (!project.policy_json) return defaults
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

interface NotificationsSettings {
  audioEnabled: boolean
  soundOnComplete: boolean
  soundOnError: boolean
  soundOnApproval: boolean
}

function readNotificationsSettings(project: Project): NotificationsSettings {
  const defaults: NotificationsSettings = {
    audioEnabled: false,
    soundOnComplete: true,
    soundOnError: true,
    soundOnApproval: true
  }
  if (!project.policy_json) return defaults
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

function readE2ESettings(project: Project): E2ESettings {
  const defaults: E2ESettings = {
    enabled: false,
    maxRetries: 3,
    timeoutMinutes: 10,
    createTestsIfMissing: true,
    testCommand: ''
  }
  if (!project.policy_json) return defaults
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

const SETTINGS_SECTIONS: {
  id: SettingsSection
  label: string
  icon: typeof Palette
}[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'features', label: 'Features', icon: Settings2 },
  { id: 'shortcuts', label: 'Shortcuts', icon: Key },
  { id: 'ai-agents', label: 'AI Agents', icon: Bot },
  { id: 'danger-zone', label: 'Danger Zone', icon: AlertTriangle }
]

export function SettingsDialog({
  open,
  onOpenChange,
  project,
  onSetWorkerToolPreference,
  onSetWorkerRollbackOnCancel,
  onSetShowPullRequestsSection
}: SettingsDialogProps): React.JSX.Element {
  const { theme: currentTheme, setTheme } = useTheme()

  // Section navigation
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')

  // Local state for settings (synced from project)
  const [toolPreference, setToolPreference] = useState<WorkerToolPreference>(() =>
    readToolPreference(project)
  )
  const [rollbackOnCancel, setRollbackOnCancel] = useState(() => readRollbackOnCancel(project))
  const [showPullRequestsSection, setShowPullRequestsSection] = useState(() =>
    readShowPullRequestsSection(project)
  )

  // API Keys state
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [savingAnthropicKey, setSavingAnthropicKey] = useState(false)
  const [savingOpenaiKey, setSavingOpenaiKey] = useState(false)

  // Shortcuts state
  const [shortcuts, setShortcuts] = useState<ShortcutBinding[]>([])
  const [shortcutsLoading, setShortcutsLoading] = useState(false)

  // Unlink confirmation
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)

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

  // Reset to appearance section only when dialog opens (not on every project change)
  useEffect(() => {
    if (open) {
      setActiveSection('appearance')
      setShowUnlinkConfirm(false)
    }
  }, [open])

  // Sync settings state when project changes
  useEffect(() => {
    if (!open) return
    setToolPreference(readToolPreference(project))
    setRollbackOnCancel(readRollbackOnCancel(project))
    setShowPullRequestsSection(readShowPullRequestsSection(project))

    // Sync E2E settings
    const e2e = readE2ESettings(project)
    setE2eEnabled(e2e.enabled)
    setE2eMaxRetries(e2e.maxRetries)
    setE2eTimeoutMinutes(e2e.timeoutMinutes)
    setE2eCreateTestsIfMissing(e2e.createTestsIfMissing)
    setE2eTestCommand(e2e.testCommand)

    // Sync thinking settings
    const thinking = readThinkingSettings(project)
    setThinkingEnabled(thinking.enabled)
    setThinkingMode(thinking.mode)
    setThinkingBudgetTokens(thinking.budgetTokens?.toString() || '')

    // Sync planning settings
    const planning = readPlanningSettings(project)
    setPlanningEnabled(planning.enabled)
    setPlanningMode(planning.mode)
    setPlanApprovalRequired(planning.approvalRequired)

    // Sync multi-agent settings
    const multiAgent = readMultiAgentSettings(project)
    setMultiAgentEnabled(multiAgent.enabled)
    setMergeStrategy(multiAgent.mergeStrategy)
    setConflictResolution(multiAgent.conflictResolution)
    setMaxAgentsPerCard(multiAgent.maxAgentsPerCard?.toString() || '')

    // Load API keys
    const loadApiKeys = async () => {
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
    }
    loadApiKeys()
  }, [open, project])

  const loadShortcuts = useCallback(async (): Promise<void> => {
    setShortcutsLoading(true)
    try {
      const data = (await window.electron.ipcRenderer.invoke(
        'shortcuts:getAll'
      )) as ShortcutBinding[]
      setShortcuts(data)
    } catch {
      setShortcuts([])
    } finally {
      setShortcutsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    loadShortcuts()
  }, [open, loadShortcuts])

  useEffect(() => {
    if (!open) return
    const handler = () => loadShortcuts()
    window.electron.ipcRenderer.on('shortcutsUpdated', handler)
    return () => {
      window.electron.ipcRenderer.removeListener('shortcutsUpdated', handler)
    }
  }, [open, loadShortcuts])

  const handleShortcutsPatch = useCallback(
    async (patch: Record<string, string | null>) => {
      await window.electron.ipcRenderer.invoke('shortcuts:setAll', { patch })
      await loadShortcuts()
      toast.success('Shortcut updated')
    },
    [loadShortcuts]
  )

  // Instant apply handlers
  const handleThemeChange = useCallback(
    async (newTheme: ThemePreference) => {
      try {
        await setTheme(newTheme)
        toast.success('Theme updated', {
          description: `Switched to ${newTheme} theme`
        })
      } catch (err) {
        toast.error('Failed to update theme', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [setTheme]
  )

  const handleToolPreferenceChange = useCallback(
    async (newPref: WorkerToolPreference) => {
      const previousValue = toolPreference
      setToolPreference(newPref) // Optimistic update
      try {
        await onSetWorkerToolPreference(newPref)
        toast.success('AI tool preference updated', {
          description: `Worker will use ${newPref === 'auto' ? 'Auto' : newPref === 'claude' ? 'Claude Code' : 'Codex'}`
        })
      } catch (err) {
        setToolPreference(previousValue) // Rollback
        toast.error('Failed to update tool preference', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [toolPreference, onSetWorkerToolPreference]
  )

  const handleRollbackOnCancelChange = useCallback(
    async (enabled: boolean) => {
      const previousValue = rollbackOnCancel
      setRollbackOnCancel(enabled) // Optimistic update
      try {
        await onSetWorkerRollbackOnCancel(enabled)
        toast.success('Cancel behavior updated', {
          description: enabled
            ? 'Changes will be rolled back on cancel'
            : 'Changes will be kept on cancel'
        })
      } catch (err) {
        setRollbackOnCancel(previousValue) // Rollback
        toast.error('Failed to update cancel behavior', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [rollbackOnCancel, onSetWorkerRollbackOnCancel]
  )

  const handleShowPRsSectionChange = useCallback(
    async (enabled: boolean) => {
      const previousValue = showPullRequestsSection
      setShowPullRequestsSection(enabled) // Optimistic update
      try {
        await onSetShowPullRequestsSection(enabled)
        toast.success('Board layout updated', {
          description: enabled
            ? 'Pull requests section is now visible'
            : 'Pull requests section is now hidden'
        })
      } catch (err) {
        setShowPullRequestsSection(previousValue) // Rollback
        toast.error('Failed to update board layout', {
          description: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    },
    [showPullRequestsSection, onSetShowPullRequestsSection]
  )

  const updateE2ESetting = useCallback(
    async (update: Partial<E2ESettings>) => {
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

  const updateThinkingSetting = useCallback(
    async (update: Partial<ThinkingSettings>) => {
      try {
        await window.projectAPI.updateFeatureConfig('thinking', update)
        toast.success('Thinking settings updated')
      } catch (err) {
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

  const handleE2eEnabledChange = useCallback(
    (enabled: boolean) => {
      setE2eEnabled(enabled)
      updateE2ESetting({ enabled })
    },
    [updateE2ESetting]
  )

  const handleE2eMaxRetriesChange = useCallback(
    (value: string) => {
      const num = parseInt(value, 10)
      if (num >= 1 && num <= 10) {
        setE2eMaxRetries(num)
        updateE2ESetting({ maxRetries: num })
      }
    },
    [updateE2ESetting]
  )

  const handleE2eTimeoutChange = useCallback(
    (value: string) => {
      const num = parseInt(value, 10)
      if (num >= 1 && num <= 60) {
        setE2eTimeoutMinutes(num)
        updateE2ESetting({ timeoutMinutes: num })
      }
    },
    [updateE2ESetting]
  )

  const handleE2eCreateTestsChange = useCallback(
    (enabled: boolean) => {
      setE2eCreateTestsIfMissing(enabled)
      updateE2ESetting({ createTestsIfMissing: enabled })
    },
    [updateE2ESetting]
  )

  const handleE2eTestCommandChange = useCallback(
    (value: string) => {
      setE2eTestCommand(value)
    },
    []
  )

  const handleE2eTestCommandBlur = useCallback(() => {
    updateE2ESetting({ testCommand: e2eTestCommand || undefined })
  }, [e2eTestCommand, updateE2ESetting])

  // Thinking mode handlers
  const handleThinkingEnabledChange = useCallback(
    (enabled: boolean) => {
      setThinkingEnabled(enabled)
      updateThinkingSetting({ enabled })
    },
    [updateThinkingSetting]
  )

  const handleThinkingModeChange = useCallback(
    (mode: ThinkingMode) => {
      setThinkingMode(mode)
      updateThinkingSetting({ mode })
    },
    [updateThinkingSetting]
  )

  const handleThinkingBudgetChange = useCallback((value: string) => {
    setThinkingBudgetTokens(value)
  }, [])

  const handleThinkingBudgetBlur = useCallback(() => {
    const num = parseInt(thinkingBudgetTokens, 10)
    if (num > 0) {
      updateThinkingSetting({ budgetTokens: num })
    } else if (thinkingBudgetTokens === '') {
      updateThinkingSetting({ budgetTokens: undefined })
    }
  }, [thinkingBudgetTokens, updateThinkingSetting])

  // Planning mode handlers
  const updatePlanningSetting = useCallback(
    async (update: Partial<PlanningSettings>) => {
      try {
        await window.projectAPI.updateFeatureConfig('planning', update)
        toast.success('Planning settings updated')
      } catch (err) {
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
    (enabled: boolean) => {
      setPlanningEnabled(enabled)
      updatePlanningSetting({ enabled })
    },
    [updatePlanningSetting]
  )

  const handlePlanningModeChange = useCallback(
    (mode: PlanningMode) => {
      setPlanningMode(mode)
      updatePlanningSetting({ mode })
    },
    [updatePlanningSetting]
  )

  const handlePlanApprovalRequiredChange = useCallback(
    (required: boolean) => {
      setPlanApprovalRequired(required)
      updatePlanningSetting({ approvalRequired: required })
    },
    [updatePlanningSetting]
  )

  // Multi-Agent handlers
  const updateMultiAgentSetting = useCallback(
    async (update: Partial<MultiAgentSettings>) => {
      try {
        await window.projectAPI.updateFeatureConfig('multiAgent', update)
        toast.success('Multi-Agent settings updated')
      } catch (err) {
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
    (enabled: boolean) => {
      setMultiAgentEnabled(enabled)
      updateMultiAgentSetting({ enabled })
    },
    [updateMultiAgentSetting]
  )

  const handleMergeStrategyChange = useCallback(
    (strategy: MergeStrategy) => {
      setMergeStrategy(strategy)
      updateMultiAgentSetting({ mergeStrategy: strategy })
    },
    [updateMultiAgentSetting]
  )

  const handleConflictResolutionChange = useCallback(
    (resolution: ConflictResolution) => {
      setConflictResolution(resolution)
      updateMultiAgentSetting({ conflictResolution: resolution })
    },
    [updateMultiAgentSetting]
  )

  const handleMaxAgentsPerCardChange = useCallback((value: string) => {
    setMaxAgentsPerCard(value)
  }, [])

  const handleMaxAgentsPerCardBlur = useCallback(() => {
    const num = parseInt(maxAgentsPerCard, 10)
    if (num > 0) {
      updateMultiAgentSetting({ maxAgentsPerCard: num })
    } else if (maxAgentsPerCard === '') {
      updateMultiAgentSetting({ maxAgentsPerCard: undefined })
    }
  }, [maxAgentsPerCard, updateMultiAgentSetting])

  // Audio notifications handlers
  const updateNotificationSetting = useCallback(
    async (update: Partial<NotificationsSettings>) => {
      try {
        await window.projectAPI.updateFeatureConfig('notifications', update)
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
    (enabled: boolean) => {
      setAudioEnabled(enabled)
      updateNotificationSetting({ audioEnabled: enabled })
    },
    [updateNotificationSetting]
  )

  const handleSoundOnCompleteChange = useCallback(
    (enabled: boolean) => {
      setSoundOnComplete(enabled)
      updateNotificationSetting({ soundOnComplete: enabled })
    },
    [updateNotificationSetting]
  )

  const handleSoundOnErrorChange = useCallback(
    (enabled: boolean) => {
      setSoundOnError(enabled)
      updateNotificationSetting({ soundOnError: enabled })
    },
    [updateNotificationSetting]
  )

  const handleSoundOnApprovalChange = useCallback(
    (enabled: boolean) => {
      setSoundOnApproval(enabled)
      updateNotificationSetting({ soundOnApproval: enabled })
    },
    [updateNotificationSetting]
  )

  // AI Profiles handlers
  const loadAIProfiles = useCallback(async () => {
    setAiProfilesLoading(true)
    try {
      const result = await window.projectAPI.getAIProfiles()
      if (result.error) {
        toast.error('Failed to load AI profiles', { description: result.error })
      } else {
        setAiProfiles(result.profiles)
      }
    } catch (err) {
      toast.error('Failed to load AI profiles', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setAiProfilesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && activeSection === 'ai-agents') {
      loadAIProfiles()
    }
  }, [open, activeSection, loadAIProfiles])

  const resetProfileForm = useCallback(() => {
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

  const handleCreateProfile = useCallback(() => {
    resetProfileForm()
    setEditingProfile(null)
    setIsCreatingProfile(true)
  }, [resetProfileForm])

  const handleEditProfile = useCallback((profile: AIProfile) => {
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

  const handleCancelProfileEdit = useCallback(() => {
    setIsCreatingProfile(false)
    setEditingProfile(null)
    resetProfileForm()
  }, [resetProfileForm])

  const handleSaveProfile = useCallback(async () => {
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
        thinkingBudgetTokens: profileFormData.thinkingBudgetTokens ? parseInt(profileFormData.thinkingBudgetTokens, 10) : undefined,
        planningEnabled: profileFormData.planningEnabled,
        planningMode: profileFormData.planningMode
      }

      if (editingProfile) {
        const result = await window.projectAPI.updateAIProfile(editingProfile.id, data)
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
        const result = await window.projectAPI.createAIProfile(data)
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
  }, [profileFormData, editingProfile, resetProfileForm, loadAIProfiles])

  const handleDeleteProfile = useCallback(async (profileId: string) => {
    try {
      const result = await window.projectAPI.deleteAIProfile(profileId)
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
  }, [loadAIProfiles])

  const handleSetDefaultProfile = useCallback(async (profileId: string) => {
    try {
      const result = await window.projectAPI.setDefaultAIProfile(profileId)
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
  }, [loadAIProfiles])

  const handleDuplicateProfile = useCallback(async (profileId: string, currentName: string) => {
    try {
      const result = await window.projectAPI.duplicateAIProfile(profileId, `${currentName} (Copy)`)
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
  }, [loadAIProfiles])

  const handleSaveAnthropicKey = useCallback(async () => {
    setSavingAnthropicKey(true)
    try {
      await window.electron.ipcRenderer.invoke('setApiKey', {
        key: 'anthropic',
        value: anthropicApiKey
      })
      toast.success('Anthropic API key saved')
    } catch (err) {
      toast.error('Failed to save Anthropic API key', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSavingAnthropicKey(false)
    }
  }, [anthropicApiKey])

  const handleSaveOpenaiKey = useCallback(async () => {
    setSavingOpenaiKey(true)
    try {
      await window.electron.ipcRenderer.invoke('setApiKey', { key: 'openai', value: openaiApiKey })
      toast.success('OpenAI API key saved')
    } catch (err) {
      toast.error('Failed to save OpenAI API key', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setSavingOpenaiKey(false)
    }
  }, [openaiApiKey])

  const handleUnlink = useCallback(async () => {
    setIsUnlinking(true)
    try {
      await window.electron.ipcRenderer.invoke('unlinkProject', { projectId: project.id })
      toast.success('Project unlinked', {
        description: `"${project.name}" has been removed from FlowPatch`
      })
      setShowUnlinkConfirm(false)
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to unlink project', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setIsUnlinking(false)
    }
  }, [project.id, project.name, onOpenChange])

  const handleReconfigureLabels = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('resetLabelWizard', { projectId: project.id })
      toast.success('Label setup reopened')
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to reopen label setup', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }, [onOpenChange, project.id])

  const handleReopenGithubProjectPrompt = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('resetGithubProjectPrompt', {
        projectId: project.id
      })
      toast.success('GitHub Project prompt reopened')
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to reopen GitHub Project prompt', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }, [onOpenChange, project.id])

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

  // Render section content
  const renderSectionContent = () => {
    switch (activeSection) {
      case 'appearance':
        return (
          <div className="grid gap-4">
            <div>
              <h3 className="text-sm font-medium mb-1">Theme</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Choose how FlowPatch looks to you.
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
                    currentTheme === opt.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border',
                      currentTheme === opt.id
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground'
                    )}
                  >
                    {currentTheme === opt.id && <Check className="h-3 w-3" />}
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
            <div className="grid gap-2">
              <h3 className="text-sm font-medium">Cancel Behavior</h3>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="flex-1">
                  <div className="font-medium text-sm">Rollback changes on cancel</div>
                  <div className="text-xs text-muted-foreground">
                    If you move a running card back to Draft (or forward to In Review/Testing/Done),
                    the worker is canceled. Enable this to attempt to roll back the worker&apos;s
                    local changes.
                  </div>
                </div>
                <Switch checked={rollbackOnCancel} onCheckedChange={handleRollbackOnCancelChange} />
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
                    AI creates and runs Playwright tests before pushing code
                  </div>
                </div>
                <Switch checked={e2eEnabled} onCheckedChange={handleE2eEnabledChange} />
              </div>

              {e2eEnabled && (
                <>
                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Max Fix Attempts</div>
                      <div className="text-xs text-muted-foreground">
                        How many times AI attempts to fix failing tests (1-10)
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      className="w-20"
                      value={e2eMaxRetries}
                      onChange={(e) => handleE2eMaxRetriesChange(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Timeout (minutes)</div>
                      <div className="text-xs text-muted-foreground">
                        Maximum time for each E2E test run (1-60)
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      className="w-20"
                      value={e2eTimeoutMinutes}
                      onChange={(e) => handleE2eTimeoutChange(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Create Tests if Missing</div>
                      <div className="text-xs text-muted-foreground">
                        AI will create E2E tests if none exist in the project
                      </div>
                    </div>
                    <Switch
                      checked={e2eCreateTestsIfMissing}
                      onCheckedChange={handleE2eCreateTestsChange}
                    />
                  </div>

                  <div className="rounded-lg border p-3">
                    <div className="font-medium text-sm mb-1">Test Command</div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Command to run E2E tests (leave empty for default: npx playwright test)
                    </div>
                    <Input
                      placeholder="npx playwright test"
                      value={e2eTestCommand}
                      onChange={(e) => handleE2eTestCommandChange(e.target.value)}
                      onBlur={handleE2eTestCommandBlur}
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
                  <div className="font-medium text-sm">Enable Audio Notifications</div>
                  <div className="text-xs text-muted-foreground">
                    Play sounds when tasks complete, fail, or need approval
                  </div>
                </div>
                <Switch checked={audioEnabled} onCheckedChange={handleAudioEnabledChange} />
              </div>

              {audioEnabled && (
                <>
                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Sound on Completion</div>
                      <div className="text-xs text-muted-foreground">
                        Play a sound when a task completes successfully
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
                        Play a sound when a task fails or encounters an error
                      </div>
                    </div>
                    <Switch
                      checked={soundOnError}
                      onCheckedChange={handleSoundOnErrorChange}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Sound on Approval Needed</div>
                      <div className="text-xs text-muted-foreground">
                        Play a sound when a task requires your approval
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
                        onChange={(e) => setProfileFormData(prev => ({ ...prev, name: e.target.value }))}
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <label className="text-xs font-medium">Description</label>
                      <Input
                        placeholder="Brief description of this profile"
                        value={profileFormData.description}
                        onChange={(e) => setProfileFormData(prev => ({ ...prev, description: e.target.value }))}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <label className="text-xs font-medium">Model Provider</label>
                        <select
                          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                          value={profileFormData.modelProvider}
                          onChange={(e) => setProfileFormData(prev => ({ ...prev, modelProvider: e.target.value as AIModelProvider }))}
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
                          onChange={(e) => setProfileFormData(prev => ({ ...prev, modelName: e.target.value }))}
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
                          onChange={(e) => setProfileFormData(prev => ({ ...prev, temperature: e.target.value }))}
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-xs font-medium">Max Tokens</label>
                        <Input
                          type="number"
                          min="1"
                          placeholder="e.g., 4096"
                          value={profileFormData.maxTokens}
                          onChange={(e) => setProfileFormData(prev => ({ ...prev, maxTokens: e.target.value }))}
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
                          onChange={(e) => setProfileFormData(prev => ({ ...prev, topP: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="grid gap-1.5">
                      <label className="text-xs font-medium">System Prompt</label>
                      <textarea
                        className="min-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y"
                        placeholder="Custom system instructions for this profile"
                        value={profileFormData.systemPrompt}
                        onChange={(e) => setProfileFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
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
                          onCheckedChange={(checked) => setProfileFormData(prev => ({ ...prev, thinkingEnabled: checked }))}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <div className="font-medium text-sm">Planning</div>
                          <div className="text-xs text-muted-foreground">Generate plan first</div>
                        </div>
                        <Switch
                          checked={profileFormData.planningEnabled}
                          onCheckedChange={(checked) => setProfileFormData(prev => ({ ...prev, planningEnabled: checked }))}
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
                            onChange={(e) => setProfileFormData(prev => ({ ...prev, thinkingMode: e.target.value as ThinkingMode }))}
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
                            onChange={(e) => setProfileFormData(prev => ({ ...prev, thinkingBudgetTokens: e.target.value }))}
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
                          onChange={(e) => setProfileFormData(prev => ({ ...prev, planningMode: e.target.value as PlanningMode }))}
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

            <div className="border-t pt-4">
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
                Stored in this project&apos;s policy (database). The worker still falls back if the
                selected CLI isn&apos;t installed.
              </p>
            </div>

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
                  <div className="grid gap-2 mb-4">
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

                  <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Require Plan Approval</div>
                      <div className="text-xs text-muted-foreground">
                        Pause the worker after plan generation for manual review before AI starts coding.
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

            <div className="border-t pt-4">
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

      case 'danger-zone':
        return (
          <div className="grid gap-4">
            <div className="rounded-lg border border-destructive/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Unlink className="h-4 w-4 text-destructive" />
                <h3 className="text-sm font-medium text-destructive">Unlink Project</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Remove this project from FlowPatch. Your files and repository will not be deleted —
                only the project entry in FlowPatch will be removed.
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
          </div>
        )

      case 'shortcuts':
        return (
          <div className="grid gap-4">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Keyboard Shortcuts</h3>
            </div>
            {shortcutsLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading shortcuts...
              </div>
            ) : (
              <ShortcutsEditor bindings={shortcuts} onPatch={handleShortcutsPatch} />
            )}
          </div>
        )
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
              <div className="p-6">{renderSectionContent()}</div>
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
              Are you sure you want to unlink &quot;{project.name}&quot;? This will remove the
              project from FlowPatch but will not delete your files.
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
