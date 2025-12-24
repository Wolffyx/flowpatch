import { spawn } from 'child_process'
import type { Card, PolicyConfig, Subtask } from '../../shared/types'
import { createSubtask, listSubtasks } from '../db'
import { GithubAdapter } from '../adapters/github'
import { GitlabAdapter } from '../adapters/gitlab'
import { logAction } from '../../shared/utils'

export interface DecompositionResult {
  shouldDecompose: boolean
  subtasks: Array<{
    title: string
    description: string
    estimatedMinutes: number
  }>
  reasoning?: string
}

export interface SubtaskCreationResult {
  subtasks: Subtask[]
  remoteIssuesCreated: number
}

/**
 * TaskDecomposer analyzes complex tasks and breaks them into subtasks.
 * Uses Claude to intelligently analyze task complexity and create a breakdown.
 */
export class TaskDecomposer {
  private policy: PolicyConfig
  private adapter: GithubAdapter | GitlabAdapter | null

  constructor(policy: PolicyConfig, adapter: GithubAdapter | GitlabAdapter | null) {
    this.policy = policy
    this.adapter = adapter
  }

  /**
   * Check if a card already has subtasks.
   */
  hasExistingSubtasks(cardId: string): boolean {
    const existing = listSubtasks(cardId)
    return existing.length > 0
  }

  /**
   * Get existing subtasks for a card.
   */
  getExistingSubtasks(cardId: string): Subtask[] {
    return listSubtasks(cardId)
  }

  /**
   * Analyze a card and determine if it should be decomposed into subtasks.
   * Uses Claude to analyze complexity and generate subtask breakdown.
   */
  async analyzeCard(card: Card, workingDir: string): Promise<DecompositionResult> {
    const decompositionConfig = this.policy.worker?.decomposition
    if (!decompositionConfig?.enabled) {
      return { shouldDecompose: false, subtasks: [] }
    }

    const threshold = decompositionConfig.threshold
    if (threshold === 'never') {
      return { shouldDecompose: false, subtasks: [] }
    }

    // For 'always' threshold, skip analysis and always decompose
    if (threshold === 'always') {
      return this.forceDecompose(card, workingDir, decompositionConfig.maxSubtasks)
    }

    // For 'auto' threshold, use AI to analyze
    try {
      const prompt = this.buildAnalysisPrompt(card, decompositionConfig.maxSubtasks)
      const result = await this.runClaudeAnalysis(prompt, workingDir)
      return this.parseAnalysisResult(result, decompositionConfig.maxSubtasks)
    } catch (error) {
      logAction('taskDecomposer:analysisError', {
        cardId: card.id,
        error: error instanceof Error ? error.message : String(error)
      })
      return { shouldDecompose: false, subtasks: [] }
    }
  }

  /**
   * Force decomposition without AI analysis.
   * Used when threshold is 'always'.
   */
  private async forceDecompose(
    card: Card,
    workingDir: string,
    maxSubtasks: number
  ): Promise<DecompositionResult> {
    const prompt = this.buildDecompositionPrompt(card, maxSubtasks)
    try {
      const result = await this.runClaudeAnalysis(prompt, workingDir)
      const parsed = this.parseAnalysisResult(result, maxSubtasks)
      // Force shouldDecompose to true since threshold is 'always'
      return { ...parsed, shouldDecompose: true }
    } catch (error) {
      logAction('taskDecomposer:forceDecomposeError', {
        cardId: card.id,
        error: error instanceof Error ? error.message : String(error)
      })
      return { shouldDecompose: false, subtasks: [] }
    }
  }

  private buildAnalysisPrompt(card: Card, maxSubtasks: number): string {
    return `Analyze this task and determine if it should be broken into subtasks.

## Task
Title: ${card.title}
Description: ${card.body || 'No description provided'}

## Analysis Criteria
A task should be decomposed if:
- It involves multiple distinct features or components
- It would take more than 2 hours to implement
- It touches multiple files or systems
- It has clearly separable steps

A task should NOT be decomposed if:
- It's a simple bug fix
- It's a small feature addition
- It can be completed in under 30 minutes
- It's already very specific

## Output Format (JSON only, no other text)
{
  "shouldDecompose": boolean,
  "reasoning": "Brief explanation of your decision",
  "subtasks": [
    {
      "title": "Concise subtask title",
      "description": "What needs to be done",
      "estimatedMinutes": number
    }
  ]
}

If shouldDecompose is false, subtasks should be an empty array.
Maximum ${maxSubtasks} subtasks allowed.

Respond with only the JSON, no markdown code blocks or other text.`
  }

  private buildDecompositionPrompt(card: Card, maxSubtasks: number): string {
    return `Break down this task into ${maxSubtasks} or fewer subtasks.

## Task
Title: ${card.title}
Description: ${card.body || 'No description provided'}

## Output Format (JSON only, no other text)
{
  "shouldDecompose": true,
  "reasoning": "Brief explanation of the breakdown",
  "subtasks": [
    {
      "title": "Concise subtask title",
      "description": "What needs to be done",
      "estimatedMinutes": number
    }
  ]
}

Create logical, sequential subtasks. Each subtask should be completable independently.
Maximum ${maxSubtasks} subtasks.

Respond with only the JSON, no markdown code blocks or other text.`
  }

  private async runClaudeAnalysis(prompt: string, workingDir: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['--print', '-p', prompt], {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CLAUDE_CODE_ENTRYPOINT: 'cli'
        }
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })
      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      const timeout = setTimeout(
        () => {
          child.kill('SIGTERM')
          reject(new Error('Task analysis timed out after 2 minutes'))
        },
        2 * 60 * 1000
      )

      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code !== 0) {
          reject(new Error(`Claude analysis failed with code ${code}: ${stderr}`))
        } else {
          resolve(stdout)
        }
      })

      child.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  private parseAnalysisResult(output: string, maxSubtasks: number): DecompositionResult {
    try {
      // Try to extract JSON from response
      // Handle cases where response might have markdown code blocks
      let jsonStr = output.trim()

      // Remove markdown code blocks if present
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim()
      }

      // Try to find JSON object
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/)
      if (!objectMatch) {
        logAction('taskDecomposer:noJsonFound', { output: output.slice(0, 200) })
        return { shouldDecompose: false, subtasks: [] }
      }

      const parsed = JSON.parse(objectMatch[0])

      // Validate and sanitize
      const shouldDecompose = parsed.shouldDecompose === true
      const subtasks = Array.isArray(parsed.subtasks)
        ? parsed.subtasks.slice(0, maxSubtasks).map((s: any) => ({
            title: String(s.title || '').slice(0, 200),
            description: String(s.description || '').slice(0, 1000),
            estimatedMinutes: Number(s.estimatedMinutes) || 30
          }))
        : []

      return {
        shouldDecompose,
        subtasks,
        reasoning: String(parsed.reasoning || '')
      }
    } catch (error) {
      logAction('taskDecomposer:parseError', {
        error: error instanceof Error ? error.message : String(error),
        output: output.slice(0, 200)
      })
      return { shouldDecompose: false, subtasks: [] }
    }
  }

  /**
   * Create subtasks in the database and optionally as remote issues.
   */
  async createSubtasks(
    card: Card,
    subtasks: DecompositionResult['subtasks']
  ): Promise<SubtaskCreationResult> {
    const config = this.policy.worker?.decomposition
    const createdSubtasks: Subtask[] = []
    let remoteIssuesCreated = 0

    for (let i = 0; i < subtasks.length; i++) {
      const subtaskData = subtasks[i]

      let remoteIssueNumber: string | undefined

      // Optionally create as GitHub/GitLab sub-issue
      if (config?.createSubIssues && this.adapter) {
        try {
          const issueResult = await this.createRemoteSubIssue(card, subtaskData, i + 1)
          if (issueResult) {
            remoteIssueNumber = issueResult.number.toString()
            remoteIssuesCreated++
          }
        } catch (error) {
          logAction('taskDecomposer:remoteIssueError', {
            cardId: card.id,
            subtaskIndex: i,
            error: error instanceof Error ? error.message : String(error)
          })
          // Continue creating local subtask even if remote fails
        }
      }

      const created = createSubtask({
        parentCardId: card.id,
        projectId: card.project_id,
        title: subtaskData.title,
        description: subtaskData.description,
        estimatedMinutes: subtaskData.estimatedMinutes,
        sequence: i,
        remoteIssueNumber
      })

      createdSubtasks.push(created)
    }

    logAction('taskDecomposer:subtasksCreated', {
      cardId: card.id,
      count: createdSubtasks.length,
      remoteIssuesCreated
    })

    return {
      subtasks: createdSubtasks,
      remoteIssuesCreated
    }
  }

  private async createRemoteSubIssue(
    parentCard: Card,
    subtask: { title: string; description: string },
    sequenceNum: number
  ): Promise<{ number: number; url: string } | null> {
    const title = `[${parentCard.remote_number_or_iid}/${sequenceNum}] ${subtask.title}`
    const body = `## Parent Issue
#${parentCard.remote_number_or_iid}: ${parentCard.title}

## Description
${subtask.description}

---
_Auto-generated subtask from Patchwork_`

    if (this.adapter instanceof GithubAdapter) {
      const result = await this.adapter.createIssue(title, body, ['subtask'])
      if (result) {
        return { number: result.number, url: result.url }
      }
      return null
    } else if (this.adapter instanceof GitlabAdapter) {
      // GitLab support would need createIssue method
      // For now, return null
      return null
    }

    return null
  }
}
