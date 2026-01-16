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
    loadE2ESettings,
    handleE2eEnabledChange,
    handleE2eMaxRetriesChange,
    handleE2eTimeoutChange,
    handleE2eCreateTestsChange,
    handleE2eTestCommandChange,
    handleE2eTestCommandBlur
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

  useEffect(() => {
    if (project) {
      loadFeatureSettings(project)
      loadE2ESettings(project)
      loadNotificationSettings(project)
      loadSyncSettings(project)
      loadWorkerPipelineSettings(project)
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
    loadTestModeSettings
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
    console.log('[FeaturesSection] Rendering with testModeEnabled:', testModeEnabled, 'loading:', testModeLoading)
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

      {!project ? (
        <div className="text-sm text-muted-foreground">
          Select a project to configure its features.
        </div>
      ) : (
        <>
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
                  placeholder="npm test"
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
                onChange={(e) => handlePipelineRetryDelayChange(project, Number(e.target.value))}
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
                onChange={(e) => handleLeaseRenewalIntervalChange(project, Number(e.target.value))}
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
