/**
 * Worker Pipeline
 *
 * Orchestrates the worker execution flow from card pickup to PR creation.
 * Delegates specific responsibilities to manager classes for maintainability.
 */

import { AdapterRegistry } from '../adapters'
import type { IRepoAdapter } from '../adapters'
import {
  getProject,
  getCard,
  updateCardStatus,
  updateCardConflictStatus,
  createEvent,
  updateJobState,
  getJob,
  acquireJobLease,
  cryptoRandomId,
  getPlanApprovalByJob,
  deletePlanApprovalsByJob,
  deleteFollowUpInstructionsByJob
} from '../db'
import type { Project, Card, PolicyConfig, Subtask, PlanningMode } from '../../shared/types'
import { broadcastToRenderers } from '../ipc/broadcast'
import { writeCheckpoint, readCheckpoint } from '../services/flowpatch-runs'
import { logAction } from '@shared/utils'

// Phase implementations
import { runAI } from './phases/ai'
import { runInstall } from './phases/install'
import { runBranchSyncPhase, type BranchSyncResult } from './phases/branch-sync'
import { runE2EPhase as runE2EPhaseImpl, type E2EResult } from './phases/e2e'
import { runChecks } from './phases/checks'
import { createPR as createPRPhase, moveToInReview } from './phases/pr'
import type { WorkerResult } from './phases/types'

// Managers
import {
  LogManager,
  PlanManager,
  ApprovalManager,
  CardStatusManager,
  BranchManager,
  WorktreePipelineManager
} from './managers'
import { LifecycleManager } from './managers/lifecycle-manager'
import { DecompositionManager } from './managers/decomposition-manager'
import { IterativeAIManager } from './managers/iterative-ai-manager'

// Utilities
import { buildPipelineContext } from './pipeline-context'
import { commitAndPush } from './commit-manager'
import { ensureCleanWorkingTree, restoreAutostash, isWorkingTreeClean } from './git-operations'

// Errors
import { WorkerCanceledError, WorkerPendingApprovalError, PipelineTimeoutError } from './errors'

// Sync scheduler and locks
import { triggerProjectSync } from '../sync/scheduler'
import { acquireWorkerLock, releaseWorkerLock } from '../sync/sync-lock'

// Unified status store
import { setWorkerStatus } from './worker-status-store'

/**
 * Main worker pipeline class.
 * Orchestrates the execution flow by delegating to specialized managers.
 */
export class WorkerPipeline {
  private projectId: string
  private cardId: string
  private project: Project | null = null
  private card: Card | null = null
  private policy: PolicyConfig
  private adapter: IRepoAdapter | null = null
  private jobId: string | null = null
  private workerId: string = cryptoRandomId()

  // Managers
  private logManager: LogManager
  private lifecycleManager: LifecycleManager | null = null
  private cardStatusManager: CardStatusManager | null = null
  private branchManager: BranchManager | null = null
  private worktreeManager: WorktreePipelineManager | null = null
  private approvalManager: ApprovalManager | null = null
  private decompositionManager: DecompositionManager | null = null
  private iterativeAIManager: IterativeAIManager | null = null

  // State
  private useWorktree: boolean = false
  private subtasks: Subtask[] = []

  constructor(projectId: string, cardId: string) {
    this.projectId = projectId
    this.cardId = cardId
    this.policy = {
      version: 1,
      worker: {
        enabled: true,
        toolPreference: 'auto',
        planFirst: true,
        maxMinutes: 25,
        rollbackOnCancel: false,
        branchPattern: 'kanban/{id}-{slug}',
        commitMessage: '#{issue} {title}'
      }
    }

    // Initialize log manager early
    this.logManager = new LogManager(projectId, cardId)
  }

  // ==================== Helpers ====================

  /**
   * Get the working directory for operations.
   */
  private getWorkingDir(): string {
    return this.worktreeManager?.getWorktreePath() ?? this.project!.local_path
  }

  private log(message: string, meta?: { source?: string; stream?: 'stdout' | 'stderr' }): void {
    this.logManager.log(message, meta)
  }

  private setPhase(phase: string): void {
    this.logManager.setPhase(phase)
    this.persistRunCheckpoint()
    this.updateUnifiedStatus(phase)
  }

  /**
   * Update the unified worker status store based on the current phase.
   */
  private updateUnifiedStatus(phase: string): void {
    // Map pipeline phases to unified worker states
    let state: 'idle' | 'queued' | 'processing' | 'testing' | 'pushing' | 'paused' | 'failed' | 'succeeded'

    switch (phase) {
      case 'init':
      case 'working_tree':
      case 'fetch':
      case 'branch':
      case 'branch_sync':
      case 'decomposition':
      case 'plan':
      case 'install':
      case 'ai':
      case 'checks':
      case 'in_progress':
        state = 'processing'
        break
      case 'e2e':
        state = 'testing'
        break
      case 'push':
      case 'pr':
        state = 'pushing'
        break
      case 'pending_approval':
        state = 'paused'
        break
      case 'done':
      case 'in_review':
        state = 'succeeded'
        break
      case 'canceled':
      case 'timeout':
        state = 'failed'
        break
      default:
        state = 'processing'
    }

    setWorkerStatus(this.projectId, {
      state,
      activeCardId: this.cardId,
      activeCardTitle: this.card?.title,
      activeJobId: this.jobId ?? undefined,
      currentPhase: phase
    })
  }

  private persistRunCheckpoint(iteration?: number): void {
    if (!this.jobId || !this.project) return
    const repoRoot = this.project.local_path
    try {
      const progress = this.iterativeAIManager?.getProgress()
      writeCheckpoint(repoRoot, {
        jobId: this.jobId,
        cardId: this.cardId,
        projectId: this.projectId,
        phase: this.logManager.getPhase(),
        iteration,
        updatedAt: new Date().toISOString(),
        lastContextPath: progress?.progress_file_path ?? undefined
      })
    } catch {
      // ignore checkpoint failures
    }
  }

  // ==================== Initialization ====================

  async initialize(): Promise<boolean> {
    // Load project and card
    const [project, card] = await Promise.all([
      Promise.resolve(getProject(this.projectId)),
      Promise.resolve(getCard(this.cardId))
    ])

    this.project = project
    this.card = card

    if (!this.project) {
      this.log('Project not found')
      return false
    }

    if (!this.card) {
      this.log('Card not found')
      return false
    }

    // Resume from checkpoint if available
    if (this.jobId && this.project) {
      try {
        const cp = readCheckpoint(this.project.local_path, this.jobId)
        if (cp?.phase) {
          this.logManager.setPhase(cp.phase)
        }
      } catch {
        // ignore
      }
    }

    if (!this.project.remote_repo_key) {
      this.log('No remote configured')
      return false
    }

    // Load policy
    if (this.project.policy_json) {
      try {
        this.policy = JSON.parse(this.project.policy_json)
      } catch {
        this.log('Failed to parse policy, using defaults')
      }
    }

    // Initialize adapter
    try {
      this.adapter = AdapterRegistry.create({
        repoKey: this.project.remote_repo_key,
        providerHint: this.project.provider_hint,
        repoPath: this.project.local_path,
        policy: this.policy
      })
    } catch (error) {
      this.log(
        `Failed to create adapter: ${error instanceof Error ? error.message : String(error)}`
      )
      return false
    }

    // Initialize decomposition manager
    this.decompositionManager = new DecompositionManager(
      {
        projectId: this.projectId,
        cardId: this.cardId,
        policy: this.policy,
        adapter: this.adapter
      },
      (msg) => this.log(msg)
    )

    // Initialize worktree manager if enabled
    if (this.policy.worker?.worktree?.enabled) {
      this.worktreeManager = new WorktreePipelineManager(
        {
          projectId: this.projectId,
          cardId: this.cardId,
          jobId: this.jobId,
          workerId: this.workerId,
          repoPath: this.project.local_path,
          policy: this.policy,
          card: this.card
        },
        (msg) => this.log(msg)
      )

      this.useWorktree = this.worktreeManager.canUseWorktree()
      if (this.useWorktree) {
        this.log('Worktree mode enabled')
      }
    }

    // Initialize card status manager
    this.cardStatusManager = new CardStatusManager(
      {
        projectId: this.projectId,
        cardId: this.cardId,
        card: this.card,
        adapter: this.adapter
      },
      (msg) => this.log(msg),
      () => this.lifecycleManager?.isCanceled()
    )

    // Initialize branch manager
    this.branchManager = new BranchManager(
      {
        repoPath: this.project.local_path,
        policy: this.policy,
        card: this.card
      },
      (msg) => this.log(msg)
    )

    // Initialize approval manager
    this.approvalManager = new ApprovalManager(
      this.policy,
      {
        projectId: this.projectId,
        cardId: this.cardId,
        jobId: this.jobId!,
        logs: this.logManager.getLogs()
      },
      (msg) => this.log(msg),
      () => this.lifecycleManager?.isCanceled()
    )

    // Initialize iterative AI manager
    this.iterativeAIManager = new IterativeAIManager({
      projectId: this.projectId,
      cardId: this.cardId,
      jobId: this.jobId,
      policy: this.policy,
      card: this.card
    })

    return true
  }

  // ==================== Main Run ====================

  async run(jobId: string): Promise<WorkerResult> {
    this.jobId = jobId
    this.logManager.setJobId(jobId)
    this.setPhase('init')
    let outcome: 'succeeded' | 'failed' | 'canceled' | 'pending_approval' = 'failed'

    // Initialize lifecycle manager
    this.lifecycleManager = new LifecycleManager({
      projectId: this.projectId,
      cardId: this.cardId,
      jobId: this.jobId,
      leaseRenewalMs: this.policy.worker?.leaseRenewalIntervalMs,
      pipelineTimeoutMs: this.policy.worker?.pipelineTimeoutMs
    })

    // Acquire worker lock to prevent sync during worker operations
    this.log('Acquiring worker lock')
    await acquireWorkerLock(this.projectId)
    this.log('Worker lock acquired')

    // Start lifecycle management (lease renewal + timeout)
    const leaseIntervalMs = this.lifecycleManager.getLeaseRenewalMs()
    const timeoutMs = this.lifecycleManager.getPipelineTimeoutMs()
    this.log(`Starting lifecycle management (lease: ${leaseIntervalMs}ms, timeout: ${timeoutMs}ms)`)
    this.lifecycleManager.start()

    try {
      const initialized = await this.initialize()
      if (!initialized) {
        outcome = 'failed'
        return {
          success: false,
          phase: 'init',
          error: 'Failed to initialize',
          logs: this.logManager.getLogs()
        }
      }

      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['ready'], 'Canceled: card no longer Ready')

      // Phase 1: Move to In Progress
      this.setPhase('in_progress')
      this.log('Moving card to In Progress')
      await this.cardStatusManager!.moveToInProgress()

      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      // Phase 2: Setup working environment
      this.setPhase('working_tree')
      if (this.useWorktree && this.worktreeManager) {
        this.log('Setting up worktree')
        const worktreeSetup = await this.worktreeManager.setup()
        if (!worktreeSetup) {
          outcome = 'failed'
          return {
            success: false,
            phase: 'working_tree',
            error: 'Failed to setup worktree',
            logs: this.logManager.getLogs()
          }
        }
        this.worktreeManager.startLockRenewal()
      } else {
        this.log('Checking working tree')
        const cleanTree = await ensureCleanWorkingTree(this.project!.local_path, true)
        if (!cleanTree) {
          outcome = 'failed'
          return {
            success: false,
            phase: 'working_tree',
            error: 'Working tree is not clean',
            logs: this.logManager.getLogs()
          }
        }
      }

      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      // Phase 3: Fetch latest
      this.setPhase('fetch')
      this.log('Fetching latest from remote')
      await this.branchManager!.fetchLatest()

      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      // Phase 4: Create branch
      this.setPhase('branch')
      let branchName: string
      if (this.useWorktree && this.worktreeManager?.getWorkerBranch()) {
        branchName = this.worktreeManager.getWorkerBranch()!
        this.log(`Using worktree branch: ${branchName}`)
      } else {
        branchName = this.branchManager!.generateBranchName()
        this.log(`Preparing branch: ${branchName}`)
        await this.branchManager!.createBranch(branchName)
      }

      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      // Phase 4.2: Branch Sync
      this.setPhase('branch_sync')
      this.log('Checking if branch needs sync with main')
      const syncResult = await this.runBranchSync(branchName)

      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      if (!syncResult.success) {
        this.log(`Branch sync failed: ${syncResult.error}`)
        updateCardConflictStatus(this.cardId, true)
        createEvent(this.projectId, 'error', this.cardId, {
          phase: 'branch_sync',
          hasConflicts: true,
          unresolvedFiles: syncResult.unresolvedFiles,
          error: syncResult.error
        })
        broadcastToRenderers('card-updated', { cardId: this.cardId })
        outcome = 'failed'
        return {
          success: false,
          phase: 'branch_sync',
          error: syncResult.error || 'Failed to sync branch with main',
          logs: this.logManager.getLogs()
        }
      }

      if (syncResult.hadConflicts && syncResult.conflictsResolved) {
        updateCardConflictStatus(this.cardId, false)
        this.log('Conflicts resolved successfully')
      }

      // Phase 4.5: Task Decomposition
      if (this.decompositionManager?.shouldRunDecomposition() && this.card) {
        this.setPhase('decomposition')
        await this.decompositionManager.runDecomposition(this.card, this.getWorkingDir())
        this.subtasks = this.decompositionManager.getSubtasks()
      }

      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      // Phase 5: Generate plan
      this.setPhase('plan')
      const planningConfig = this.policy.features?.planning
      const planningMode: PlanningMode =
        planningConfig?.enabled !== false ? (planningConfig?.mode ?? 'lite') : 'skip'

      let plan: string
      if (planningMode === 'skip') {
        this.log('Planning skipped (mode: skip)')
        plan = new PlanManager(this.card!, this.policy).generatePlan('skip')
      } else {
        this.log(`Generating implementation plan (mode: ${planningMode})`)
        plan = new PlanManager(this.card!, this.policy).generatePlan(planningMode)
      }
      this.logManager.setLastPlan(plan)

      createEvent(this.projectId, 'worker_plan', this.cardId, { plan })

      // Phase 5.5: Check for plan approval
      await this.approvalManager!.checkPlanApproval(plan, planningMode)

      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      // Phase 5.75: Install dependencies
      this.setPhase('install')
      this.log('Installing dependencies')
      const installSuccess = await this.runInstallPhase()
      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])
      if (!installSuccess) {
        this.log('Install failed, moving card back to Ready for retry')
        await this.cardStatusManager!.moveToReady('install_failed')
        outcome = 'failed'
        return {
          success: false,
          phase: 'install',
          error: 'Install failed',
          plan,
          logs: this.logManager.getLogs()
        }
      }

      // Phase 6: Run AI tool
      this.setPhase('ai')
      const sessionMode = this.policy.worker?.session?.sessionMode ?? 'single'
      let aiSuccess: boolean

      if (sessionMode === 'iterative') {
        this.log('Running AI implementation (iterative mode)')
        aiSuccess = await this.runIterativeAI(plan)
      } else {
        this.log('Running AI implementation')
        aiSuccess = await this.runAIPhase(plan)
      }

      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])
      if (!aiSuccess) {
        outcome = 'failed'
        return {
          success: false,
          phase: 'ai',
          error: 'AI implementation failed',
          plan,
          logs: this.logManager.getLogs()
        }
      }

      const aiWorkingDir = this.getWorkingDir()
      if (await isWorkingTreeClean(aiWorkingDir)) {
        const aiLogs = this.logManager.getLogs().join('\n')
        const readOnlyPattern =
          /read[- ]only|environment is read[- ]only|couldn.?t apply the change.*read[- ]only/i
        const permissionPattern =
          /approval required|approval denied|outside the workspace|not in the workspace|permission denied|access denied/i

        if (readOnlyPattern.test(aiLogs) || permissionPattern.test(aiLogs)) {
          const reason = readOnlyPattern.test(aiLogs)
            ? 'read-only environment'
            : 'permission denied (outside workspace)'
          this.log(`AI tool reported ${reason}; moving card back to Ready`)
          await this.cardStatusManager!.moveToReady('ai_permission_denied')
          outcome = 'failed'
          return {
            success: false,
            phase: 'ai',
            error: `AI tool could not edit files (${reason})`,
            plan,
            logs: this.logManager.getLogs()
          }
        }
      }

      // Emit manual test prompt if enabled
      if (this.policy.worker?.manualTest?.autoPromptAfterAI) {
        this.log('AI phase complete - prompting for manual test')
        broadcastToRenderers('worker:manualTestPrompt', {
          projectId: this.projectId,
          cardId: this.cardId,
          jobId: this.jobId,
          cardTitle: this.card?.title,
          branchName:
            this.worktreeManager?.getWorkerBranch() || this.branchManager?.getWorkerBranch(),
          worktreePath: this.worktreeManager?.getWorktreePath()
        })
      }

      // Phase 7: Run checks
      this.setPhase('checks')
      this.log('Running verification checks')
      const checksPass = await this.runChecksPhase()
      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])
      if (!checksPass) {
        this.log('Checks failed, moving card back to Ready for retry')
        await this.cardStatusManager!.moveToReady('checks_failed')
        outcome = 'failed'
        return {
          success: false,
          phase: 'checks',
          error: 'Verification checks failed',
          plan,
          logs: this.logManager.getLogs()
        }
      }

      // Phase 7.5: Run E2E tests
      let e2ePass = true
      if (this.policy.worker?.e2e?.enabled) {
        this.setPhase('e2e')
        this.log('Running E2E tests')

        // Move card to testing status during E2E phase
        await this.cardStatusManager!.moveToTesting()

        const e2eResult = await this.runE2EPhase()
        this.lifecycleManager.ensureNotCanceled()
        this.cardStatusManager!.ensureCardStatusAllowed(['testing', 'in_progress'])
        e2ePass = e2eResult.success
        if (!e2ePass) {
          this.log(`E2E tests failed after ${e2eResult.fixAttempts} fix attempts`)
          await this.cardStatusManager!.moveToReady('e2e_failed')
          outcome = 'failed'
          return {
            success: false,
            phase: 'e2e',
            error: 'E2E tests failed',
            plan,
            logs: this.logManager.getLogs()
          }
        }

        // Move card back to In Progress after E2E completes successfully
        this.log('E2E tests passed, moving card back to In Progress')
        await this.cardStatusManager!.moveToInProgress()
        this.lifecycleManager.ensureNotCanceled()
        this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])
      }

      // Phase 8: Commit and push
      this.setPhase('push')
      this.log('Committing and pushing changes')
      await this.commitAndPushChanges(branchName)

      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      // Phase 9: Create PR/MR
      this.setPhase('pr')
      this.log('Creating PR/MR')
      const prResult = await this.createPR(branchName, plan, checksPass && e2ePass)
      this.lifecycleManager.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])
      if (!prResult) {
        await this.cardStatusManager!.moveToReady('pr_failed')
        outcome = 'failed'
        return {
          success: false,
          phase: 'pr',
          error: 'Failed to create PR/MR',
          plan,
          logs: this.logManager.getLogs()
        }
      }

      // Phase 10: Move to In Review
      this.setPhase('in_review')
      this.log('Moving card to In Review')
      const ctx = this.buildPipelineContext()
      await moveToInReview(ctx, prResult.url, !prResult.existing)

      this.setPhase('done')
      outcome = 'succeeded'
      return {
        success: true,
        phase: 'complete',
        prUrl: prResult.url,
        plan,
        logs: this.logManager.getLogs()
      }
    } catch (err) {
      if (err instanceof WorkerCanceledError) {
        this.setPhase('canceled')
        this.log('Worker run canceled')
        outcome = 'canceled'
        return {
          success: false,
          phase: 'canceled',
          error: 'Canceled',
          plan: this.logManager
            .getLogs()
            .find((l) => l.includes('Plan'))
            ?.slice(0, 1000),
          logs: this.logManager.getLogs()
        }
      }
      if (err instanceof WorkerPendingApprovalError) {
        this.setPhase('pending_approval')
        this.log('Waiting for plan approval')
        outcome = 'pending_approval'
        return {
          success: false,
          phase: 'pending_approval',
          error: 'Pending plan approval',
          logs: this.logManager.getLogs()
        }
      }
      if (err instanceof PipelineTimeoutError) {
        this.setPhase('timeout')
        this.log(`Pipeline timed out: ${err.message}`)
        outcome = 'failed'
        return {
          success: false,
          phase: 'timeout',
          error: err.message,
          logs: this.logManager.getLogs()
        }
      }
      throw err
    } finally {
      // Cleanup lifecycle manager
      if (this.lifecycleManager) {
        this.lifecycleManager.stop()
      }

      if (this.worktreeManager) {
        this.worktreeManager.stopLockRenewal()
      }

      this.logManager.cleanup()

      // Handle worktree or traditional cleanup
      if (this.useWorktree && this.worktreeManager) {
        await this.worktreeManager.cleanup(this.logManager.getPhase() === 'done')
      } else {
        if (this.lifecycleManager?.isCanceled() && this.policy.worker?.rollbackOnCancel) {
          await this.branchManager?.rollbackWorkerChanges()
        }
        await restoreAutostash(this.project!.local_path)
      }

      if (outcome === 'failed') {
        await this.recoverCardStatus()
      }

      // Update unified status based on final outcome
      if (outcome === 'succeeded') {
        setWorkerStatus(this.projectId, {
          state: 'succeeded',
          lastRunAt: new Date().toISOString(),
          activeCardId: undefined,
          activeCardTitle: undefined,
          activeJobId: undefined,
          currentPhase: undefined
        })
      } else if (outcome === 'failed' || outcome === 'canceled') {
        setWorkerStatus(this.projectId, {
          state: 'failed',
          lastRunAt: new Date().toISOString(),
          lastError: outcome === 'canceled' ? 'Canceled' : 'Worker failed',
          activeCardId: undefined,
          activeCardTitle: undefined,
          activeJobId: undefined,
          currentPhase: undefined
        })
      }
      // pending_approval keeps the paused state set by setPhase

      // Release worker lock to allow sync operations
      releaseWorkerLock(this.projectId)
      this.log('Worker lock released')
    }
  }

  // ==================== Phase Implementations ====================

  private async runBranchSync(branchName: string): Promise<BranchSyncResult> {
    const ctx = this.buildPipelineContext()
    return runBranchSyncPhase(
      ctx,
      branchName,
      (msg, meta) => this.log(msg, meta),
      () => this.lifecycleManager!.isCanceled()
    )
  }

  private async runAIPhase(plan: string): Promise<boolean> {
    // Check for follow-up instructions
    this.approvalManager?.checkFollowUpInstructions()

    const ctx = this.buildPipelineContext()
    const success = await runAI(
      ctx,
      plan,
      (msg, meta) => {
        this.log(msg, { ...meta, ai: true, source: meta?.source ?? 'ai' })
      },
      () => this.lifecycleManager!.isCanceled()
    )

    // Mark follow-up instructions as applied
    this.approvalManager?.markFollowUpInstructionsApplied()

    return success
  }

  private async runInstallPhase(): Promise<boolean> {
    const ctx = this.buildPipelineContext()
    return runInstall(
      ctx,
      (msg, meta) => this.log(msg, meta),
      () => this.lifecycleManager!.isCanceled()
    )
  }

  private async runChecksPhase(): Promise<boolean> {
    const ctx = this.buildPipelineContext()
    return runChecks(
      ctx,
      (msg, meta) => this.log(msg, meta),
      () => this.lifecycleManager!.isCanceled()
    )
  }

  private async runE2EPhase(): Promise<E2EResult> {
    const ctx = this.buildPipelineContext()
    return runE2EPhaseImpl(
      ctx,
      (msg, meta) => this.log(msg, meta),
      () => this.lifecycleManager!.isCanceled()
    )
  }

  private async commitAndPushChanges(branchName: string): Promise<void> {
    const ctx = this.buildPipelineContext()
    if (this.useWorktree) {
      const expectedPath = this.worktreeManager?.getWorktreePath()
      if (!expectedPath) {
        this.log('ERROR: Worktree mode active but worktreePath is null')
        throw new Error('Worktree path not available for commit/push')
      }
      if (ctx.worktreePath !== expectedPath) {
        this.log(
          `WARNING: Context worktreePath (${ctx.worktreePath}) differs from manager (${expectedPath})`
        )
      }
    }

    await commitAndPush(
      ctx,
      branchName,
      this.useWorktree ? null : this.branchManager,
      !this.useWorktree,
      (msg) => this.log(msg)
    )
  }

  private async createPR(
    branchName: string,
    plan: string,
    checksPass: boolean
  ): Promise<{ number: number; url: string; existing?: boolean } | null> {
    const ctx = this.buildPipelineContext()
    const baseBranch =
      this.branchManager?.getBaseBranch() ?? (await this.branchManager?.fetchBaseBranch()) ?? 'main'
    
    return createPRPhase(ctx, branchName, plan, checksPass, baseBranch)
  }

  private async runIterativeAI(plan: string): Promise<boolean> {
    if (!this.iterativeAIManager) return false

    return this.iterativeAIManager.runIterativeAI(
      plan,
      () => this.buildPipelineContext(),
      (prompt) => this.runAIPhase(prompt),
      this.decompositionManager?.getTaskDecomposer() ?? null,
      this.approvalManager,
      this.subtasks,
      this.branchManager?.getBaseHeadSha() ?? null,
      (msg) => this.log(msg),
      () => this.lifecycleManager!.ensureNotCanceled(),
      (iteration) => this.persistRunCheckpoint(iteration)
    )
  }

  // ==================== Recovery ====================

  /**
   * Recover card status after a failed worker run.
   * Uses retry logic with exponential backoff, then falls back to local-only update.
   */
  private async recoverCardStatus(): Promise<void> {
    let recovered = false

    // Try up to 3 times with exponential backoff
    for (let attempt = 1; attempt <= 3 && !recovered; attempt++) {
      try {
        const current = getCard(this.cardId)
        if (current?.status === 'in_progress' || current?.status === 'testing') {
          this.log(`Worker failed; moving card back to Ready (attempt ${attempt}/3)`)
          await this.cardStatusManager?.moveToReady('worker_failed')
          recovered = true
        } else {
          // Card is already in a safe state (e.g., user moved it)
          recovered = true
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        this.log(`Recovery attempt ${attempt}/3 failed: ${errorMsg}`)
        if (attempt < 3) {
          // Exponential backoff: 1s, 2s
          await new Promise((r) => setTimeout(r, 1000 * attempt))
        }
      }
    }

    // Final fallback: update local DB directly (skip remote sync)
    if (!recovered) {
      try {
        updateCardStatus(this.cardId, 'ready', this.projectId)
        broadcastToRenderers('card-updated', { cardId: this.cardId })
        this.log('Fallback: Updated local card status to ready (skipped remote sync)')
      } catch (dbError) {
        const errorMsg = dbError instanceof Error ? dbError.message : String(dbError)
        this.log(`CRITICAL: Card ${this.cardId} may be stuck in processing state: ${errorMsg}`)
      }
    }
  }

  // ==================== Context Builder ====================

  private buildPipelineContext() {
    return buildPipelineContext({
      projectId: this.projectId,
      cardId: this.cardId,
      jobId: this.jobId,
      workerId: this.workerId,
      project: this.project,
      card: this.card,
      policy: this.policy,
      adapter: this.adapter,
      branchManager: this.branchManager,
      worktreeManager: this.worktreeManager,
      taskDecomposer: this.decompositionManager?.getTaskDecomposer() ?? null,
      subtasks: this.subtasks,
      progress: this.iterativeAIManager?.getProgress() ?? null,
      phase: this.logManager.getPhase(),
      logs: this.logManager.getLogs(),
      useWorktree: this.useWorktree
    })
  }
}

// ==================== Public API ====================

export async function runWorker(jobId: string): Promise<WorkerResult> {
  logAction('workerPipeline:runWorker:start', { jobId })
  // First getJob call without projectId - searches all DBs
  const job = getJob(jobId)
  if (!job) {
    logAction('workerPipeline:runWorker:jobNotFound', { jobId })
    return { success: false, phase: 'init', error: 'Job not found' }
  }

  const projectId = job.project_id

  if (!job.card_id) {
    logAction('workerPipeline:runWorker:noCard', { jobId, projectId })
    updateJobState(
      jobId,
      'failed',
      { success: false, phase: 'init', error: 'No card specified' },
      'No card specified',
      projectId
    )
    return { success: false, phase: 'init', error: 'No card specified' }
  }

  if (!acquireJobLease(jobId, 300, projectId)) {
    logAction('workerPipeline:runWorker:leaseFailed', { jobId, projectId })
    updateJobState(
      jobId,
      'failed',
      { success: false, phase: 'init', error: 'Failed to acquire job lease' },
      'Failed to acquire job lease',
      projectId
    )
    return { success: false, phase: 'init', error: 'Failed to acquire job lease' }
  }
  broadcastToRenderers('stateUpdated')

  const pipeline = new WorkerPipeline(projectId, job.card_id)
  let result: WorkerResult
  try {
    result = await pipeline.run(jobId)
  } catch (error) {
    const finalState = getJob(jobId, projectId)?.state
    const message = error instanceof Error ? error.message : String(error)
    const canceled = error instanceof WorkerCanceledError || finalState === 'canceled'

    result = {
      success: false,
      phase: canceled ? 'canceled' : 'error',
      error: message
    }

    updateJobState(jobId, canceled ? 'canceled' : 'failed', result, message, projectId)
    broadcastToRenderers('stateUpdated')
    logAction('workerPipeline:runWorker:result', {
      jobId,
      projectId,
      success: result.success,
      phase: result.phase,
      error: result.error
    })
    return result
  }

  // Update job state
  const finalState = getJob(jobId, projectId)?.state
  if (result.phase === 'canceled' || finalState === 'canceled') {
    updateJobState(jobId, 'canceled', result, result.error, projectId)
    deletePlanApprovalsByJob(jobId)
    deleteFollowUpInstructionsByJob(jobId)
  } else if (result.phase === 'pending_approval' || finalState === 'pending_approval') {
    // Job is waiting for plan approval - don't update state
  } else if (result.success) {
    updateJobState(jobId, 'succeeded', result, undefined, projectId)
    deletePlanApprovalsByJob(jobId)
    deleteFollowUpInstructionsByJob(jobId)
  } else {
    updateJobState(jobId, 'failed', result, result.error, projectId)
    deletePlanApprovalsByJob(jobId)
    deleteFollowUpInstructionsByJob(jobId)
  }
  broadcastToRenderers('stateUpdated')
  logAction('workerPipeline:runWorker:result', {
    jobId,
    projectId,
    success: result.success,
    phase: result.phase,
    error: result.error
  })

  // Trigger sync after job completion (success or failure)
  // This will be debounced by the scheduler
  const completedJob = getJob(jobId, projectId)
  if (completedJob?.project_id) {
    triggerProjectSync(completedJob.project_id)
  }

  return result
}

/**
 * Resume a worker job after plan approval.
 */
export async function resumeWorkerAfterApproval(jobId: string): Promise<WorkerResult> {
  // First getJob call without projectId - searches all DBs
  const job = getJob(jobId)
  if (!job) {
    return { success: false, phase: 'init', error: 'Job not found' }
  }

  const projectId = job.project_id

  if (job.state !== 'pending_approval') {
    return { success: false, phase: 'init', error: 'Job is not pending approval' }
  }

  const approval = getPlanApprovalByJob(jobId)
  if (!approval) {
    return { success: false, phase: 'init', error: 'No plan approval found' }
  }

  if (approval.status === 'pending') {
    return { success: false, phase: 'pending_approval', error: 'Plan still pending approval' }
  }

  if (approval.status === 'rejected') {
    updateJobState(
      jobId,
      'canceled',
      { success: false, phase: 'canceled', error: 'Plan rejected' },
      'Plan rejected by reviewer',
      projectId
    )
    deletePlanApprovalsByJob(jobId)
    deleteFollowUpInstructionsByJob(jobId)
    broadcastToRenderers('stateUpdated')
    return { success: false, phase: 'canceled', error: 'Plan rejected by reviewer' }
  }

  // Plan is approved or skipped - resume
  updateJobState(
    jobId,
    'running',
    { success: false, phase: 'ai', plan: approval.plan },
    undefined,
    projectId
  )
  broadcastToRenderers('stateUpdated')

  return runWorker(jobId)
}

// Re-export errors for backward compatibility
export { WorkerCanceledError, WorkerPendingApprovalError } from './errors'
