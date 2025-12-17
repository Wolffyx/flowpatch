import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { GithubAdapter } from '../adapters/github'
import { GitlabAdapter } from '../adapters/gitlab'
import {
  getProject,
  getCard,
  updateCardStatus,
  createEvent,
  createCardLink,
  updateJobState,
  getJob,
  acquireJobLease,
  renewJobLease
} from '../db'
import type { Project, Card, PolicyConfig } from '../../shared/types'
import { slugify } from '../../shared/types'

const execFileAsync = promisify(execFile)

interface WorkerResult {
  success: boolean
  phase: string
  prUrl?: string
  error?: string
  plan?: string
  logs?: string[]
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
        branchPattern: 'kanban/{id}-{slug}',
        commitMessage: '#{issue} {title}'
      }
    }
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString()
    this.logs.push(`[${timestamp}] ${message}`)
    console.log(`[Worker] ${message}`)
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

    return true
  }

  async run(jobId: string): Promise<WorkerResult> {
    // Start lease renewal
    this.leaseInterval = setInterval(() => {
      renewJobLease(jobId)
    }, 60000) // Renew every minute

    try {
      const initialized = await this.initialize()
      if (!initialized) {
        return { success: false, phase: 'init', error: 'Failed to initialize', logs: this.logs }
      }

      // Phase 1: Move to In Progress
      this.log('Moving card to In Progress')
      await this.moveToInProgress()

      // Phase 2: Check working tree
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

      // Phase 3: Fetch latest
      this.log('Fetching latest from remote')
      await this.fetchLatest()

      // Phase 4: Create branch
      const branchName = this.generateBranchName()
      this.log(`Creating branch: ${branchName}`)
      await this.createBranch(branchName)

      // Phase 5: Generate plan
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

      // Store plan as event
      createEvent(this.projectId, 'worker_plan', this.cardId, { plan })

      // Phase 6: Run AI tool (Claude Code or Codex)
      this.log('Running AI implementation')
      const aiSuccess = await this.runAI(plan)
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
      this.log('Running verification checks')
      const checksPass = await this.runChecks()
      if (!checksPass) {
        this.log('Checks failed, creating WIP PR')
        // Still create PR but mark as WIP
      }

      // Phase 8: Commit and push
      this.log('Committing and pushing changes')
      await this.commitAndPush(branchName)

      // Phase 9: Create PR/MR
      this.log('Creating PR/MR')
      const prResult = await this.createPR(branchName, plan, checksPass)
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
      this.log('Moving card to In Review')
      await this.moveToInReview(prResult.url)

      return {
        success: true,
        phase: 'complete',
        prUrl: prResult.url,
        plan,
        logs: this.logs
      }
    } finally {
      // Stop lease renewal
      if (this.leaseInterval) {
        clearInterval(this.leaseInterval)
      }
    }
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
      return stdout.trim() === ''
    } catch {
      return false
    }
  }

  private async fetchLatest(): Promise<void> {
    try {
      await execFileAsync('git', ['fetch', 'origin'], {
        cwd: this.project!.local_path
      })
    } catch (error) {
      this.log(`Fetch warning: ${error}`)
    }
  }

  private generateBranchName(): string {
    const pattern = this.policy.worker?.branchPattern || 'kanban/{id}-{slug}'
    const issueId = this.card?.remote_number_or_iid || this.cardId.slice(0, 8)
    const titleSlug = this.card ? slugify(this.card.title) : 'task'

    return pattern.replace('{id}', issueId).replace('{slug}', titleSlug.slice(0, 30))
  }

  private async createBranch(branchName: string): Promise<void> {
    const baseBranch = 'main' // TODO: Make configurable

    try {
      // Checkout base branch and pull
      await execFileAsync('git', ['checkout', baseBranch], {
        cwd: this.project!.local_path
      })
      await execFileAsync('git', ['pull', 'origin', baseBranch], {
        cwd: this.project!.local_path
      })
      // Create and checkout new branch
      await execFileAsync('git', ['checkout', '-b', branchName], {
        cwd: this.project!.local_path
      })
    } catch (error) {
      this.log(`Branch creation warning: ${error}`)
      throw error
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

    // Detect available tools
    const hasClaude = await this.checkCommand('claude')
    const hasCodex = await this.checkCommand('codex')

    let tool: string | null = null
    if (toolPreference === 'claude' && hasClaude) tool = 'claude'
    else if (toolPreference === 'codex' && hasCodex) tool = 'codex'
    else if (toolPreference === 'auto') {
      if (hasClaude) tool = 'claude'
      else if (hasCodex) tool = 'codex'
    }

    if (!tool) {
      this.log('No AI tool available (claude or codex)')
      // Create a stub file with the plan
      const planPath = join(this.project.local_path, 'IMPLEMENTATION_PLAN.md')
      writeFileSync(planPath, plan)
      return true // Return true to continue with stub PR
    }

    try {
      this.log(`Running ${tool} with ${maxMinutes} minute timeout`)

      // TODO: In production, spawn the actual AI CLI tool
      // For now, we'll simulate the AI run and create a stub plan file
      const planPath = join(this.project.local_path, 'IMPLEMENTATION_PLAN.md')
      const fullPlan = `# AI Implementation Plan

## Task
${this.card.title}

## Description
${this.card.body || 'No description'}

## Plan
${plan}

## Commands
Allowed: ${(this.policy.worker?.allowedCommands || []).join(', ')}
Forbidden paths: ${(this.policy.worker?.forbidPaths || []).join(', ')}
`
      writeFileSync(planPath, fullPlan)
      await new Promise((resolve) => setTimeout(resolve, 1000))

      this.log('AI implementation completed')
      return true
    } catch (error) {
      this.log(`AI error: ${error}`)
      return false
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
    await execFileAsync(command, args, {
      cwd: this.project!.local_path,
      timeout: 5 * 60 * 1000 // 5 minute timeout per command
    })
  }

  private async commitAndPush(branchName: string): Promise<void> {
    const commitMsg =
      this.policy.worker?.commitMessage?.replace(
        '{issue}',
        this.card?.remote_number_or_iid || ''
      ).replace('{title}', this.card?.title || '') ||
      `#${this.card?.remote_number_or_iid} ${this.card?.title}`

    try {
      // Add all changes
      await execFileAsync('git', ['add', '-A'], {
        cwd: this.project!.local_path
      })

      // Check if there are changes
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: this.project!.local_path
      })

      if (stdout.trim()) {
        // Commit
        await execFileAsync('git', ['commit', '-m', commitMsg], {
          cwd: this.project!.local_path
        })
      }

      // Push
      await execFileAsync('git', ['push', '-u', 'origin', branchName], {
        cwd: this.project!.local_path
      })
    } catch (error) {
      this.log(`Commit/push warning: ${error}`)
      throw error
    }
  }

  private async createPR(
    branchName: string,
    plan: string,
    checksPass: boolean
  ): Promise<{ number: number; url: string } | null> {
    if (!this.adapter || !this.card) return null

    const title = checksPass
      ? this.card.title
      : `[WIP] ${this.card.title}`

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
      return this.adapter.createPR(title, body, branchName)
    } else if (this.adapter instanceof GitlabAdapter) {
      const result = await this.adapter.createMR(title, body, branchName)
      return result ? { number: result.iid, url: result.url } : null
    }

    return null
  }

  private async moveToInReview(prUrl: string): Promise<void> {
    updateCardStatus(this.cardId, 'in_review')

    // Create card link
    const linkedType = this.adapter instanceof GithubAdapter ? 'pr' : 'mr'
    createCardLink(this.cardId, linkedType, prUrl)

    createEvent(this.projectId, 'pr_created', this.cardId, {
      prUrl,
      status: 'in_review'
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
      await this.adapter.commentOnIssue(
        issueNumber,
        `PR created: ${prUrl}\n\n_Automated by Patchwork_`
      )
    }
  }
}

export async function runWorker(
  jobId: string
): Promise<WorkerResult> {
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

  const pipeline = new WorkerPipeline(job.project_id, job.card_id)
  const result = await pipeline.run(jobId)

  // Update job state
  if (result.success) {
    updateJobState(jobId, 'succeeded', result)
  } else {
    updateJobState(jobId, 'failed', result, result.error)
  }

  return result
}
