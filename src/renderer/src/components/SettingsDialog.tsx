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
  EyeOff
} from 'lucide-react'
import type { PolicyConfig, Project, ThemePreference } from '../../../shared/types'
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
        description: `"${project.name}" has been removed from Patchwork`
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

  // Render section content
  const renderSectionContent = () => {
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
          </div>
        )

      case 'ai-agents':
        return (
          <div className="grid gap-6">
            <div className="grid gap-2">
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
                Remove this project from Patchwork. Your files and repository will not be deleted —
                only the project entry in Patchwork will be removed.
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
