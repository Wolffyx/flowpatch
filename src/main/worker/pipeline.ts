import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { GithubAdapter } from '../adapters/github'
import { GitlabAdapter } from '../adapters/gitlab'
import {
  getProject,
  getCard,
  updateCardStatus,
  createEvent,
  ensureCardLink,
  listCardLinks,
  updateJobState,
  updateJobResult,
  getJob,
  cancelJob,
  acquireJobLease,
  renewJobLease,
  createWorktree,
  updateWorktreeStatus,
  updateWorktreeJob,
  getWorktreeByCard,
  acquireWorktreeLock,
  releaseWorktreeLock,
  renewWorktreeLock,
  countActiveWorktrees,
  cryptoRandomId,
  updateSubtaskStatus,
  getNextPendingSubtask,
  createWorkerProgress,
  updateWorkerProgress,
  getWorkerProgress
} from '../db'
import { TaskDecomposer } from '../services/task-decomposer'
import type {
  CardStatus,
  JobState,
  Project,
  Card,
  PolicyConfig,
  WorkerLogMessage,
  Worktree,
  Subtask,
  WorkerProgress
} from '../../shared/types'
import { slugify, generateWorktreeBranchName } from '../../shared/types'
import { broadcastToRenderers } from '../ipc/broadcast'
import { GitWorktreeManager, WorktreeConfig } from '../services/git-worktree-manager'
import { buildContextBundle, buildPromptContext } from '../services/patchwork-context'
import { writeCheckpoint, readCheckpoint, ensureRunDir } from '../services/patchwork-runs'

const execFileAsync = promisify(execFile)

interface WorkerResult {
  success: boolean
  phase: string
  prUrl?: string
  error?: string
  plan?: string
  logs?: string[]
}

class WorkerCanceledError extends Error {
  constructor(message = 'Canceled') {
    super(message)
    this.name = 'WorkerCanceledError'
  }
}

export class WorkerPipeline {
  private projectId: string
  private cardId: string
  private project: Project | null = null
  private card: Card | null = null
  private policy: PolicyConfig
  private adapter: GithubAdapter | GitlabAdapter | null = null
  private logs: string[] = []
  private leaseInterval: NodeJS.Timeout | null = null
  private worktreeLockInterval: NodeJS.Timeout | null = null
  private jobId: string | null = null
  private phase: string = 'init'
  private lastPlan: string | undefined
  private lastPersistMs = 0
  private startingBranch: string | null = null
  private baseBranch: string | null = null
  private baseHeadSha: string | null = null
  private workerBranch: string | null = null

  // Worktree-specific state
  private useWorktree: boolean = false
  private worktreeManager: GitWorktreeManager | null = null
  private worktreeRecord: Worktree | null = null
  private worktreePath: string | null = null
  private workerId: string = cryptoRandomId()

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
  }

  private normalizePath(p: string): string {
    const resolved = resolve(p)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }

  /**
   * Get the working directory for operations.
   * Returns worktree path if using worktrees, otherwise the main repo path.
   */
  private getWorkingDir(): string {
    return this.worktreePath ?? this.project!.local_path
  }

  private gitEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: process.env.GIT_ASKPASS || 'echo'
    }
  }

  /**
   * Get worktree configuration from policy.
   */
  private getWorktreeConfig(): WorktreeConfig {
    return {
      root: this.policy.worker?.worktree?.root ?? 'repo',
      customPath: this.policy.worker?.worktree?.customPath
    }
  }

  private getJobState(): JobState | null {
    if (!this.jobId) return null
    const job = getJob(this.jobId)
    return job?.state ?? null
  }

  private isCanceled(): boolean {
    return this.getJobState() === 'canceled'
  }

  private cancelJob(reason?: string): void {
    if (!this.jobId) return
    if (this.isCanceled()) return
    cancelJob(this.jobId, reason ?? 'Canceled')
  }

  private ensureNotCanceled(): void {
    if (this.isCanceled()) throw new WorkerCanceledError()
  }

  private ensureCardStatusAllowed(allowed: CardStatus[], reason?: string): void {
    const card = getCard(this.cardId)
    if (!card) return
    this.card = card

    if (allowed.includes(card.status)) return

    this.cancelJob(reason ?? `Canceled: card moved to ${card.status}`)
    throw new WorkerCanceledError()
  }

  private setPhase(phase: string): void {
    this.phase = phase
    this.persistPartialResult(true)
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
        phase: this.phase,
        iteration,
        updatedAt: new Date().toISOString(),
        lastContextPath: this.progress?.progress_file_path ?? undefined
      })
    } catch {
      // ignore checkpoint failures
    }
  }

  private log(message: string, meta?: { source?: string; stream?: 'stdout' | 'stderr' }): void {
    const ts = new Date().toISOString()
    const sourcePrefix = meta?.source
      ? `[${meta.source}${meta.stream ? `:${meta.stream}` : ''}] `
      : ''
    const fullMessage = `${sourcePrefix}${message}`
    const line = `[${ts}] ${fullMessage}`
    this.logs.push(line)
    console.log(`[Worker] ${fullMessage}`)

    if (!this.jobId) return

    const payload: WorkerLogMessage = {
      projectId: this.projectId,
      jobId: this.jobId,
      cardId: this.cardId,
      ts,
      line,
      source: meta?.source,
      stream: meta?.stream
    }

    broadcastToRenderers('workerLog', payload)
    this.persistPartialResult(false)
  }

  private persistPartialResult(force: boolean): void {
    if (!this.jobId) return
    const now = Date.now()
    if (!force && now - this.lastPersistMs < 1000) return
    this.lastPersistMs = now

    updateJobResult(this.jobId, {
      success: false,
      phase: this.phase,
      plan: this.lastPlan,
      logs: this.logs.slice(-500)
    })

    broadcastToRenderers('stateUpdated')
  }

  async initialize(): Promise<boolean> {
    this.project = getProject(this.projectId)
    if (!this.project) {
      this.log('Project not found')
      return false
    }

    this.card = getCard(this.cardId)
    if (!this.card) {
      this.log('Card not found')
      return false
    }

    // If we're resuming an existing job, load any prior checkpoint to reduce rework.
    if (this.jobId && this.project) {
      try {
        const cp = readCheckpoint(this.project.local_path, this.jobId)
        if (cp?.phase) {
          this.phase = cp.phase
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
    const provider = this.project.provider_hint || 'auto'
    if (provider === 'github' || this.project.remote_repo_key.startsWith('github:')) {
      this.adapter = new GithubAdapter(
        this.project.local_path,
        this.project.remote_repo_key,
        this.policy
      )
    } else if (provider === 'gitlab' || this.project.remote_repo_key.startsWith('gitlab:')) {
      this.adapter = new GitlabAdapter(
        this.project.local_path,
        this.project.remote_repo_key,
        this.policy
      )
    }

    // Initialize task decomposer if enabled
    if (this.policy.worker?.decomposition?.enabled) {
      this.taskDecomposer = new TaskDecomposer(this.policy, this.adapter)
    }

    // Initialize worktree manager if worktrees are enabled
    if (this.policy.worker?.worktree?.enabled) {
      this.worktreeManager = new GitWorktreeManager(this.project.local_path)

      // Check git version supports worktrees
      if (!this.worktreeManager.checkWorktreeSupport()) {
        this.log(
          'Git version does not support worktrees (requires 2.17+), falling back to stash mode'
        )
        this.useWorktree = false
      } else {
        // Check max concurrent limit
        const maxConcurrent = this.policy.worker.worktree.maxConcurrent ?? 1
        const activeCount = countActiveWorktrees(this.projectId)
        if (activeCount >= maxConcurrent) {
          this.log(
            `Max concurrent worktrees reached (${activeCount}/${maxConcurrent}), falling back to stash mode`
          )
          this.useWorktree = false
        } else {
          this.useWorktree = true
          this.log('Worktree mode enabled')
        }
      }
    }

    return true
  }

  async run(jobId: string): Promise<WorkerResult> {
    this.jobId = jobId
    this.setPhase('init')

    // Start lease renewal
    this.leaseInterval = setInterval(() => {
      renewJobLease(jobId)
    }, 60000) // Renew every minute

    try {
      const initialized = await this.initialize()
      if (!initialized) {
        return { success: false, phase: 'init', error: 'Failed to initialize', logs: this.logs }
      }

      this.ensureNotCanceled()
      this.ensureCardStatusAllowed(['ready'], 'Canceled: card no longer Ready')

      // Phase 1: Move to In Progress
      this.setPhase('in_progress')
      this.log('Moving card to In Progress')
      await this.moveToInProgress()

      this.ensureNotCanceled()
      this.ensureCardStatusAllowed(['in_progress'])

      // Phase 2: Setup working environment (worktree or stash-based)
      this.setPhase('working_tree')
      if (this.useWorktree) {
        this.log('Setting up worktree')
        const worktreeSetup = await this.setupWorktree()
        if (!worktreeSetup) {
          return {
            success: false,
            phase: 'working_tree',
            error: 'Failed to setup worktree',
            logs: this.logs
          }
        }
        // Start worktree lock renewal
        if (this.worktreeRecord) {
          this.worktreeLockInterval = setInterval(
            () => {
              if (this.worktreeRecord) {
                renewWorktreeLock(this.worktreeRecord.id, this.workerId, 10)
              }
            },
            5 * 60 * 1000
          ) // Renew every 5 minutes
        }
      } else {
        this.log('Checking working tree')
        const cleanTree = await this.checkWorkingTree()
        if (!cleanTree) {
          return {
            success: false,
            phase: 'working_tree',
            error: 'Working tree is not clean',
            logs: this.logs
          }
        }
      }

      this.ensureNotCanceled()
      this.ensureCardStatusAllowed(['in_progress'])

      // Phase 3: Fetch latest
      this.setPhase('fetch')
      this.log('Fetching latest from remote')
      await this.fetchLatest()

      this.ensureNotCanceled()
      this.ensureCardStatusAllowed(['in_progress'])

      // Phase 4: Create branch (only if not using worktree - worktree already created branch)
      this.setPhase('branch')
      let branchName: string
      if (this.useWorktree && this.workerBranch) {
        branchName = this.workerBranch
        this.log(`Using worktree branch: ${branchName}`)
      } else {
        branchName = this.generateBranchName()
        this.log(`Preparing branch: ${branchName}`)
        await this.createBranch(branchName)
      }

      this.ensureNotCanceled()
      this.ensureCardStatusAllowed(['in_progress'])

      // Phase 4.5: Task Decomposition (if enabled)
      if (this.taskDecomposer && this.card) {
        this.setPhase('decomposition')
        await this.runDecomposition()
      }

      this.ensureNotCanceled()
      this.ensureCardStatusAllowed(['in_progress'])

      // Phase 5: Generate plan
      this.setPhase('plan')
      this.log('Generating implementation plan')
      const plan = await this.generatePlan()
      if (!plan) {
        return {
          success: false,
          phase: 'plan',
          error: 'Failed to generate plan',
          logs: this.logs
        }
      }
      this.lastPlan = plan

      // Store plan as event
      createEvent(this.projectId, 'worker_plan', this.cardId, { plan })

      // Phase 6: Run AI tool (Claude Code or Codex)
      // Supports both single-shot and iterative modes
      this.setPhase('ai')
      const sessionMode = this.policy.worker?.session?.sessionMode ?? 'single'
      let aiSuccess: boolean

      if (sessionMode === 'iterative') {
        this.log('Running AI implementation (iterative mode)')
        aiSuccess = await this.runIterativeAI(plan)
      } else {
        this.log('Running AI implementation')
        aiSuccess = await this.runAI(plan)
      }

      this.ensureNotCanceled()
      this.ensureCardStatusAllowed(['in_progress'])
      if (!aiSuccess) {
        return {
          success: false,
          phase: 'ai',
          error: 'AI implementation failed',
          plan,
          logs: this.logs
        }
      }

      // Phase 7: Run checks
      this.setPhase('checks')
      this.log('Running verification checks')
      const checksPass = await this.runChecks()
      this.ensureNotCanceled()
      this.ensureCardStatusAllowed(['in_progress'])
      if (!checksPass) {
        this.log('Checks failed, creating WIP PR')
        // Still create PR but mark as WIP
      }

      // Phase 8: Commit and push
      this.setPhase('push')
      this.log('Committing and pushing changes')
      await this.commitAndPush(branchName)

      this.ensureNotCanceled()
      this.ensureCardStatusAllowed(['in_progress'])

      // Phase 9: Create PR/MR
      this.setPhase('pr')
      this.log('Creating PR/MR')
      const prResult = await this.createPR(branchName, plan, checksPass)
      this.ensureNotCanceled()
      this.ensureCardStatusAllowed(['in_progress'])
      if (!prResult) {
        return {
          success: false,
          phase: 'pr',
          error: 'Failed to create PR/MR',
          plan,
          logs: this.logs
        }
      }

      // Phase 10: Move to In Review
      this.setPhase('in_review')
      this.log('Moving card to In Review')
      await this.moveToInReview(prResult.url, !prResult.existing)

      this.setPhase('done')
      return {
        success: true,
        phase: 'complete',
        prUrl: prResult.url,
        plan,
        logs: this.logs
      }
    } catch (err) {
      if (err instanceof WorkerCanceledError) {
        this.setPhase('canceled')
        this.log('Worker run canceled')
        return {
          success: false,
          phase: 'canceled',
          error: 'Canceled',
          plan: this.lastPlan,
          logs: this.logs
        }
      }
      throw err
    } finally {
      // Stop lease renewal
      if (this.leaseInterval) {
        clearInterval(this.leaseInterval)
      }

      // Stop worktree lock renewal
      if (this.worktreeLockInterval) {
        clearInterval(this.worktreeLockInterval)
      }

      // Handle worktree or traditional cleanup
      if (this.useWorktree && this.worktreeRecord) {
        await this.cleanupWorktree(this.phase === 'done')
      } else {
        if (this.isCanceled() && this.policy.worker?.rollbackOnCancel) {
          await this.rollbackWorkerChanges()
        }
        // Restore any stashed changes
        await this.restoreStash()
      }
    }
  }

  /**
   * Setup a git worktree for isolated work.
   * The flow is:
   * 1. Check for existing worktree (and verify it's healthy)
   * 2. Create DB record with lock already set (atomic lock acquisition)
   * 3. Create git worktree
   * 4. Verify worktree is healthy before marking as 'running'
   */
  private async setupWorktree(): Promise<boolean> {
    if (!this.worktreeManager || !this.card || !this.project) return false

    try {
      const config = this.getWorktreeConfig()
      const baseBranch =
        this.policy.worker?.worktree?.baseBranch ?? this.worktreeManager.getDefaultBranch()
      this.baseBranch = baseBranch

      // Generate branch name using worktree naming convention
      const branchName = generateWorktreeBranchName(
        this.card.provider,
        this.card.remote_number_or_iid,
        this.card.title,
        this.policy.worker?.worktree?.branchPrefix ?? 'patchwork/'
      )

      // Compute worktree path
      const worktreePath = this.worktreeManager.computeWorktreePath(branchName, config)

      // Check if there's an existing worktree for this card
      const existingWorktree = getWorktreeByCard(this.cardId)
      if (existingWorktree && existingWorktree.status === 'ready') {
        // Verify the existing worktree is healthy before reusing
        const health = this.worktreeManager.verifyWorktree(
          existingWorktree.worktree_path,
          existingWorktree.branch_name
        )

        if (!health.healthy) {
          this.log(`Existing worktree is unhealthy: ${health.error}. Will recreate.`)
          // Mark as error and continue to create a new one
          updateWorktreeStatus(existingWorktree.id, 'error', health.error)
        } else {
          // Acquire lock to ensure exclusive use
          const locked = acquireWorktreeLock(existingWorktree.id, this.workerId, 10)
          if (!locked) {
            this.log(`Worktree is locked by another worker: ${existingWorktree.worktree_path}`)
            return false
          }

          this.log(`Reusing existing worktree: ${existingWorktree.worktree_path}`)
          this.worktreeRecord = existingWorktree
          this.worktreePath = existingWorktree.worktree_path
          this.workerBranch = existingWorktree.branch_name
          updateWorktreeJob(existingWorktree.id, this.jobId)
          updateWorktreeStatus(existingWorktree.id, 'running')
          return true
        }
      }

      // Create DB record with lock already acquired (prevents race condition)
      // By setting lockedBy and lockExpiresAt during creation, we atomically claim the record
      const now = new Date()
      const lockExpiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString()

      this.worktreeRecord = createWorktree({
        projectId: this.projectId,
        cardId: this.cardId,
        jobId: this.jobId ?? undefined,
        worktreePath,
        branchName,
        baseRef: `origin/${baseBranch}`,
        status: 'creating',
        lockedBy: this.workerId,
        lockExpiresAt
      })

      this.log(`Creating worktree at: ${worktreePath}`)

      // Create the worktree
      const result = await this.worktreeManager.ensureWorktree(
        worktreePath,
        branchName,
        baseBranch,
        {
          fetchFirst: true,
          config
        }
      )

      this.worktreePath = result.worktreePath
      this.workerBranch = result.branchName

      // Verify the worktree was created successfully before marking as running
      const health = this.worktreeManager.verifyWorktree(result.worktreePath, result.branchName)
      if (!health.healthy) {
        const error = `Worktree verification failed: ${health.error}`
        this.log(error)
        updateWorktreeStatus(this.worktreeRecord.id, 'error', error)
        return false
      }

      // Update status to running
      updateWorktreeStatus(this.worktreeRecord.id, 'running')

      this.log(`Worktree ${result.created ? 'created' : 'reused'}: ${result.branchName}`)
      return true
    } catch (error) {
      this.log(`Failed to setup worktree: ${error}`)
      if (this.worktreeRecord) {
        updateWorktreeStatus(
          this.worktreeRecord.id,
          'error',
          error instanceof Error ? error.message : String(error)
        )
      }
      return false
    }
  }

  /**
   * Cleanup worktree after worker completes.
   */
  private async cleanupWorktree(success: boolean): Promise<void> {
    if (!this.worktreeRecord || !this.worktreeManager) return

    const cleanup = this.policy.worker?.worktree?.cleanup
    const cleanupTiming = success ? cleanup?.onSuccess : cleanup?.onFailure

    // Release lock (pass workerId to verify we own it)
    releaseWorktreeLock(this.worktreeRecord.id, this.workerId)

    switch (cleanupTiming) {
      case 'immediate':
        this.log('Cleaning up worktree immediately')
        try {
          await this.worktreeManager.removeWorktree(this.worktreePath!, {
            force: true,
            config: this.getWorktreeConfig()
          })
          updateWorktreeStatus(this.worktreeRecord.id, 'cleaned')
        } catch (error) {
          this.log(`Failed to cleanup worktree: ${error}`)
          updateWorktreeStatus(
            this.worktreeRecord.id,
            'error',
            error instanceof Error ? error.message : String(error)
          )
        }
        break

      case 'delay':
        this.log('Worktree marked for delayed cleanup')
        updateWorktreeStatus(this.worktreeRecord.id, 'cleanup_pending')
        break

      case 'never':
        this.log('Worktree kept (cleanup=never)')
        updateWorktreeStatus(this.worktreeRecord.id, 'ready')
        break

      default:
        // Default: immediate on success, delay on failure
        if (success) {
          try {
            await this.worktreeManager.removeWorktree(this.worktreePath!, {
              force: true,
              config: this.getWorktreeConfig()
            })
            updateWorktreeStatus(this.worktreeRecord.id, 'cleaned')
          } catch (error) {
            updateWorktreeStatus(this.worktreeRecord.id, 'cleanup_pending')
          }
        } else {
          updateWorktreeStatus(this.worktreeRecord.id, 'cleanup_pending')
        }
    }
  }

  private async runProcessStreaming(options: {
    command: string
    args: string[]
    cwd: string
    timeoutMs: number
    source: string
    env?: NodeJS.ProcessEnv
  }): Promise<void> {
    const { command, args, cwd, timeoutMs, source, env } = options

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let killedByTimeout = false
      const timer = setTimeout(() => {
        killedByTimeout = true
        try {
          if (process.platform === 'win32' && child.pid) {
            execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {})
          } else {
            child.kill('SIGKILL')
          }
        } catch {
          // ignore
        }
      }, timeoutMs)

      let killedByCancel = false
      const cancelTimer = setInterval(() => {
        if (!this.isCanceled()) return
        if (!child.pid) return

        killedByCancel = true
        try {
          if (process.platform === 'win32') {
            execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {})
          } else {
            child.kill('SIGTERM')
            setTimeout(() => {
              try {
                child.kill('SIGKILL')
              } catch {
                // ignore
              }
            }, 2000)
          }
        } catch {
          // ignore
        }
      }, 500)

      const buffers = { stdout: '', stderr: '' }
      const tail = { stdout: [] as string[], stderr: [] as string[] }
      const pushTail = (stream: 'stdout' | 'stderr', line: string): void => {
        if (!line) return
        tail[stream].push(line)
        if (tail[stream].length > 40) tail[stream].shift()
      }

      const flushLine = (line: string, stream: 'stdout' | 'stderr'): void => {
        const trimmed = line.trimEnd()
        if (trimmed) {
          pushTail(stream, trimmed)
          this.log(trimmed, { source, stream })
        }
      }

      const onChunk = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
        buffers[stream] += chunk.toString('utf-8')
        const parts = buffers[stream].split(/\r\n|\n|\r/)
        buffers[stream] = parts.pop() ?? ''
        for (const part of parts) flushLine(part, stream)
      }

      child.stdout?.on('data', (c: Buffer) => onChunk('stdout', c))
      child.stderr?.on('data', (c: Buffer) => onChunk('stderr', c))

      child.on('error', (err) => {
        clearTimeout(timer)
        clearInterval(cancelTimer)
        reject(err)
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        clearInterval(cancelTimer)

        flushLine(buffers.stdout, 'stdout')
        flushLine(buffers.stderr, 'stderr')

        if (killedByCancel || this.isCanceled()) {
          reject(new WorkerCanceledError())
          return
        }
        if (killedByTimeout) {
          reject(new Error(`${command} timed out after ${Math.ceil(timeoutMs / 1000)}s`))
          return
        }
        if (code && code !== 0) {
          const stderrTail = tail.stderr.length
            ? `\n\n--- stderr (tail) ---\n${tail.stderr.join('\n')}`
            : ''
          const stdoutTail = tail.stdout.length
            ? `\n\n--- stdout (tail) ---\n${tail.stdout.join('\n')}`
            : ''
          reject(new Error(`${command} exited with code ${code}${stderrTail}${stdoutTail}`))
          return
        }
        resolve()
      })
    })
  }

  private async moveToInProgress(): Promise<void> {
    updateCardStatus(this.cardId, 'in_progress')
    createEvent(this.projectId, 'status_changed', this.cardId, {
      from: this.card?.status,
      to: 'in_progress',
      source: 'worker'
    })

    // Update remote if adapter available
    if (this.adapter && this.card?.remote_number_or_iid) {
      const issueNumber = parseInt(this.card.remote_number_or_iid, 10)
      const newLabel = this.adapter.getStatusLabel('in_progress')
      const allLabels = this.adapter.getAllStatusLabels()
      await this.adapter.updateLabels(
        issueNumber,
        [newLabel],
        allLabels.filter((l) => l !== newLabel)
      )
    }
  }

  private async checkWorkingTree(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: this.project!.local_path
      })

      if (stdout.trim() === '') {
        return true
      }

      // Working tree has changes - check policy for how to handle
      // For now, try to stash changes automatically
      this.log('Working tree has uncommitted changes, attempting to stash...')

      try {
        await execFileAsync('git', ['stash', 'push', '-m', 'patchwork-worker-autostash'], {
          cwd: this.project!.local_path
        })
        this.log('Changes stashed successfully')
        return true
      } catch (stashError) {
        this.log(`Failed to stash changes: ${stashError}`)
        // Log what files are dirty to help user understand
        this.log(`Dirty files:\n${stdout.trim()}`)
        return false
      }
    } catch {
      return false
    }
  }

  /**
   * Restore stashed changes after worker completes (success or failure).
   */
  private async restoreStash(): Promise<void> {
    try {
      // Check if there's a stash with our marker
      const { stdout } = await execFileAsync('git', ['stash', 'list'], {
        cwd: this.project!.local_path
      })

      const line = stdout.split(/\r\n|\n|\r/).find((l) => l.includes('patchwork-worker-autostash'))
      if (!line) return

      const m = line.match(/^(stash@\{\d+\}):/)
      const ref = m?.[1] ?? null
      if (!ref) return

      this.log(`Restoring stashed changes from ${ref}...`)

      try {
        // Use apply + drop instead of pop so we don't lose the stash if there are conflicts.
        await execFileAsync('git', ['stash', 'apply', ref], {
          cwd: this.project!.local_path
        })

        await execFileAsync('git', ['stash', 'drop', ref], {
          cwd: this.project!.local_path
        })

        this.log('Stashed changes restored')
      } catch (error) {
        this.log(
          `Warning: Failed to restore autostash (${ref}). The stash was kept; you can resolve conflicts and run: git stash pop ${ref}. Error: ${error}`
        )
      }
    } catch (error) {
      this.log(`Warning: Failed to restore stash: ${error}`)
    }
  }

  private async fetchLatest(): Promise<void> {
    try {
      await execFileAsync('git', ['fetch', 'origin'], {
        cwd: this.project!.local_path,
        env: this.gitEnv()
      })
    } catch (error) {
      this.log(`Fetch warning: ${error}`)
    }
  }

  private async getCurrentBranch(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: this.project!.local_path
      })
      const name = stdout.trim()
      if (!name || name === 'HEAD') return null
      return name
    } catch {
      return null
    }
  }

  private async rollbackWorkerChanges(): Promise<void> {
    if (!this.project) return
    if (!this.workerBranch) return

    this.log('Rollback enabled: reverting worker changes')

    try {
      if (this.baseHeadSha) {
        await execFileAsync('git', ['reset', '--hard', this.baseHeadSha], {
          cwd: this.project.local_path
        })
      } else {
        await execFileAsync('git', ['reset', '--hard'], {
          cwd: this.project.local_path
        })
      }
    } catch (error) {
      this.log(`Rollback warning: reset failed: ${error}`)
    }

    const targetBranch = this.startingBranch || this.baseBranch || 'main'
    try {
      await execFileAsync('git', ['checkout', targetBranch], {
        cwd: this.project.local_path
      })
    } catch (error) {
      this.log(`Rollback warning: checkout failed: ${error}`)
    }

    try {
      if (this.workerBranch !== targetBranch) {
        await execFileAsync('git', ['branch', '-D', this.workerBranch], {
          cwd: this.project.local_path
        })
      }
    } catch (error) {
      this.log(`Rollback warning: branch delete failed: ${error}`)
    }
  }

  private generateBranchName(): string {
    const pattern = this.policy.worker?.branchPattern || 'kanban/{id}-{slug}'
    const issueId = this.card?.remote_number_or_iid || this.cardId.slice(0, 8)
    const titleSlug = this.card ? slugify(this.card.title) : 'task'

    return pattern.replace('{id}', issueId).replace('{slug}', titleSlug.slice(0, 30))
  }

  private async createBranch(branchName: string): Promise<void> {
    const baseBranch = await this.getBaseBranch()
    this.baseBranch = baseBranch

    try {
      if (!this.startingBranch) {
        this.startingBranch = await this.getCurrentBranch()
      }

      // If branch already exists, just check it out and continue work there.
      if (await this.localBranchExists(branchName)) {
        const checkedOutAt = await this.getWorktreePathForBranch(branchName)
        if (
          checkedOutAt &&
          this.normalizePath(checkedOutAt) !== this.normalizePath(this.project!.local_path)
        ) {
          throw new Error(
            `Branch ${branchName} is already checked out in another worktree: ${checkedOutAt}`
          )
        }
        this.log(`Branch exists locally; checking out: ${branchName}`)
        await execFileAsync('git', ['checkout', branchName], {
          cwd: this.project!.local_path
        })
        await this.updateBranchFromOrigin(branchName)
        this.workerBranch = branchName
        return
      }

      // Refresh remote refs for this branch name (best-effort) so the remote existence check is accurate.
      try {
        await execFileAsync('git', ['fetch', 'origin', branchName], {
          cwd: this.project!.local_path,
          env: this.gitEnv()
        })
      } catch {
        // ignore
      }

      // If remote branch exists, create a local tracking branch and continue there.
      if (await this.remoteBranchExists(branchName)) {
        const checkedOutAt = await this.getWorktreePathForBranch(branchName)
        if (
          checkedOutAt &&
          this.normalizePath(checkedOutAt) !== this.normalizePath(this.project!.local_path)
        ) {
          throw new Error(
            `Branch ${branchName} is already checked out in another worktree: ${checkedOutAt}`
          )
        }
        this.log(`Branch exists on origin; creating local tracking branch: ${branchName}`)
        await execFileAsync(
          'git',
          ['checkout', '--track', '-b', branchName, `origin/${branchName}`],
          { cwd: this.project!.local_path }
        )
        await this.updateBranchFromOrigin(branchName)
        this.workerBranch = branchName
        return
      }

      // Checkout base branch and pull
      await execFileAsync('git', ['checkout', baseBranch], {
        cwd: this.project!.local_path,
        env: this.gitEnv()
      })
      await execFileAsync('git', ['pull', 'origin', baseBranch], {
        cwd: this.project!.local_path,
        env: this.gitEnv()
      })
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
          cwd: this.project!.local_path
        })
        this.baseHeadSha = stdout.trim() || null
      } catch {
        this.baseHeadSha = null
      }
      // Create and checkout new branch
      await execFileAsync('git', ['checkout', '-b', branchName], {
        cwd: this.project!.local_path
      })
      this.workerBranch = branchName
    } catch (error) {
      this.log(`Branch creation warning: ${error}`)
      throw error
    }
  }

  private async updateBranchFromOrigin(branchName: string): Promise<void> {
    // Avoid disruptive pulls if the working tree is dirty (shouldn't happen, but be safe).
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: this.project!.local_path,
        env: this.gitEnv()
      })
      if (stdout.trim()) {
        this.log('Skipping branch update: working tree not clean')
        return
      }
    } catch {
      // ignore
    }

    // Fetch remote ref for the branch (best-effort).
    try {
      await execFileAsync('git', ['fetch', 'origin', branchName], {
        cwd: this.project!.local_path,
        env: this.gitEnv()
      })
    } catch {
      // ignore
    }

    // If the remote branch exists, pull/rebase so we don't get non-fast-forward on push.
    if (!(await this.remoteBranchExists(branchName))) return

    try {
      await execFileAsync('git', ['pull', '--rebase', 'origin', branchName], {
        cwd: this.project!.local_path,
        env: this.gitEnv()
      })
      this.log(`Updated branch from origin/${branchName}`)
    } catch (error) {
      this.log(`Branch update warning: ${error}`)
      throw error
    }
  }

  private async getWorktreePathForBranch(branchName: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
        cwd: this.project!.local_path
      })
      const entries = stdout.split(/\r?\n\r?\n/).filter((e) => e.trim())
      for (const entry of entries) {
        const lines = entry.split(/\r?\n/)
        let worktreePath: string | null = null
        let branch: string | null = null
        for (const line of lines) {
          if (line.startsWith('worktree ')) worktreePath = line.slice('worktree '.length).trim()
          if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim()
        }
        if (worktreePath && branch === `refs/heads/${branchName}`) return worktreePath
      }
      return null
    } catch {
      return null
    }
  }

  private async getBaseBranch(): Promise<string> {
    // Allow reusing the same config key as worktrees for consistency.
    const configured = this.policy.worker?.worktree?.baseBranch
    if (configured) return configured

    // Try to read default from origin/HEAD.
    try {
      const { stdout } = await execFileAsync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: this.project!.local_path
      })
      const ref = stdout.trim()
      if (ref) return ref.replace(/^refs\/remotes\/origin\//, '')
    } catch {
      // ignore
    }

    // Try common branch names.
    for (const candidate of ['main', 'master', 'develop']) {
      try {
        await execFileAsync('git', ['rev-parse', '--verify', `refs/heads/${candidate}`], {
          cwd: this.project!.local_path
        })
        return candidate
      } catch {
        // ignore
      }
    }

    return 'main'
  }

  private async localBranchExists(branchName: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
        cwd: this.project!.local_path
      })
      return true
    } catch {
      return false
    }
  }

  private async remoteBranchExists(branchName: string): Promise<boolean> {
    try {
      await execFileAsync(
        'git',
        ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`],
        { cwd: this.project!.local_path }
      )
      return true
    } catch {
      return false
    }
  }

  private async generatePlan(): Promise<string | null> {
    if (!this.card) return null

    const plan = `
# Implementation Plan

## Task
${this.card.title}

## Description
${this.card.body || 'No description provided'}

## Approach
1. Analyze the requirements
2. Identify files to modify
3. Implement changes
4. Run tests and linting
5. Commit and push

## Files to Touch
- To be determined during implementation

## Commands to Run
${(this.policy.worker?.allowedCommands || []).map((c) => `- ${c}`).join('\n')}

## Expected Outcomes
- Task requirements are met
- All tests pass
- Code follows project conventions

## Risks/Assumptions
- Assuming clean codebase state
- Assuming tests are comprehensive
`.trim()

    return plan
  }

  private async runAI(plan: string): Promise<boolean> {
    if (!this.project || !this.card) return false

    const toolPreference = this.policy.worker?.toolPreference || 'auto'
    const maxMinutes = this.policy.worker?.maxMinutes || 25
    const timeoutMs = maxMinutes * 60 * 1000

    // Detect available tools
    const hasClaude = await this.checkCommand('claude')
    const hasCodex = await this.checkCommand('codex')

    let tool: 'claude' | 'codex' | null = null
    if (toolPreference === 'claude' && hasClaude) tool = 'claude'
    else if (toolPreference === 'codex' && hasCodex) tool = 'codex'
    else if (toolPreference === 'auto') {
      if (hasClaude) tool = 'claude'
      else if (hasCodex) tool = 'codex'
    }

    if (!tool) {
      this.log('No AI tool available (claude or codex)')
      // Create a stub file with the plan - PR will be created as a placeholder
      const planPath = join(this.getWorkingDir(), 'IMPLEMENTATION_PLAN.md')
      const fullPlan = `# Implementation Plan (AI tool not available)

## Task
${this.card.title}

## Description
${this.card.body || 'No description'}

## Plan
${plan}

## Note
This PR was created without AI implementation because no AI tool (Claude Code or Codex) was detected.
Please implement the changes manually following the plan above.

## Commands
Allowed: ${(this.policy.worker?.allowedCommands || []).join(', ')}
Forbidden paths: ${(this.policy.worker?.forbidPaths || []).join(', ')}
`
      writeFileSync(planPath, fullPlan)
      return true // Return true to continue with stub PR
    }

    try {
      this.log(`Running ${tool} with ${maxMinutes} minute timeout`)

      // Build the prompt for the AI tool
      const prompt = await this.buildAIPrompt(plan)

      if (tool === 'claude') {
        try {
          await this.runClaudeCode(prompt, timeoutMs)
        } catch (error) {
          if (hasCodex && this.isClaudeRetryableLimitError(error)) {
            this.log('Claude failed due to rate/usage limit; falling back to Codex...')
            await this.runCodex(prompt, timeoutMs)
          } else {
            throw error
          }
        }
      } else if (tool === 'codex') {
        await this.runCodex(prompt, timeoutMs)
      }

      this.log('AI implementation completed')
      return true
    } catch (error) {
      this.log(`AI error: ${error}`)
      // On AI failure, still create the plan file so PR can be created as WIP
      const planPath = join(this.getWorkingDir(), 'IMPLEMENTATION_PLAN.md')
      const fullPlan = `# Implementation Plan (AI execution failed)

## Task
${this.card.title}

## Description
${this.card.body || 'No description'}

## Plan
${plan}

## Error
AI execution failed: ${error instanceof Error ? error.message : String(error)}

Please implement the changes manually following the plan above.
`
      writeFileSync(planPath, fullPlan)
      return false
    }
  }

  private isClaudeRetryableLimitError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error)
    const s = msg.toLowerCase()
    return (
      s.includes('rate limit') ||
      s.includes('ratelimit') ||
      s.includes('rate_limit') ||
      s.includes("you've hit your limit") ||
      s.includes('you\u2019ve hit your limit') ||
      s.includes('limit reached') ||
      s.includes('quota') ||
      s.includes('insufficient_quota') ||
      s.includes('too many requests') ||
      s.includes('http 429') ||
      s.includes('status 429') ||
      s.includes(' usage limit') ||
      s.includes('usage limit') ||
      s.includes('overloaded') ||
      s.includes('exceeded') ||
      s.includes('429')
    )
  }

  private async buildAIPrompt(plan: string): Promise<string> {
    const allowedCommands = this.policy.worker?.allowedCommands || []
    const forbidPaths = this.policy.worker?.forbidPaths || []
    const workingDir = this.getWorkingDir()
    const repoRoot = this.project!.local_path

    let repoContext = 'Project memory unavailable.'
    try {
      const bundle = await buildContextBundle(
        repoRoot,
        `${this.card!.title}\n${this.card!.body || ''}`
      )

      // Persist per-run context for audit and crash recovery.
      if (this.jobId) {
        try {
          const runDir = ensureRunDir(repoRoot, this.jobId)
          const runContextPath = join(runDir, 'last_context.json')
          writeFileSync(runContextPath, JSON.stringify(bundle, null, 2), { encoding: 'utf-8' })
          if (this.progress) {
            updateWorkerProgress(this.progress.id, { progressFilePath: runContextPath })
          }
        } catch {
          // ignore
        }
      }

      repoContext = buildPromptContext(repoRoot, bundle)
    } catch {
      // ignore
    }

    return `# Task: Implement the following issue

## Issue Title
${this.card!.title}

## Issue Description
${this.card!.body || 'No description provided'}

## Implementation Plan
${plan}

## Important Constraints
- Only use these commands: ${allowedCommands.join(', ') || 'none specified'}
- Do NOT modify these paths: ${forbidPaths.join(', ') || 'none'}
- Working directory: ${workingDir}
- Repo root: ${repoRoot}
- After implementation, run the verification commands if they exist

## Verification Commands
${this.policy.worker?.lintCommand ? `- Lint: ${this.policy.worker.lintCommand}` : ''}
${this.policy.worker?.testCommand ? `- Test: ${this.policy.worker.testCommand}` : ''}
${this.policy.worker?.buildCommand ? `- Build: ${this.policy.worker.buildCommand}` : ''}

## Project Memory (from .patchwork)
${repoContext}

Please implement the changes now.`
  }

  private async runClaudeCode(prompt: string, timeoutMs: number): Promise<void> {
    this.log('Invoking Claude Code CLI...')

    const workingDir = this.getWorkingDir()

    // Write prompt to a temp file for Claude to read
    const promptPath = join(workingDir, '.patchwork-prompt.md')
    writeFileSync(promptPath, prompt)

    try {
      await this.runProcessStreaming({
        command: 'claude',
        args: ['--print', '--dangerously-skip-permissions', '-p', prompt],
        cwd: workingDir,
        timeoutMs,
        source: 'claude',
        env: {
          ...process.env,
          CLAUDE_CODE_ENTRYPOINT: 'cli'
        }
      })
    } finally {
      // Clean up prompt file
      try {
        const { unlinkSync } = require('fs')
        unlinkSync(promptPath)
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async runCodex(prompt: string, timeoutMs: number): Promise<void> {
    this.log('Invoking Codex CLI...')

    const workingDir = this.getWorkingDir()

    // Write prompt to a temp file
    const promptPath = join(workingDir, '.patchwork-prompt.md')
    writeFileSync(promptPath, prompt)

    try {
      await this.runProcessStreaming({
        command: 'codex',
        args: ['exec', '--full-auto', prompt],
        cwd: workingDir,
        timeoutMs,
        source: 'codex'
      })
    } finally {
      // Clean up prompt file
      try {
        const { unlinkSync } = require('fs')
        unlinkSync(promptPath)
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async checkCommand(cmd: string): Promise<boolean> {
    try {
      if (process.platform === 'win32') {
        await execFileAsync('where', [cmd])
      } else {
        await execFileAsync('which', [cmd])
      }
      return true
    } catch {
      return false
    }
  }

  private async runChecks(): Promise<boolean> {
    const lintCmd = this.policy.worker?.lintCommand
    const testCmd = this.policy.worker?.testCommand
    const buildCmd = this.policy.worker?.buildCommand

    try {
      if (lintCmd) {
        this.log(`Running lint: ${lintCmd}`)
        await this.runCommand(lintCmd)
      }

      if (testCmd) {
        this.log(`Running tests: ${testCmd}`)
        await this.runCommand(testCmd)
      }

      if (buildCmd) {
        this.log(`Running build: ${buildCmd}`)
        await this.runCommand(buildCmd)
      }

      return true
    } catch (error) {
      this.log(`Check failed: ${error}`)
      return false
    }
  }

  private async runCommand(cmd: string): Promise<void> {
    const [command, ...args] = cmd.split(' ')
    await this.runProcessStreaming({
      command,
      args,
      cwd: this.getWorkingDir(),
      timeoutMs: 5 * 60 * 1000,
      source: command
    })
  }

  private async commitAndPush(branchName: string): Promise<void> {
    const commitMsg =
      this.policy.worker?.commitMessage
        ?.replace('{issue}', this.card?.remote_number_or_iid || '')
        .replace('{title}', this.card?.title || '') ||
      `#${this.card?.remote_number_or_iid} ${this.card?.title}`

    const workingDir = this.getWorkingDir()

    try {
      // Add all changes
      await execFileAsync('git', ['add', '-A'], {
        cwd: workingDir,
        env: this.gitEnv()
      })

      // Check if there are changes
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: workingDir,
        env: this.gitEnv()
      })

      if (stdout.trim()) {
        // Commit
        await execFileAsync('git', ['commit', '-m', commitMsg], {
          cwd: workingDir,
          env: this.gitEnv()
        })
      }

      // If the branch already exists upstream, rebase onto the latest remote before pushing to avoid non-fast-forward.
      try {
        await this.updateBranchFromOrigin(branchName)
      } catch {
        // If we can't update cleanly, let push surface the issue with a clear error.
      }

      // Push
      await execFileAsync('git', ['push', '-u', 'origin', branchName], {
        cwd: workingDir,
        env: this.gitEnv()
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (
        message.includes('could not read Username') ||
        message.includes('Authentication failed')
      ) {
        this.log(
          'Git push failed: missing credentials. Configure a credential helper or ensure the remote URL includes an auth token.'
        )
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

    const linkedType = this.adapter instanceof GithubAdapter ? 'pr' : 'mr'
    const existingLink = listCardLinks(this.cardId).find((link) => link.linked_type === linkedType)
    if (existingLink?.linked_url) {
      const url = existingLink.linked_url
      const numberMatch =
        linkedType === 'pr'
          ? url.match(/\/pull\/(\d+)/)
          : url.match(/\/merge_requests\/(\d+)/)
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

    if (this.adapter instanceof GithubAdapter) {
      const result = await this.adapter.createPR(title, body, branchName)
      return result ? { ...result, existing: false } : null
    } else if (this.adapter instanceof GitlabAdapter) {
      const result = await this.adapter.createMR(title, body, branchName)
      return result ? { number: result.iid, url: result.url, existing: false } : null
    }

    return null
  }

  private async moveToInReview(prUrl: string, created = true): Promise<void> {
    updateCardStatus(this.cardId, 'in_review')

    // Create card link
    const linkedType = this.adapter instanceof GithubAdapter ? 'pr' : 'mr'
    ensureCardLink(this.cardId, linkedType, prUrl)

    createEvent(this.projectId, 'pr_created', this.cardId, {
      prUrl,
      status: 'in_review',
      existing: !created
    })

    // Update remote labels
    if (this.adapter && this.card?.remote_number_or_iid) {
      const issueNumber = parseInt(this.card.remote_number_or_iid, 10)
      const newLabel = this.adapter.getStatusLabel('in_review')
      const allLabels = this.adapter.getAllStatusLabels()
      await this.adapter.updateLabels(
        issueNumber,
        [newLabel],
        allLabels.filter((l) => l !== newLabel)
      )

      // Comment on issue with PR link
      if (created) {
        await this.adapter.commentOnIssue(
          issueNumber,
          `PR created: ${prUrl}\n\n_Automated by Patchwork_`
        )
      }
    }
  }

  /**
   * Run task decomposition to break complex tasks into subtasks.
   * This phase checks if the task should be decomposed and creates subtasks
   * either locally or as remote issues (GitHub/GitLab).
   */
  private async runDecomposition(): Promise<void> {
    if (!this.taskDecomposer || !this.card) return

    // Check if we already have subtasks
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

      // Create subtasks in DB and optionally as remote issues
      const result = await this.taskDecomposer.createSubtasks(this.card, analysis.subtasks)
      this.subtasks = result.subtasks

      // Log decomposition event
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
      // Non-fatal - continue with the main task
    }
  }

  /**
   * Run AI implementation in iterative mode.
   * Each iteration works on a portion of the task, commits progress,
   * and continues until the task is complete or max iterations reached.
   */
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

      // Build iteration-specific prompt
      const iterationPrompt = await this.buildIterationPrompt(
        plan,
        i,
        maxIterations,
        contextSummary
      )

      this.log(`Running iteration ${i}/${maxIterations}`)

      try {
        // Run AI for this iteration
        const success = await this.runAI(iterationPrompt)

        if (!success) {
          this.log(`Iteration ${i} failed`)
          allSuccess = false
          // Update progress but don't break - let the partial work be saved
        }

        // Checkpoint progress if enabled
        if (progressCheckpoint) {
          await this.checkpointProgress(i, contextCarryover)
        }

        // Check if we've completed all subtasks or the main task
        if (await this.isIterationComplete()) {
          this.log(`Task completed after iteration ${i}`)
          break
        }

        // Update context summary for next iteration
        if (contextCarryover !== 'none') {
          contextSummary = await this.generateContextSummary(contextCarryover)
        }

        // Update progress in DB
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

  /**
   * Build a prompt for a specific iteration of the iterative AI mode.
   */
  private async buildIterationPrompt(
    plan: string,
    iteration: number,
    maxIterations: number,
    contextSummary: string
  ): Promise<string> {
    const basePrompt = await this.buildAIPrompt(plan)

    // Add iteration context
    let iterationContext = `\n\n## Iteration Context
This is iteration ${iteration} of ${maxIterations}.
`

    // Add previous context if available
    if (contextSummary) {
      iterationContext += `\n### Previous Progress
${contextSummary}

Continue from where you left off. Focus on the next logical step.
`
    }

    // Add subtask focus if we have subtasks
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

    return basePrompt + iterationContext
  }

  /**
   * Checkpoint progress between iterations.
   * Creates a WIP commit with current changes.
   */
  private async checkpointProgress(
    iteration: number,
    contextCarryover: 'full' | 'summary' | 'none'
  ): Promise<void> {
    const workingDir = this.getWorkingDir()

    try {
      // Check if there are changes to commit
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: workingDir
      })

      if (!stdout.trim()) {
        this.log(`Iteration ${iteration}: No changes to checkpoint`)
        return
      }

      // Stage and commit changes
      await execFileAsync('git', ['add', '-A'], {
        cwd: workingDir,
        env: this.gitEnv()
      })

      const commitMsg = `[WIP] Iteration ${iteration}: Progress checkpoint

Automated checkpoint by Patchwork worker.
Card: #${this.card?.remote_number_or_iid} ${this.card?.title}`

      await execFileAsync('git', ['commit', '-m', commitMsg], {
        cwd: workingDir,
        env: this.gitEnv()
      })

      this.log(`Iteration ${iteration}: Progress checkpointed`)

      // Update subtask status if we completed one
      await this.updateSubtaskProgress()

      // Track modified files
      if (this.progress && contextCarryover !== 'none') {
        const modifiedFiles = await this.getModifiedFilesSinceBase()
        updateWorkerProgress(this.progress.id, {
          iteration,
          filesModified: modifiedFiles
        })
      }
    } catch (error) {
      this.log(`Checkpoint warning: ${error instanceof Error ? error.message : String(error)}`)
      // Non-fatal - continue
    }
  }

  /**
   * Check if the current iteration has completed the task.
   */
  private async isIterationComplete(): Promise<boolean> {
    // If we have subtasks, check if all are completed
    if (this.subtasks.length > 0) {
      const allCompleted = this.subtasks.every((s) => s.status === 'completed')
      if (allCompleted) return true
    }

    // Check for completion markers in the codebase
    // This is a simple heuristic - could be enhanced
    return false
  }

  /**
   * Generate a context summary for the next iteration.
   */
  private async generateContextSummary(mode: 'full' | 'summary' | 'none'): Promise<string> {
    if (mode === 'none') return ''

    const workingDir = this.getWorkingDir()

    try {
      // Get the diff of changes made
      const { stdout: diffStat } = await execFileAsync(
        'git',
        ['diff', '--stat', this.baseHeadSha ?? 'HEAD~1'],
        { cwd: workingDir }
      )

      // Get list of modified files
      const { stdout: modifiedFiles } = await execFileAsync(
        'git',
        ['diff', '--name-only', this.baseHeadSha ?? 'HEAD~1'],
        { cwd: workingDir }
      )

      let summary = `Files modified:\n${modifiedFiles.trim()}\n\nChange summary:\n${diffStat.trim()}`

      // For summary mode, keep it brief
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

  /**
   * Update subtask status based on completed work.
   */
  private async updateSubtaskProgress(): Promise<void> {
    if (this.subtasks.length === 0) return

    // Find the current in-progress subtask
    const inProgress = this.subtasks.find((s) => s.status === 'in_progress')
    if (inProgress) {
      // Mark as completed
      updateSubtaskStatus(inProgress.id, 'completed')
      // Refresh local cache
      const updated = this.taskDecomposer?.getExistingSubtasks(this.cardId)
      if (updated) this.subtasks = updated
    }

    // Start the next pending subtask
    const nextPending = getNextPendingSubtask(this.cardId)
    if (nextPending) {
      updateSubtaskStatus(nextPending.id, 'in_progress')
      const updated = this.taskDecomposer?.getExistingSubtasks(this.cardId)
      if (updated) this.subtasks = updated
    }

    // Update progress
    if (this.progress) {
      const completed = this.subtasks.filter((s) => s.status === 'completed').length
      updateWorkerProgress(this.progress.id, {
        subtasksCompleted: completed,
        subtaskIndex: this.subtasks.findIndex((s) => s.status === 'in_progress')
      })
    }
  }

  /**
   * Get list of files modified since the base commit.
   */
  private async getModifiedFilesSinceBase(): Promise<string[]> {
    const workingDir = this.getWorkingDir()

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--name-only', this.baseHeadSha ?? 'HEAD~1'],
        { cwd: workingDir }
      )

      return stdout
        .trim()
        .split('\n')
        .filter((f) => f.trim())
    } catch {
      return []
    }
  }
}

export async function runWorker(jobId: string): Promise<WorkerResult> {
  const job = getJob(jobId)
  if (!job) {
    return { success: false, phase: 'init', error: 'Job not found' }
  }

  if (!job.card_id) {
    return { success: false, phase: 'init', error: 'No card specified' }
  }

  // Acquire lease
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
  } else if (result.success) {
    updateJobState(jobId, 'succeeded', result)
  } else {
    updateJobState(jobId, 'failed', result, result.error)
  }
  broadcastToRenderers('stateUpdated')

  return result
}
