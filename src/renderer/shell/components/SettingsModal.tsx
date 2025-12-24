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
  EyeOff
} from 'lucide-react'
import { ShortcutsEditor } from '../../src/components/ShortcutsEditor'
import type { ShortcutBinding } from '@shared/shortcuts'
import type { Project } from '@shared/types'

type SettingsSection = 'appearance' | 'features' | 'shortcuts' | 'ai-agents' | 'danger-zone'
type ThemePreference = 'light' | 'dark' | 'system'
type WorkerToolPreference = 'auto' | 'claude' | 'codex'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
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
  const [showPullRequestsSection, setShowPullRequestsSection] = useState(false)

  // API Keys
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [savingAnthropicKey, setSavingAnthropicKey] = useState(false)
  const [savingOpenaiKey, setSavingOpenaiKey] = useState(false)

  // Unlink confirmation
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)

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
      setShowPullRequestsSection(!!policy?.ui?.showPullRequestsSection)
    } catch {
      setToolPreference('auto')
      setRollbackOnCancel(false)
      setShowPullRequestsSection(false)
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
            {project && (
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
                  Stored in this project&apos;s policy (database). The worker still falls back if
                  the selected CLI isn&apos;t installed.
                </p>
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
