/**
 * Worker Pipeline
 *
 * Orchestrates the worker execution flow from card pickup to PR creation.
 * Delegates specific responsibilities to manager classes for maintainability.
 *
 * Improvements:
 * - Configurable lease renewal interval via policy (default: 60s)
 * - Overall pipeline timeout to prevent infinite runs (default: 30min)
 * - Retry logic for transient failures in phases
 * - Optimized cancellation checks (reduced redundant calls)
 * - Metrics collection for key operations
 */

import { AdapterRegistry } from '../adapters'
import type { IRepoAdapter } from '../adapters'
import {
  getProject,
  getCard,
  updateCardConflictStatus,
  createEvent,
  listCardLinks,
  updateJobState,
  getJob,
  cancelJob,
  acquireJobLease,
  renewJobLease,
  cryptoRandomId,
  updateSubtaskStatus,
  getNextPendingSubtask,
  createWorkerProgress,
  updateWorkerProgress,
  getWorkerProgress,
  getPlanApprovalByJob,
  deletePlanApprovalsByJob,
  deleteFollowUpInstructionsByJob
} from '../db'
import { TaskDecomposer } from '../services/task-decomposer'
import type {
  JobState,
  Project,
  Card,
  PolicyConfig,
  Subtask,
  WorkerProgress,
  PlanningMode
} from '../../shared/types'
import { broadcastToRenderers } from '../ipc/broadcast'
import { writeCheckpoint, readCheckpoint } from '../services/patchwork-runs'

// Phase implementations
import { runAI, buildAIPrompt } from './phases/ai'
import { runBranchSyncPhase, type BranchSyncResult } from './phases/branch-sync'
import { runE2EPhase as runE2EPhaseImpl, type E2EResult } from './phases/e2e'
import { runChecks } from './phases/checks'
import type { PipelineContext, WorkerResult } from './phases/types'

// Managers
import {
  LogManager,
  PlanManager,
  ApprovalManager,
  CardStatusManager,
  BranchManager,
  WorktreePipelineManager
} from './managers'

// Errors
import { WorkerCanceledError, WorkerPendingApprovalError, PipelineTimeoutError } from './errors'

// Sync scheduler and locks
import { triggerProjectSync } from '../sync/scheduler'
import { acquireWorkerLock, releaseWorkerLock } from '../sync/sync-lock'

// Git operations
import {
  stageAll,
  commit,
  push,
  stashPush,
  stashList,
  stashApplyDrop,
  isWorkingTreeClean,
  getWorkingTreeStatus,
  getModifiedFiles,
  getDiffStat
} from './git-operations'

// Constants for configurable values
const DEFAULT_LEASE_RENEWAL_MS = 60_000
const DEFAULT_PIPELINE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

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
  private leaseInterval: NodeJS.Timeout | null = null
  private pipelineTimeout: NodeJS.Timeout | null = null
  private pipelineStartTime: number = 0
  private workerId: string = cryptoRandomId()
  private lastCancelCheck: number = 0
  private cancelCheckThrottleMs: number = 500 // Minimum ms between cancel checks

  // Managers
  private logManager: LogManager
  private cardStatusManager: CardStatusManager | null = null
  private branchManager: BranchManager | null = null
  private worktreeManager: WorktreePipelineManager | null = null
  private approvalManager: ApprovalManager | null = null

  // Worktree state
  private useWorktree: boolean = false

  // Decomposition and iterative AI state
  private subtasks: Subtask[] = []
  private progress: WorkerProgress | null = null
  private taskDecomposer: TaskDecomposer | null = null

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

  // ==================== Configuration Helpers ====================

  /**
   * Get lease renewal interval from policy or default.
   */
  private getLeaseRenewalMs(): number {
    return this.policy.worker?.leaseRenewalIntervalMs ?? DEFAULT_LEASE_RENEWAL_MS
  }

  /**
   * Get pipeline timeout from policy or default.
   */
  private getPipelineTimeoutMs(): number {
    return this.policy.worker?.pipelineTimeoutMs ?? DEFAULT_PIPELINE_TIMEOUT_MS
  }

  // ==================== Helpers ====================

  /**
   * Get the working directory for operations.
   */
  private getWorkingDir(): string {
    return this.worktreeManager?.getWorktreePath() ?? this.project!.local_path
  }

  private getJobState(): JobState | null {
    if (!this.jobId) return null
    const job = getJob(this.jobId)
    return job?.state ?? null
  }

  private isCanceled(): boolean {
    return this.getJobState() === 'canceled'
  }

  private cancelJobInternal(reason?: string): void {
    if (!this.jobId) return
    if (this.isCanceled()) return
    cancelJob(this.jobId, reason ?? 'Canceled')
  }

  /**
   * Check if canceled, with throttling to reduce DB queries.
   * Only checks every cancelCheckThrottleMs milliseconds.
   */
  private ensureNotCanceled(): void {
    const now = Date.now()
    if (now - this.lastCancelCheck < this.cancelCheckThrottleMs) {
      return // Skip check, too soon since last check
    }
    this.lastCancelCheck = now

    if (this.isCanceled()) throw new WorkerCanceledError()

    // Also check for pipeline timeout
    if (this.pipelineStartTime > 0) {
      const elapsed = now - this.pipelineStartTime
      const timeout = this.getPipelineTimeoutMs()
      if (elapsed > timeout) {
        throw new PipelineTimeoutError(timeout)
      }
    }
  }

  private log(message: string, meta?: { source?: string; stream?: 'stdout' | 'stderr' }): void {
    this.logManager.log(message, meta)
  }

  private setPhase(phase: string): void {
    this.logManager.setPhase(phase)
    this.persistRunCheckpoint()
  }

  private persistRunCheckpoint(iteration?: number): void {
    if (!this.jobId || !this.project) return
    const repoRoot = this.project.local_path
    try {
      writeCheckpoint(repoRoot, {
        jobId: this.jobId,
        cardId: this.cardId,
        projectId: this.projectId,
        phase: this.logManager.getPhase(),
        iteration,
        updatedAt: new Date().toISOString(),
        lastContextPath: this.progress?.progress_file_path ?? undefined
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
      this.log(`Failed to create adapter: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }

    // Initialize task decomposer if enabled
    if (this.policy.worker?.decomposition?.enabled && this.adapter) {
      this.taskDecomposer = new TaskDecomposer(this.policy, this.adapter)
    }

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
      (reason) => this.cancelJobInternal(reason)
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
      (reason) => this.cancelJobInternal(reason)
    )

    return true
  }

  // ==================== Main Run ====================

  async run(jobId: string): Promise<WorkerResult> {
    this.jobId = jobId
    this.logManager.setJobId(jobId)
    this.setPhase('init')
    this.pipelineStartTime = Date.now()
    let outcome: 'succeeded' | 'failed' | 'canceled' | 'pending_approval' = 'failed'

    // Acquire worker lock to prevent sync during worker operations
    this.log('Acquiring worker lock')
    await acquireWorkerLock(this.projectId)
    this.log('Worker lock acquired')

    // Start lease renewal with configurable interval
    const leaseIntervalMs = this.getLeaseRenewalMs()
    this.log(`Starting lease renewal (interval: ${leaseIntervalMs}ms)`)
    this.leaseInterval = setInterval(() => {
      renewJobLease(jobId)
    }, leaseIntervalMs)

    // Set up pipeline timeout
    const timeoutMs = this.getPipelineTimeoutMs()
    this.pipelineTimeout = setTimeout(() => {
      this.log(`Pipeline timeout reached (${timeoutMs}ms), canceling...`)
      this.cancelJobInternal(`Pipeline timed out after ${timeoutMs}ms`)
    }, timeoutMs)

    try {
      const initialized = await this.initialize()
      if (!initialized) {
        outcome = 'failed'
        return { success: false, phase: 'init', error: 'Failed to initialize', logs: this.logManager.getLogs() }
      }

      this.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['ready'], 'Canceled: card no longer Ready')

      // Phase 1: Move to In Progress
      this.setPhase('in_progress')
      this.log('Moving card to In Progress')
      await this.cardStatusManager!.moveToInProgress()

      this.ensureNotCanceled()
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
        const cleanTree = await this.checkWorkingTree()
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

      this.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      // Phase 3: Fetch latest
      this.setPhase('fetch')
      this.log('Fetching latest from remote')
      await this.branchManager!.fetchLatest()

      this.ensureNotCanceled()
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

      this.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      // Phase 4.2: Branch Sync
      this.setPhase('branch_sync')
      this.log('Checking if branch needs sync with main')
      const syncResult = await this.runBranchSync(branchName)

      this.ensureNotCanceled()
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
      if (this.taskDecomposer && this.card) {
        this.setPhase('decomposition')
        await this.runDecomposition()
      }

      this.ensureNotCanceled()
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

      this.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

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

      this.ensureNotCanceled()
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

      // Phase 7: Run checks
      this.setPhase('checks')
      this.log('Running verification checks')
      const checksPass = await this.runChecksPhase()
      this.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])
      if (!checksPass) {
        this.log('Checks failed, creating WIP PR')
      }

      // Phase 7.5: Run E2E tests
      let e2ePass = true
      if (this.policy.worker?.e2e?.enabled) {
        this.setPhase('e2e')
        this.log('Running E2E tests')

        // Move card to testing status during E2E phase
        await this.cardStatusManager!.moveToTesting()

        const e2eResult = await this.runE2EPhase()
        this.ensureNotCanceled()
        this.cardStatusManager!.ensureCardStatusAllowed(['testing', 'in_progress'])
        e2ePass = e2eResult.success
        if (!e2ePass) {
          this.log(`E2E tests failed after ${e2eResult.fixAttempts} fix attempts`)
        }
      }

      // Phase 8: Commit and push
      this.setPhase('push')
      this.log('Committing and pushing changes')
      await this.commitAndPush(branchName)

      this.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])

      // Phase 9: Create PR/MR
      this.setPhase('pr')
      this.log('Creating PR/MR')
      const prResult = await this.createPR(branchName, plan, checksPass && e2ePass)
      this.ensureNotCanceled()
      this.cardStatusManager!.ensureCardStatusAllowed(['in_progress'])
      if (!prResult) {
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
      await this.cardStatusManager!.moveToInReview(prResult.url, !prResult.existing)

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
          plan: this.logManager.getLogs().find(l => l.includes('Plan'))?.slice(0, 1000),
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
      // Cleanup timers
      if (this.leaseInterval) {
        clearInterval(this.leaseInterval)
        this.leaseInterval = null
      }
      if (this.pipelineTimeout) {
        clearTimeout(this.pipelineTimeout)
        this.pipelineTimeout = null
      }

      if (this.worktreeManager) {
        this.worktreeManager.stopLockRenewal()
      }

      this.logManager.cleanup()

      // Handle worktree or traditional cleanup
      if (this.useWorktree && this.worktreeManager) {
        await this.worktreeManager.cleanup(this.logManager.getPhase() === 'done')
      } else {
        if (this.isCanceled() && this.policy.worker?.rollbackOnCancel) {
          await this.branchManager?.rollbackWorkerChanges()
        }
        await this.restoreStash()
      }

      if (outcome === 'failed') {
        try {
          const current = getCard(this.cardId)
          if (current?.status === 'in_progress') {
            this.log('Worker failed; moving card back to Ready so it can be retried.')
            await this.cardStatusManager?.moveToReady('worker_failed')
          }
        } catch (error) {
          this.log(
            `Failed to move card back to Ready after error: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      // Release worker lock to allow sync operations
      releaseWorkerLock(this.projectId)
      this.log('Worker lock released')
    }
  }

  // ==================== Phase Implementations ====================

  private async checkWorkingTree(): Promise<boolean> {
    try {
      if (await isWorkingTreeClean(this.project!.local_path)) {
        return true
      }

      this.log('Working tree has uncommitted changes, attempting to stash...')
      try {
        await stashPush(this.project!.local_path, 'patchwork-worker-autostash')
        this.log('Changes stashed successfully')
        return true
      } catch (stashError) {
        this.log(`Failed to stash changes: ${stashError}`)
        const status = await getWorkingTreeStatus(this.project!.local_path)
        this.log(`Dirty files:\n${status}`)
        return false
      }
    } catch {
      return false
    }
  }

  private async restoreStash(): Promise<void> {
    try {
      const stashOutput = await stashList(this.project!.local_path)
      const line = stashOutput.split(/\r?\n|\n|\r/).find((l) => l.includes('patchwork-worker-autostash'))
      if (!line) return

      const m = line.match(/^(stash@\{\d+\}):/)
      const ref = m?.[1] ?? null
      if (!ref) return

      this.log(`Restoring stashed changes from ${ref}...`)
      try {
        await stashApplyDrop(this.project!.local_path, ref)
        this.log('Stashed changes restored')
      } catch (error) {
        this.log(
          `Warning: Failed to restore autostash (${ref}). Error: ${error}`
        )
      }
    } catch (error) {
      this.log(`Warning: Failed to restore stash: ${error}`)
    }
  }

  private async runBranchSync(branchName: string): Promise<BranchSyncResult> {
    const ctx = this.buildPipelineContext()
    return runBranchSyncPhase(
      ctx,
      branchName,
      (msg, meta) => this.log(msg, meta),
      () => this.isCanceled()
    )
  }

  private async runDecomposition(): Promise<void> {
    if (!this.taskDecomposer || !this.card) return

    if (this.taskDecomposer.hasExistingSubtasks(this.cardId)) {
      this.subtasks = this.taskDecomposer.getExistingSubtasks(this.cardId)
      this.log(`Found ${this.subtasks.length} existing subtasks`)
      return
    }

    this.log('Analyzing task for decomposition...')

    try {
      const workingDir = this.getWorkingDir()
      const analysis = await this.taskDecomposer.analyzeCard(this.card, workingDir)

      if (!analysis.shouldDecompose) {
        this.log('Task does not need decomposition')
        return
      }

      this.log(`Decomposing into ${analysis.subtasks.length} subtasks`)
      if (analysis.reasoning) {
        this.log(`Reasoning: ${analysis.reasoning}`)
      }

      const result = await this.taskDecomposer.createSubtasks(this.card, analysis.subtasks)
      this.subtasks = result.subtasks

      createEvent(this.projectId, 'task_decomposed', this.cardId, {
        subtaskCount: this.subtasks.length,
        remoteIssuesCreated: result.remoteIssuesCreated,
        reasoning: analysis.reasoning
      })

      this.log(
        `Created ${this.subtasks.length} subtasks (${result.remoteIssuesCreated} remote issues)`
      )
    } catch (error) {
      this.log(`Decomposition failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async runAIPhase(plan: string): Promise<boolean> {
    // Check for follow-up instructions
    this.approvalManager?.checkFollowUpInstructions()

    const ctx = this.buildPipelineContext()
    const success = await runAI(
      ctx,
      plan,
      (msg, meta) => this.log(msg, meta),
      () => this.isCanceled()
    )

    // Mark follow-up instructions as applied
    this.approvalManager?.markFollowUpInstructionsApplied()

    return success
  }

  private async runChecksPhase(): Promise<boolean> {
    const ctx = this.buildPipelineContext()
    return runChecks(
      ctx,
      (msg, meta) => this.log(msg, meta),
      () => this.isCanceled()
    )
  }

  private async runE2EPhase(): Promise<E2EResult> {
    const ctx = this.buildPipelineContext()
    return runE2EPhaseImpl(
      ctx,
      (msg, meta) => this.log(msg, meta),
      () => this.isCanceled()
    )
  }

  private async commitAndPush(branchName: string): Promise<void> {
    const commitMsg =
      this.policy.worker?.commitMessage
        ?.replace('{issue}', this.card?.remote_number_or_iid || '')
        .replace('{title}', this.card?.title || '') ||
      `#${this.card?.remote_number_or_iid} ${this.card?.title}`

    const workingDir = this.getWorkingDir()

    try {
      await stageAll(workingDir)

      if (!(await isWorkingTreeClean(workingDir))) {
        await commit(workingDir, commitMsg)
      }

      // Update from origin before push
      try {
        await this.branchManager?.updateBranchFromOrigin(branchName)
      } catch {
        // Let push surface the issue
      }

      await push(workingDir, branchName)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('could not read Username') || message.includes('Authentication failed')) {
        this.log('Git push failed: missing credentials.')
      }
      this.log(`Commit/push warning: ${message}`)
      throw error
    }
  }

  private async createPR(
    branchName: string,
    plan: string,
    checksPass: boolean
  ): Promise<{ number: number; url: string; existing?: boolean } | null> {
    if (!this.adapter || !this.card) return null

    const linkedType = this.adapter.providerKey === 'github' ? 'pr' : 'mr'
    const existingLink = listCardLinks(this.cardId).find((link) => link.linked_type === linkedType)
    if (existingLink?.linked_url) {
      const url = existingLink.linked_url
      const numberMatch =
        linkedType === 'pr' ? url.match(/\/pull\/(\d+)/) : url.match(/\/merge_requests\/(\d+)/)
      const number = numberMatch ? parseInt(numberMatch[1], 10) : 0
      return { number, url, existing: true }
    }

    const title = checksPass ? this.card.title : `[WIP] ${this.card.title}`

    const body = `
## Summary
${this.card.body || 'Automated implementation'}

## Plan
${plan}

## Testing
${checksPass ? 'All checks passed' : 'Some checks failed - needs review'}

---
Closes #${this.card.remote_number_or_iid}

_Automated by Patchwork_
`.trim()

    const baseBranch = this.branchManager?.getBaseBranch() ?? await this.branchManager?.fetchBaseBranch() ?? 'main'
    const statusLabel = this.adapter.getStatusLabel('in_review')

    const result = await this.adapter.createPullRequest(title, body, branchName, baseBranch, [statusLabel])
    return result ? { ...result, existing: false } : null
  }

  // ==================== Iterative AI ====================

  private async runIterativeAI(plan: string): Promise<boolean> {
    if (!this.project || !this.card) return false

    const sessionConfig = this.policy.worker?.session
    const maxIterations = sessionConfig?.maxIterations ?? 5
    const progressCheckpoint = sessionConfig?.progressCheckpoint ?? true
    const contextCarryover = sessionConfig?.contextCarryover ?? 'summary'

    // Initialize or resume progress tracking
    let existingProgress = getWorkerProgress(this.cardId)
    if (!existingProgress) {
      existingProgress = createWorkerProgress({
        cardId: this.cardId,
        jobId: this.jobId ?? undefined,
        totalIterations: maxIterations
      })
    }
    this.progress = existingProgress

    const startIteration = this.progress.iteration
    this.log(`Starting iterative AI from iteration ${startIteration}/${maxIterations}`)

    let contextSummary = this.progress.context_summary ?? ''
    let allSuccess = true

    for (let i = startIteration; i <= maxIterations; i++) {
      this.ensureNotCanceled()

      const iterationPrompt = await this.buildIterationPrompt(plan, i, maxIterations, contextSummary)

      this.log(`Running iteration ${i}/${maxIterations}`)

      try {
        const success = await this.runAIPhase(iterationPrompt)

        if (!success) {
          this.log(`Iteration ${i} failed`)
          allSuccess = false
        }

        if (progressCheckpoint) {
          await this.checkpointProgress(i, contextCarryover)
        }

        if (await this.isIterationComplete()) {
          this.log(`Task completed after iteration ${i}`)
          break
        }

        if (contextCarryover !== 'none') {
          contextSummary = await this.generateContextSummary(contextCarryover)
        }

        if (this.progress) {
          updateWorkerProgress(this.progress.id, {
            iteration: i + 1,
            contextSummary
          })
          this.persistRunCheckpoint(i)
        }
      } catch (error) {
        if (error instanceof WorkerCanceledError) {
          throw error
        }
        this.log(`Iteration ${i} error: ${error instanceof Error ? error.message : String(error)}`)
        allSuccess = false
        break
      }
    }

    return allSuccess
  }

  private async buildIterationPrompt(
    plan: string,
    iteration: number,
    maxIterations: number,
    contextSummary: string
  ): Promise<string> {
    const ctx = this.buildPipelineContext()
    const basePrompt = await buildAIPrompt(ctx, plan)

    let iterationContext = `\n\n## Iteration Context
This is iteration ${iteration} of ${maxIterations}.
`

    if (contextSummary) {
      iterationContext += `\n### Previous Progress
${contextSummary}

Continue from where you left off. Focus on the next logical step.
`
    }

    if (this.subtasks.length > 0) {
      const pendingSubtasks = this.subtasks.filter((s) => s.status === 'pending')
      const currentSubtask = pendingSubtasks[0]

      if (currentSubtask) {
        iterationContext += `\n### Current Subtask
Focus on this subtask: ${currentSubtask.title}
${currentSubtask.description || ''}

Remaining subtasks: ${pendingSubtasks.length}
`
      }
    }

    iterationContext += `\n### Iteration Guidelines
- Focus on making incremental progress
- Commit meaningful chunks of work
- Leave the codebase in a working state
- If you complete the current subtask, move to the next one
`

    // Add follow-up context
    const followUpContext = this.approvalManager?.buildFollowUpContext() ?? ''

    return basePrompt + iterationContext + followUpContext
  }

  private async checkpointProgress(
    iteration: number,
    contextCarryover: 'full' | 'summary' | 'none'
  ): Promise<void> {
    const workingDir = this.getWorkingDir()

    try {
      if (await isWorkingTreeClean(workingDir)) {
        this.log(`Iteration ${iteration}: No changes to checkpoint`)
        return
      }

      await stageAll(workingDir)

      const commitMsg = `[WIP] Iteration ${iteration}: Progress checkpoint

Automated checkpoint by Patchwork worker.
Card: #${this.card?.remote_number_or_iid} ${this.card?.title}`

      await commit(workingDir, commitMsg)

      this.log(`Iteration ${iteration}: Progress checkpointed`)

      await this.updateSubtaskProgress()

      if (this.progress && contextCarryover !== 'none') {
        const modifiedFiles = await getModifiedFiles(
          workingDir,
          this.branchManager?.getBaseHeadSha() ?? 'HEAD~1'
        )
        updateWorkerProgress(this.progress.id, {
          iteration,
          filesModified: modifiedFiles
        })
      }
    } catch (error) {
      this.log(`Checkpoint warning: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async isIterationComplete(): Promise<boolean> {
    if (this.subtasks.length > 0) {
      return this.subtasks.every((s) => s.status === 'completed')
    }
    return false
  }

  private async generateContextSummary(mode: 'full' | 'summary' | 'none'): Promise<string> {
    if (mode === 'none') return ''

    const workingDir = this.getWorkingDir()
    const baseRef = this.branchManager?.getBaseHeadSha() ?? 'HEAD~1'

    try {
      const diffStat = await getDiffStat(workingDir, baseRef)
      const modifiedFiles = await getModifiedFiles(workingDir, baseRef)

      let summary = `Files modified:\n${modifiedFiles.join('\n')}\n\nChange summary:\n${diffStat}`

      if (mode === 'summary') {
        const lines = summary.split('\n')
        if (lines.length > 20) {
          summary = lines.slice(0, 20).join('\n') + '\n... (truncated)'
        }
      }

      return summary
    } catch {
      return ''
    }
  }

  private async updateSubtaskProgress(): Promise<void> {
    if (this.subtasks.length === 0) return

    const inProgress = this.subtasks.find((s) => s.status === 'in_progress')
    if (inProgress) {
      updateSubtaskStatus(inProgress.id, 'completed')
      const updated = this.taskDecomposer?.getExistingSubtasks(this.cardId)
      if (updated) this.subtasks = updated
    }

    const nextPending = getNextPendingSubtask(this.cardId)
    if (nextPending) {
      updateSubtaskStatus(nextPending.id, 'in_progress')
      const updated = this.taskDecomposer?.getExistingSubtasks(this.cardId)
      if (updated) this.subtasks = updated
    }

    if (this.progress) {
      const completed = this.subtasks.filter((s) => s.status === 'completed').length
      updateWorkerProgress(this.progress.id, {
        subtasksCompleted: completed,
        subtaskIndex: this.subtasks.findIndex((s) => s.status === 'in_progress')
      })
    }
  }

  // ==================== Context Builder ====================

  private buildPipelineContext(): PipelineContext {
    return {
      projectId: this.projectId,
      cardId: this.cardId,
      jobId: this.jobId,
      workerId: this.workerId,
      project: this.project,
      card: this.card,
      policy: this.policy,
      adapter: this.adapter,
      startingBranch: this.branchManager?.getStartingBranch() ?? null,
      baseBranch: this.branchManager?.getBaseBranch() ?? null,
      baseHeadSha: this.branchManager?.getBaseHeadSha() ?? null,
      workerBranch: this.branchManager?.getWorkerBranch() ?? this.worktreeManager?.getWorkerBranch() ?? null,
      useWorktree: this.useWorktree,
      worktreeManager: this.worktreeManager?.getWorktreeManager() ?? null,
      worktreeRecord: this.worktreeManager?.getWorktreeRecord() ?? null,
      worktreePath: this.worktreeManager?.getWorktreePath() ?? null,
      taskDecomposer: this.taskDecomposer,
      subtasks: this.subtasks,
      progress: this.progress,
      phase: this.logManager.getPhase(),
      logs: this.logManager.getLogs(),
      lastPlan: undefined,
      lastPersistMs: 0
    }
  }
}

// ==================== Public API ====================

export async function runWorker(jobId: string): Promise<WorkerResult> {
  const job = getJob(jobId)
  if (!job) {
    return { success: false, phase: 'init', error: 'Job not found' }
  }

  if (!job.card_id) {
    return { success: false, phase: 'init', error: 'No card specified' }
  }

  if (!acquireJobLease(jobId)) {
    return { success: false, phase: 'init', error: 'Failed to acquire job lease' }
  }
  broadcastToRenderers('stateUpdated')

  const pipeline = new WorkerPipeline(job.project_id, job.card_id)
  let result: WorkerResult
  try {
    result = await pipeline.run(jobId)
  } catch (error) {
    const finalState = getJob(jobId)?.state
    const message = error instanceof Error ? error.message : String(error)
    const canceled = error instanceof WorkerCanceledError || finalState === 'canceled'

    result = {
      success: false,
      phase: canceled ? 'canceled' : 'error',
      error: message
    }

    updateJobState(jobId, canceled ? 'canceled' : 'failed', result, message)
    broadcastToRenderers('stateUpdated')
    return result
  }

  // Update job state
  const finalState = getJob(jobId)?.state
  if (result.phase === 'canceled' || finalState === 'canceled') {
    updateJobState(jobId, 'canceled', result, result.error)
    deletePlanApprovalsByJob(jobId)
    deleteFollowUpInstructionsByJob(jobId)
  } else if (result.phase === 'pending_approval' || finalState === 'pending_approval') {
    // Job is waiting for plan approval - don't update state
  } else if (result.success) {
    updateJobState(jobId, 'succeeded', result)
    deletePlanApprovalsByJob(jobId)
    deleteFollowUpInstructionsByJob(jobId)
  } else {
    updateJobState(jobId, 'failed', result, result.error)
    deletePlanApprovalsByJob(jobId)
    deleteFollowUpInstructionsByJob(jobId)
  }
  broadcastToRenderers('stateUpdated')

  // Trigger sync after job completion (success or failure)
  // This will be debounced by the scheduler
  const completedJob = getJob(jobId)
  if (completedJob?.project_id) {
    triggerProjectSync(completedJob.project_id)
  }

  return result
}

/**
 * Resume a worker job after plan approval.
 */
export async function resumeWorkerAfterApproval(jobId: string): Promise<WorkerResult> {
  const job = getJob(jobId)
  if (!job) {
    return { success: false, phase: 'init', error: 'Job not found' }
  }

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
      'Plan rejected by reviewer'
    )
    deletePlanApprovalsByJob(jobId)
    deleteFollowUpInstructionsByJob(jobId)
    broadcastToRenderers('stateUpdated')
    return { success: false, phase: 'canceled', error: 'Plan rejected by reviewer' }
  }

  // Plan is approved or skipped - resume
  updateJobState(jobId, 'running', { success: false, phase: 'ai', plan: approval.plan })
  broadcastToRenderers('stateUpdated')

  return runWorker(jobId)
}

// Re-export errors for backward compatibility
export { WorkerCanceledError, WorkerPendingApprovalError } from './errors'
