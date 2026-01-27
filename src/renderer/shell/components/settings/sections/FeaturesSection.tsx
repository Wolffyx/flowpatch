/**
 * Features Section
 *
 * Feature-related settings (cancel behavior, base branch, board settings, etc.)
 */

import { useEffect, useCallback } from 'react'
import { Settings2, Volume2, VolumeX, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../../../src/components/ui/button'
import { Input } from '../../../../src/components/ui/input'
import { Switch } from '../../../../src/components/ui/switch'
import { Loader2 } from 'lucide-react'
import { SettingsCard } from '../components/SettingsCard'
import { SettingRow } from '../components/SettingRow'
import { useSettingsContext } from '../hooks/useSettingsContext'
import { useFeatureSettings } from '../hooks/useFeatureSettings'
import { useE2ESettings } from '../hooks/useE2ESettings'
import { useNotificationSettings } from '../hooks/useNotificationSettings'
import { useSyncSettings } from '../hooks/useSyncSettings'
import { useWorkerPipelineSettings } from '../hooks/useWorkerPipelineSettings'
import { useTestModeSettings } from '../hooks/useTestModeSettings'
import { useManualTestSettings } from '../hooks/useManualTestSettings'
import { useProviderSwitchSettings } from '../hooks/useProviderSwitchSettings'
import { useAIDebugLogging } from '../hooks/useAIDebugLogging'
import type { ProviderSwitchMode, ExhaustedBehavior } from '../types'

export function FeaturesSection(): React.JSX.Element {
  const { project, onClose } = useSettingsContext()

  const {
    rollbackOnCancel,
    baseBranch,
    showPullRequestsSection,
    savingBaseBranch,
    setBaseBranch,
    loadFeatureSettings,
    handleRollbackOnCancelChange,
    handleBaseBranchSave,
    handleShowPRsSectionChange
  } = useFeatureSettings()

  const {
    e2eEnabled,
    e2eMaxRetries,
    e2eTimeoutMinutes,
    e2eCreateTestsIfMissing,
    e2eTestCommand,
    e2eAppType,
    e2eTestPersistence,
    e2eDevServerCommand,
    e2eDevServerPort,
    e2eBaseUrl,
    loadE2ESettings,
    handleE2eEnabledChange,
    handleE2eMaxRetriesChange,
    handleE2eTimeoutChange,
    handleE2eCreateTestsChange,
    handleE2eTestCommandChange,
    handleE2eTestCommandBlur,
    handleE2eAppTypeChange,
    handleE2eTestPersistenceChange,
    handleE2eDevServerCommandChange,
    handleE2eDevServerCommandBlur,
    handleE2eDevServerPortChange,
    handleE2eBaseUrlChange,
    handleE2eBaseUrlBlur
  } = useE2ESettings()

  const {
    audioEnabled,
    soundOnComplete,
    soundOnError,
    soundOnApproval,
    loadNotificationSettings,
    handleAudioEnabledChange,
    handleSoundOnCompleteChange,
    handleSoundOnErrorChange,
    handleSoundOnApprovalChange
  } = useNotificationSettings()

  const {
    syncPollInterval,
    autoSyncOnAction,
    loadSyncSettings,
    handleSyncPollIntervalChange,
    handleAutoSyncOnActionChange
  } = useSyncSettings()

  const {
    leaseRenewalInterval,
    pipelineTimeout,
    pipelineMaxRetries,
    pipelineRetryDelay,
    loadWorkerPipelineSettings,
    handleLeaseRenewalIntervalChange,
    handlePipelineTimeoutChange,
    handlePipelineMaxRetriesChange,
    handlePipelineRetryDelayChange
  } = useWorkerPipelineSettings()

  const {
    testModeEnabled,
    loading: testModeLoading,
    loadTestModeSettings,
    handleTestModeChange
  } = useTestModeSettings()
  const {
    aiDebugLoggingEnabled,
    loading: aiDebugLoggingLoading,
    handleAIDebugLoggingChange
  } = useAIDebugLogging()

  const {
    autoPromptAfterAI,
    keepWorktreeForManualTest,
    defaultTestLocation,
    loadManualTestSettings,
    handleAutoPromptChange,
    handleKeepWorktreeChange,
    handleDefaultLocationChange
  } = useManualTestSettings()

  const {
    mode: providerSwitchMode,
    exhaustedBehavior,
    retryIntervalMinutes,
    maxWaitMinutes,
    notifyOnSwitch,
    loadProviderSwitchSettings,
    handleModeChange: handleProviderSwitchModeChange,
    handleExhaustedBehaviorChange,
    handleRetryIntervalChange,
    handleMaxWaitChange,
    handleNotifyOnSwitchChange
  } = useProviderSwitchSettings()

  useEffect(() => {
    if (project) {
      loadFeatureSettings(project)
      loadE2ESettings(project)
      loadNotificationSettings(project)
      loadSyncSettings(project)
      loadWorkerPipelineSettings(project)
      loadManualTestSettings(project)
      loadProviderSwitchSettings(project)
    }
    // Test mode is a global setting, load it regardless of project
    void loadTestModeSettings()
  }, [
    project,
    loadFeatureSettings,
    loadE2ESettings,
    loadNotificationSettings,
    loadSyncSettings,
    loadWorkerPipelineSettings,
    loadTestModeSettings,
    loadManualTestSettings,
    loadProviderSwitchSettings
  ])

  const handleReconfigureLabels = useCallback(async () => {
    if (!project) return
    try {
      await window.electron.ipcRenderer.invoke('resetLabelWizard', {
        projectId: project.id
      })
      toast.success('Label setup reopened')
      onClose()
    } catch (err) {
      toast.error('Failed to reopen label setup', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }, [project, onClose])

  const handleReopenGithubProjectPrompt = useCallback(async () => {
    if (!project) return
    try {
      await window.electron.ipcRenderer.invoke('resetGithubProjectPrompt', {
        projectId: project.id
      })
      toast.success('GitHub Project prompt reopened')
      onClose()
    } catch (err) {
      toast.error('Failed to reopen GitHub Project prompt', {
        description: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }, [project, onClose])

  // Debug: Log when component renders
  useEffect(() => {
    console.log(
      '[FeaturesSection] Rendering with testModeEnabled:',
      testModeEnabled,
      'loading:',
      testModeLoading
    )
  }, [testModeEnabled, testModeLoading])

  return (
    <div className="space-y-6">
      {/* Test Mode - Global setting, shown even without project */}
      <SettingsCard
        title="Test Modifications"
        description="Enable testing of worker modifications by starting development servers for cards with branches."
      >
        <SettingRow
          title="Enable Test Mode"
          description="When enabled, cards with branches will show a 'Test Modifications' button that allows you to start the development server and test changes."
        >
          {testModeLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              checked={testModeEnabled}
              onCheckedChange={(enabled) => handleTestModeChange(enabled)}
              disabled={testModeLoading}
            />
          )}
        </SettingRow>
      </SettingsCard>

      {/* AI Debug Logging - Global */}
      <SettingsCard
        title="AI Debug Logging"
        description="Persist full AI agent logs to disk for debugging. Defaults on in dev, off in packaged builds."
      >
        <SettingRow
          title="Save AI agent logs"
          description="When enabled, AI execution logs are written to the local app data folder under logs/ai."
        >
          {aiDebugLoggingLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              checked={aiDebugLoggingEnabled}
              onCheckedChange={(enabled) => handleAIDebugLoggingChange(enabled)}
            />
          )}
        </SettingRow>
      </SettingsCard>

      {!project ? (
        <div className="text-sm text-muted-foreground">
          Select a project to configure its features.
        </div>
      ) : (
        <>
          {/* Manual Testing Settings */}
          <SettingsCard
            title="Manual Testing"
            description="Configure how manual testing of worker modifications works after AI completes."
          >
            <div className="space-y-3">
              <SettingRow
                title="Auto-prompt after AI"
                description="Show a notification prompting you to test modifications after the AI phase completes."
              >
                <Switch
                  checked={autoPromptAfterAI}
                  onCheckedChange={(enabled) => handleAutoPromptChange(project, enabled)}
                />
              </SettingRow>

              <SettingRow
                title="Keep worktree for testing"
                description="Keep the worktree available after pipeline completion for manual testing (overrides default cleanup)."
              >
                <Switch
                  checked={keepWorktreeForManualTest}
                  onCheckedChange={(enabled) => handleKeepWorktreeChange(project, enabled)}
                />
              </SettingRow>

              <SettingRow
                title="Default test location"
                description="Where to test when worktree is not available."
              >
                <select
                  value={defaultTestLocation}
                  onChange={(e) =>
                    handleDefaultLocationChange(project, e.target.value as 'worktree' | 'mainRepo')
                  }
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="worktree">Worktree (isolated)</option>
                  <option value="mainRepo">Main Repo</option>
                </select>
              </SettingRow>
            </div>
          </SettingsCard>

          {/* AI Provider Switching */}
          <SettingsCard
            title="AI Provider Switching"
            description="Configure automatic switching between AI providers (Claude, Codex, OpenCode) when limits are reached."
          >
            <div className="space-y-3">
              <SettingRow
                title="Switch Mode"
                description="How to handle when a provider hits its limits mid-execution."
              >
                <select
                  value={providerSwitchMode}
                  onChange={(e) =>
                    handleProviderSwitchModeChange(project, e.target.value as ProviderSwitchMode)
                  }
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="automatic">Automatic (no approval)</option>
                  <option value="approval">Ask for approval</option>
                  <option value="disabled">Disabled</option>
                </select>
              </SettingRow>

              {providerSwitchMode !== 'disabled' && (
                <>
                  <SettingRow
                    title="When All Providers Exhausted"
                    description="What to do when all providers hit their limits."
                  >
                    <select
                      value={exhaustedBehavior}
                      onChange={(e) =>
                        handleExhaustedBehaviorChange(
                          project,
                          e.target.value as ExhaustedBehavior
                        )
                      }
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="pause_and_wait">Pause and wait for reset</option>
                      <option value="fail_immediately">Fail immediately</option>
                      <option value="queue_for_later">Queue for later</option>
                    </select>
                  </SettingRow>

                  {exhaustedBehavior === 'pause_and_wait' && (
                    <>
                      <SettingRow
                        title="Retry Interval"
                        description="How often to check if limits have reset (1-30 minutes)"
                      >
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={30}
                            value={retryIntervalMinutes}
                            onChange={(e) =>
                              handleRetryIntervalChange(project, Number(e.target.value))
                            }
                            className="w-20"
                          />
                          <span className="text-xs text-muted-foreground">min</span>
                        </div>
                      </SettingRow>

                      <SettingRow
                        title="Max Wait Time"
                        description="Maximum time to wait for limits to reset (5-240 minutes)"
                      >
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={5}
                            max={240}
                            value={maxWaitMinutes}
                            onChange={(e) =>
                              handleMaxWaitChange(project, Number(e.target.value))
                            }
                            className="w-20"
                          />
                          <span className="text-xs text-muted-foreground">min</span>
                        </div>
                      </SettingRow>
                    </>
                  )}

                  <SettingRow
                    title="Notify on Switch"
                    description="Show notification when provider is switched."
                  >
                    <Switch
                      checked={notifyOnSwitch}
                      onCheckedChange={(enabled) => handleNotifyOnSwitchChange(project, enabled)}
                    />
                  </SettingRow>
                </>
              )}
            </div>
          </SettingsCard>

          {/* Cancel Behavior */}
          <SettingsCard title="Cancel Behavior">
            <SettingRow
              title="Rollback changes on cancel"
              description="If you move a running card back to Draft (or forward to In Review/Testing/Done), the worker is canceled. Enable this to attempt to roll back the worker's local changes."
            >
              <Switch
                checked={rollbackOnCancel}
                onCheckedChange={(enabled) => handleRollbackOnCancelChange(project, enabled)}
              />
            </SettingRow>
          </SettingsCard>

          {/* Worker Base Branch */}
          <SettingsCard title="Worker Base Branch">
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                The worker will pull this branch before working on Ready items. Leave blank to
                auto-detect from the remote default.
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  placeholder="main or master"
                  className="max-w-[240px]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBaseBranchSave(project)}
                  disabled={savingBaseBranch}
                >
                  {savingBaseBranch ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </div>
          </SettingsCard>

          {/* Board Settings */}
          <SettingsCard title="Board Settings">
            <SettingRow
              title="Show Pull Requests section"
              description="When enabled, pull requests / merge requests are shown in a separate section (and removed from the Kanban columns)."
            >
              <Switch
                checked={showPullRequestsSection}
                onCheckedChange={(enabled) => handleShowPRsSectionChange(project, enabled)}
              />
            </SettingRow>
          </SettingsCard>

          {/* Repo Integration */}
          <SettingsCard title="Repo Integration">
            <div className="space-y-3">
              <SettingRow
                title="Issue label mapping"
                description="Configure (or re-run) the label mapping wizard for this repo."
              >
                <Button variant="outline" size="sm" onClick={handleReconfigureLabels}>
                  Configure
                </Button>
              </SettingRow>

              {project.remote_repo_key?.startsWith('github:') && (
                <SettingRow
                  title="GitHub Projects V2"
                  description="Reopen the prompt to create a GitHub Project for status syncing."
                >
                  <Button variant="outline" size="sm" onClick={handleReopenGithubProjectPrompt}>
                    Reopen
                  </Button>
                </SettingRow>
              )}
            </div>
          </SettingsCard>

          {/* E2E Testing */}
          <SettingsCard title="E2E Testing">
            <div className="space-y-3">
              <SettingRow
                title="Enable E2E Testing"
                description="Run end-to-end tests after the worker completes tasks to verify changes."
              >
                <Switch
                  checked={e2eEnabled}
                  onCheckedChange={(enabled) => handleE2eEnabledChange(project, enabled)}
                />
              </SettingRow>

              {e2eEnabled && (
                <>
                  <SettingRow
                    title="Create Tests If Missing"
                    description="Allow AI to create test files if none exist for the changed code."
                  >
                    <Switch
                      checked={e2eCreateTestsIfMissing}
                      onCheckedChange={(enabled) => handleE2eCreateTestsChange(project, enabled)}
                    />
                  </SettingRow>

                  <div className="rounded-lg border p-3">
                    <div className="font-medium text-sm mb-1">Application Type</div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Type of application to test. Auto-detect analyzes your project structure.
                    </div>
                    <select
                      value={e2eAppType}
                      onChange={(e) =>
                        handleE2eAppTypeChange(
                          project,
                          e.target.value as 'electron' | 'web' | 'static' | 'auto'
                        )
                      }
                      className="h-9 rounded-md border bg-background px-3 text-sm w-full max-w-[200px]"
                    >
                      <option value="auto">Auto-detect</option>
                      <option value="web">Web App (dev server)</option>
                      <option value="static">Static App (file://)</option>
                      <option value="electron">Electron App</option>
                    </select>
                  </div>

                  <div className="rounded-lg border p-3">
                    <div className="font-medium text-sm mb-1">Test Persistence</div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Whether AI-created tests are kept permanently or cleaned up after completion.
                    </div>
                    <select
                      value={e2eTestPersistence}
                      onChange={(e) =>
                        handleE2eTestPersistenceChange(
                          project,
                          e.target.value as 'persistent' | 'temporary'
                        )
                      }
                      className="h-9 rounded-md border bg-background px-3 text-sm w-full max-w-[200px]"
                    >
                      <option value="persistent">Persistent (commit with PR)</option>
                      <option value="temporary">Temporary (cleanup after)</option>
                    </select>
                  </div>

                  {(e2eAppType === 'web' || e2eAppType === 'auto') && (
                    <>
                      <div className="rounded-lg border p-3">
                        <div className="font-medium text-sm mb-1">Dev Server Command</div>
                        <div className="text-xs text-muted-foreground mb-2">
                          Command to start the dev server (leave empty for auto-detection from
                          package.json)
                        </div>
                        <Input
                          value={e2eDevServerCommand}
                          onChange={(e) => handleE2eDevServerCommandChange(e.target.value)}
                          onBlur={() => handleE2eDevServerCommandBlur(project)}
                          placeholder="npm run dev"
                        />
                      </div>

                      <div className="rounded-lg border p-3">
                        <div className="font-medium text-sm mb-1">Dev Server Port</div>
                        <div className="text-xs text-muted-foreground mb-2">
                          Port for the dev server (leave empty for auto-detection)
                        </div>
                        <Input
                          type="number"
                          min={1}
                          max={65535}
                          value={e2eDevServerPort ?? ''}
                          onChange={(e) => handleE2eDevServerPortChange(project, e.target.value)}
                          placeholder="3000"
                          className="max-w-[120px]"
                        />
                      </div>
                    </>
                  )}

                  <div className="rounded-lg border p-3">
                    <div className="font-medium text-sm mb-1">Base URL</div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Override the base URL for tests (auto-detected from dev server if empty)
                    </div>
                    <Input
                      value={e2eBaseUrl}
                      onChange={(e) => handleE2eBaseUrlChange(e.target.value)}
                      onBlur={() => handleE2eBaseUrlBlur(project)}
                      placeholder="http://localhost:3000"
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
                      onChange={(e) => handleE2eMaxRetriesChange(project, e.target.value)}
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
                      onChange={(e) => handleE2eTimeoutChange(project, e.target.value)}
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
                      onBlur={() => handleE2eTestCommandBlur(project)}
                      placeholder="npx playwright test"
                    />
                  </div>
                </>
              )}
            </div>
          </SettingsCard>

          {/* Audio Notifications */}
          <SettingsCard
            title="Audio Notifications"
            icon={
              audioEnabled ? (
                <Volume2 className="h-4 w-4 text-foreground/70" />
              ) : (
                <VolumeX className="h-4 w-4 text-foreground/70" />
              )
            }
          >
            <div className="space-y-3">
              <SettingRow
                title="Enable Audio"
                description="Play sounds for worker events like task completion and errors."
                noBorder
              >
                <Switch
                  checked={audioEnabled}
                  onCheckedChange={(enabled) => handleAudioEnabledChange(project, enabled)}
                />
              </SettingRow>

              {audioEnabled && (
                <>
                  <SettingRow
                    title="Sound on Complete"
                    description="Play a sound when a task completes successfully."
                  >
                    <Switch
                      checked={soundOnComplete}
                      onCheckedChange={(enabled) => handleSoundOnCompleteChange(project, enabled)}
                    />
                  </SettingRow>

                  <SettingRow title="Sound on Error" description="Play a sound when a task fails.">
                    <Switch
                      checked={soundOnError}
                      onCheckedChange={(enabled) => handleSoundOnErrorChange(project, enabled)}
                    />
                  </SettingRow>

                  <SettingRow
                    title="Sound on Approval Required"
                    description="Play a sound when a task needs your approval."
                  >
                    <Switch
                      checked={soundOnApproval}
                      onCheckedChange={(enabled) => handleSoundOnApprovalChange(project, enabled)}
                    />
                  </SettingRow>
                </>
              )}
            </div>
          </SettingsCard>

          {/* Sync Settings */}
          <SettingsCard
            title="Sync Settings"
            icon={<RefreshCw className="h-4 w-4 text-foreground/70" />}
          >
            <div className="space-y-3">
              <SettingRow
                title="Sync Interval"
                description="How often to poll for card updates from remote (in minutes)"
              >
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={syncPollInterval}
                  onChange={(e) => handleSyncPollIntervalChange(project, Number(e.target.value))}
                  className="w-20"
                />
              </SettingRow>

              <SettingRow
                title="Auto-sync on Actions"
                description="Automatically sync after card moves and worker completions"
              >
                <Switch
                  checked={autoSyncOnAction}
                  onCheckedChange={(enabled) => handleAutoSyncOnActionChange(project, enabled)}
                />
              </SettingRow>
            </div>
          </SettingsCard>

          {/* Worker Pipeline Settings */}
          <SettingsCard
            title="Worker Pipeline Settings"
            icon={<Settings2 className="h-4 w-4 text-foreground/70" />}
            description="Configure worker pipeline timeouts, retry behavior, and lease management."
          >
            <div className="space-y-3">
              <SettingRow
                title="Pipeline Timeout"
                description="Maximum time for a worker pipeline to complete (5-120 minutes)"
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={5}
                    max={120}
                    value={pipelineTimeout}
                    onChange={(e) => handlePipelineTimeoutChange(project, Number(e.target.value))}
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
              </SettingRow>

              <SettingRow
                title="Max Retries"
                description="Number of retry attempts for transient failures (0-10)"
              >
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={pipelineMaxRetries}
                  onChange={(e) => handlePipelineMaxRetriesChange(project, Number(e.target.value))}
                  className="w-20"
                />
              </SettingRow>

              <SettingRow
                title="Retry Delay"
                description="Initial delay between retry attempts (1-30 seconds)"
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={pipelineRetryDelay}
                    onChange={(e) =>
                      handlePipelineRetryDelayChange(project, Number(e.target.value))
                    }
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">sec</span>
                </div>
              </SettingRow>

              <SettingRow
                title="Lease Renewal Interval"
                description="How often to renew job leases to prevent timeouts (10-300 seconds)"
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={10}
                    max={300}
                    value={leaseRenewalInterval}
                    onChange={(e) =>
                      handleLeaseRenewalIntervalChange(project, Number(e.target.value))
                    }
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">sec</span>
                </div>
              </SettingRow>
            </div>
          </SettingsCard>
        </>
      )}
    </div>
  )
}
