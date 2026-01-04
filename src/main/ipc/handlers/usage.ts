/**
 * IPC handlers for usage tracking operations.
 * Handles: getUsageSummary, getUsageWithLimits, getTotalUsage, setToolLimits
 */

import { ipcMain } from 'electron'
import {
  getTotalUsage,
  getUsageSummary,
  getUsageWithLimits,
  getToolLimits,
  setToolLimits,
  createUsageRecord,
  getResetTimes
} from '../../db'
import type { AIToolType } from '@shared/types'
import { logAction } from '@shared/utils'

// ============================================================================
// Handler Registration
// ============================================================================

export function registerUsageHandlers(notifyRenderer: () => void): void {
  // Get total usage (for header display)
  ipcMain.handle('usage:getTotal', () => {
    logAction('usage:getTotal')
    const usage = getTotalUsage()
    return { usage }
  })

  // Get usage summary for a time period
  ipcMain.handle(
    'usage:getSummary',
    (_e, payload: { projectId?: string; startDate: string; endDate: string }) => {
      logAction('usage:getSummary', payload)
      const summary = getUsageSummary(
        payload.projectId ?? null,
        payload.startDate,
        payload.endDate
      )
      return { summary }
    }
  )

  // Get usage with limits for all tools (for dropdown display)
  ipcMain.handle('usage:getWithLimits', () => {
    logAction('usage:getWithLimits')
    const usageWithLimits = getUsageWithLimits()
    const resetTimes = getResetTimes()
    return { usageWithLimits, resetTimes }
  })

  // Get limits for a specific tool
  ipcMain.handle('usage:getToolLimits', (_e, payload: { toolType: AIToolType }) => {
    logAction('usage:getToolLimits', payload)
    const limits = getToolLimits(payload.toolType)
    return { limits }
  })

  // Set limits for a tool
  ipcMain.handle(
    'usage:setToolLimits',
    (
      _e,
      payload: {
        toolType: AIToolType
        hourlyTokenLimit?: number | null
        dailyTokenLimit?: number | null
        monthlyTokenLimit?: number | null
        hourlyCostLimitUsd?: number | null
        dailyCostLimitUsd?: number | null
        monthlyCostLimitUsd?: number | null
      }
    ) => {
      logAction('usage:setToolLimits', payload)

      const limits = setToolLimits(payload.toolType, {
        hourly_token_limit: payload.hourlyTokenLimit,
        daily_token_limit: payload.dailyTokenLimit,
        monthly_token_limit: payload.monthlyTokenLimit,
        hourly_cost_limit_usd: payload.hourlyCostLimitUsd,
        daily_cost_limit_usd: payload.dailyCostLimitUsd,
        monthly_cost_limit_usd: payload.monthlyCostLimitUsd
      })

      notifyRenderer()
      return { success: true, limits }
    }
  )

  // Record usage (called from worker pipeline)
  ipcMain.handle(
    'usage:recordUsage',
    (
      _e,
      payload: {
        projectId: string
        jobId?: string
        cardId?: string
        toolType: AIToolType
        inputTokens: number
        outputTokens: number
        totalTokens: number
        costUsd?: number
        durationMs: number
        model?: string
      }
    ) => {
      logAction('usage:recordUsage', payload)

      const record = createUsageRecord({
        projectId: payload.projectId,
        jobId: payload.jobId,
        cardId: payload.cardId,
        toolType: payload.toolType,
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
        totalTokens: payload.totalTokens,
        costUsd: payload.costUsd,
        durationMs: payload.durationMs,
        model: payload.model
      })

      notifyRenderer()
      return { success: true, record }
    }
  )
}
