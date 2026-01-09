/**
 * AI Agents Section
 *
 * AI profiles, tool preference, thinking mode, planning mode, multi-agent settings, API keys
 */

import { useEffect } from 'react'
import {
  User,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Star,
  Brain,
  ClipboardList,
  Users,
  Key,
  Loader2,
  Eye,
  EyeOff
} from 'lucide-react'
import { Button } from '../../../../src/components/ui/button'
import { Input } from '../../../../src/components/ui/input'
import { Switch } from '../../../../src/components/ui/switch'
import { cn } from '../../../../src/lib/utils'
import { SettingsCard } from '../components/SettingsCard'
import { SettingRow } from '../components/SettingRow'
import { RadioOptionGroup } from '../components/RadioOptionGroup'
import { useSettingsContext } from '../hooks/useSettingsContext'
import { useFeatureSettings } from '../hooks/useFeatureSettings'
import { useThinkingSettings } from '../hooks/useThinkingSettings'
import { usePlanningSettings } from '../hooks/usePlanningSettings'
import { useMultiAgentSettings } from '../hooks/useMultiAgentSettings'
import { useAPIKeys } from '../hooks/useAPIKeys'
import { useAIProfiles } from '../hooks/useAIProfiles'
import {
  TOOL_OPTIONS,
  THINKING_MODE_OPTIONS,
  PLANNING_MODE_OPTIONS,
  MERGE_STRATEGY_OPTIONS,
  CONFLICT_RESOLUTION_OPTIONS
} from '../constants'
import type { ThinkingMode, PlanningMode, AIModelProvider } from '@shared/types'

export function AIAgentsSection(): React.JSX.Element {
  const { project } = useSettingsContext()

  const { toolPreference, loadFeatureSettings, handleToolPreferenceChange } = useFeatureSettings()

  const {
    thinkingEnabled,
    thinkingMode,
    thinkingBudgetTokens,
    loadThinkingSettings,
    handleThinkingEnabledChange,
    handleThinkingModeChange,
    handleThinkingBudgetChange,
    handleThinkingBudgetBlur
  } = useThinkingSettings()

  const {
    planningEnabled,
    planningMode,
    planApprovalRequired,
    loadPlanningSettings,
    handlePlanningEnabledChange,
    handlePlanningModeChange,
    handlePlanApprovalRequiredChange
  } = usePlanningSettings()

  const {
    multiAgentEnabled,
    mergeStrategy,
    conflictResolution,
    maxAgentsPerCard,
    loadMultiAgentSettings,
    handleMultiAgentEnabledChange,
    handleMergeStrategyChange,
    handleConflictResolutionChange,
    handleMaxAgentsPerCardChange,
    handleMaxAgentsPerCardBlur
  } = useMultiAgentSettings()

  const {
    anthropicApiKey,
    openaiApiKey,
    showAnthropicKey,
    showOpenaiKey,
    savingAnthropicKey,
    savingOpenaiKey,
    setAnthropicApiKey,
    setOpenaiApiKey,
    setShowAnthropicKey,
    setShowOpenaiKey,
    loadAPIKeys,
    handleSaveAnthropicKey,
    handleSaveOpenaiKey
  } = useAPIKeys()

  const {
    aiProfiles,
    aiProfilesLoading,
    editingProfile,
    isCreatingProfile,
    profileFormData,
    savingProfile,
    setProfileFormData,
    loadAIProfiles,
    handleCreateProfile,
    handleEditProfile,
    handleCancelProfileEdit,
    handleSaveProfile,
    handleDeleteProfile,
    handleSetDefaultProfile,
    handleDuplicateProfile
  } = useAIProfiles()

  useEffect(() => {
    loadAPIKeys()
    if (project) {
      loadFeatureSettings(project)
      loadThinkingSettings(project)
      loadPlanningSettings(project)
      loadMultiAgentSettings(project)
      loadAIProfiles(project.id)
    }
  }, [
    project,
    loadAPIKeys,
    loadFeatureSettings,
    loadThinkingSettings,
    loadPlanningSettings,
    loadMultiAgentSettings,
    loadAIProfiles
  ])

  return (
    <div className="space-y-6">
      {/* AI Profiles Section */}
      <SettingsCard
        title="AI Profiles"
        icon={<User className="h-4 w-4 text-foreground/70" />}
        description="Create and manage AI configuration presets for different use cases."
      >
        {!isCreatingProfile && (
          <div className="flex justify-end mb-3">
            <Button variant="outline" size="sm" onClick={handleCreateProfile}>
              <Plus className="h-3 w-3 mr-1" />
              New Profile
            </Button>
          </div>
        )}

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
              <Button
                size="sm"
                onClick={() => handleSaveProfile(project?.id)}
                disabled={savingProfile}
              >
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
                      onClick={() => {
                        handleSetDefaultProfile(profile.id)
                        if (project) loadAIProfiles(project.id)
                      }}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    title="Duplicate"
                    onClick={() => {
                      handleDuplicateProfile(profile.id, profile.name)
                      if (project) loadAIProfiles(project.id)
                    }}
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
                    onClick={() => {
                      handleDeleteProfile(profile.id)
                      if (project) loadAIProfiles(project.id)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      {/* Tool Preference */}
      {project && (
        <SettingsCard
          title="Tool Preference"
          description="Select which AI tool the worker should use."
        >
          <RadioOptionGroup
            options={TOOL_OPTIONS}
            value={toolPreference}
            onChange={(pref) => handleToolPreferenceChange(project, pref)}
          />
          <p className="text-xs text-muted-foreground mt-3">
            Stored in this project&apos;s policy (database). The worker still falls back if the
            selected CLI isn&apos;t installed.
          </p>
        </SettingsCard>
      )}

      {/* Extended Thinking */}
      {project && (
        <SettingsCard
          title="Extended Thinking"
          icon={<Brain className="h-4 w-4 text-foreground/70" />}
        >
          <div className="space-y-3">
            <SettingRow
              title="Enable Extended Thinking"
              description='Allow Claude to "think" longer before responding, improving complex reasoning.'
              noBorder
            >
              <Switch
                checked={thinkingEnabled}
                onCheckedChange={(enabled) => handleThinkingEnabledChange(project, enabled)}
              />
            </SettingRow>

            {thinkingEnabled && (
              <>
                <p className="text-xs text-muted-foreground">
                  Select thinking depth (more tokens = longer thinking time):
                </p>
                <RadioOptionGroup
                  options={THINKING_MODE_OPTIONS.filter((opt) => opt.id !== 'none')}
                  value={thinkingMode}
                  onChange={(mode) => handleThinkingModeChange(project, mode)}
                />

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
                    onBlur={() => handleThinkingBudgetBlur(project)}
                  />
                </div>
              </>
            )}
          </div>
        </SettingsCard>
      )}

      {/* Planning Mode */}
      {project && (
        <SettingsCard
          title="Planning Mode"
          icon={<ClipboardList className="h-4 w-4 text-foreground/70" />}
        >
          <div className="space-y-3">
            <SettingRow
              title="Enable Planning"
              description="Generate an implementation plan before coding to improve task success."
              noBorder
            >
              <Switch
                checked={planningEnabled}
                onCheckedChange={(enabled) => handlePlanningEnabledChange(project, enabled)}
              />
            </SettingRow>

            {planningEnabled && (
              <>
                <p className="text-xs text-muted-foreground">
                  Select planning depth (more detail = better guidance for AI):
                </p>
                <RadioOptionGroup
                  options={PLANNING_MODE_OPTIONS.filter((opt) => opt.id !== 'skip')}
                  value={planningMode}
                  onChange={(mode) => handlePlanningModeChange(project, mode)}
                />

                <SettingRow
                  title="Require Plan Approval"
                  description="Pause for user approval before implementing the plan."
                >
                  <Switch
                    checked={planApprovalRequired}
                    onCheckedChange={(required) =>
                      handlePlanApprovalRequiredChange(project, required)
                    }
                  />
                </SettingRow>
              </>
            )}
          </div>
        </SettingsCard>
      )}

      {/* Multi-Agent Mode */}
      {project && (
        <SettingsCard
          title="Multi-Agent Mode"
          icon={<Users className="h-4 w-4 text-foreground/70" />}
        >
          <div className="space-y-3">
            <SettingRow
              title="Enable Multi-Agent"
              description="Allow multiple AI agents to work on different cards concurrently."
              noBorder
            >
              <Switch
                checked={multiAgentEnabled}
                onCheckedChange={(enabled) => handleMultiAgentEnabledChange(project, enabled)}
              />
            </SettingRow>

            {multiAgentEnabled && (
              <>
                <div className="mb-4">
                  <p className="text-xs text-muted-foreground mb-2">
                    How agents coordinate their work:
                  </p>
                  <RadioOptionGroup
                    options={MERGE_STRATEGY_OPTIONS}
                    value={mergeStrategy}
                    onChange={(strategy) => handleMergeStrategyChange(project, strategy)}
                  />
                </div>

                <div className="mb-4">
                  <p className="text-xs text-muted-foreground mb-2">
                    How to handle merge conflicts:
                  </p>
                  <RadioOptionGroup
                    options={CONFLICT_RESOLUTION_OPTIONS}
                    value={conflictResolution}
                    onChange={(resolution) => handleConflictResolutionChange(project, resolution)}
                  />
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
                    onBlur={() => handleMaxAgentsPerCardBlur(project)}
                  />
                </div>
              </>
            )}
          </div>
        </SettingsCard>
      )}

      {/* API Keys */}
      <SettingsCard
        title="API Keys"
        icon={<Key className="h-4 w-4 text-foreground/70" />}
        description="Configure API keys for direct AI integration. These keys are stored globally and used across all projects."
      >
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
                  {showAnthropicKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
                  {showOpenaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
      </SettingsCard>
    </div>
  )
}
