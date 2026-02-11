/**
 * Decomposition Manager
 *
 * Orchestrates task decomposition for the worker pipeline.
 * Wraps TaskDecomposer service with pipeline-specific logic.
 */

import type { Card, PolicyConfig, Subtask } from '@shared/types'
import { TaskDecomposer } from '../../services/task-decomposer'
import { createEvent } from '../../db'
import type { IRepoAdapter } from '../../adapters'

export interface DecompositionManagerConfig {
  projectId: string
  cardId: string
  policy: PolicyConfig
  adapter: IRepoAdapter | null
}

export type LogFn = (message: string) => void

/**
 * Manages task decomposition orchestration for the pipeline.
 */
export class DecompositionManager {
  private projectId: string
  private cardId: string
  private policy: PolicyConfig
  private taskDecomposer: TaskDecomposer | null
  private subtasks: Subtask[] = []
  private log: LogFn
  
  constructor(config: DecompositionManagerConfig, log: LogFn) {
    this.projectId = config.projectId
    this.cardId = config.cardId
    this.policy = config.policy
    this.log = log
    
    // Initialize task decomposer if enabled in policy
    if (config.policy.worker?.decomposition?.enabled && config.adapter) {
      this.taskDecomposer = new TaskDecomposer(config.policy, config.adapter)
    } else {
      this.taskDecomposer = null
    }
  }
  
  // ==================== Public API ====================
  
  /**
   * Check if decomposition should run for this card.
   */
  shouldRunDecomposition(): boolean {
    if (!this.taskDecomposer) return false
    if (!this.policy.worker?.decomposition?.enabled) return false
    return true
  }
  
  /**
   * Run decomposition for the given card.
   * 
   * @param card - Card to decompose
   * @param workingDir - Working directory for analysis
   * @returns True if decomposition succeeded or was not needed
   */
  async runDecomposition(card: Card, workingDir: string): Promise<boolean> {
    if (!this.taskDecomposer || !card) {
      return true // Not an error, just not enabled
    }
    
    // Check for existing subtasks
    if (this.taskDecomposer.hasExistingSubtasks(this.cardId)) {
      this.subtasks = this.taskDecomposer.getExistingSubtasks(this.cardId)
      this.log(`Found ${this.subtasks.length} existing subtasks`)
      return true
    }
    
    this.log('Analyzing task for decomposition...')
    
    try {
      const analysis = await this.taskDecomposer.analyzeCard(card, workingDir)
      
      if (!analysis.shouldDecompose) {
        this.log('Task does not need decomposition')
        return true
      }
      
      this.log(`Decomposing into ${analysis.subtasks.length} subtasks`)
      if (analysis.reasoning) {
        this.log(`Reasoning: ${analysis.reasoning}`)
      }
      
      const result = await this.taskDecomposer.createSubtasks(card, analysis.subtasks)
      this.subtasks = result.subtasks
      
      // Create event for decomposition
      createEvent(this.projectId, 'task_decomposed', this.cardId, {
        subtaskCount: this.subtasks.length,
        remoteIssuesCreated: result.remoteIssuesCreated,
        reasoning: analysis.reasoning
      })
      
      this.log(
        `Created ${this.subtasks.length} subtasks (${result.remoteIssuesCreated} remote issues)`
      )
      
      return true
    } catch (error) {
      this.log(`Decomposition failed: ${error instanceof Error ? error.message : String(error)}`)
      // Don't fail the pipeline, just continue without decomposition
      return true
    }
  }
  
  /**
   * Get current subtasks.
   */
  getSubtasks(): Subtask[] {
    return this.subtasks
  }
  
  /**
   * Get the task decomposer instance (for context building).
   */
  getTaskDecomposer(): TaskDecomposer | null {
    return this.taskDecomposer
  }
}
