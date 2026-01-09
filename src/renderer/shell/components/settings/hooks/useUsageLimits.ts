/**
 * Usage Limits Hook
 *
 * Manages usage and spending limits for AI tools
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { ToolLimitsState } from '../types'
import { DEFAULT_TOOL_LIMITS } from '../constants'

interface UseUsageLimitsReturn {
  claudeLimits: ToolLimitsState
  codexLimits: ToolLimitsState
  limitsLoading: boolean
  savingLimits: boolean
  setClaudeLimits: React.Dispatch<React.SetStateAction<ToolLimitsState>>
  setCodexLimits: React.Dispatch<React.SetStateAction<ToolLimitsState>>
  loadUsageLimits: () => Promise<void>
  saveToolLimits: (toolType: 'claude' | 'codex', limits: ToolLimitsState) => Promise<void>
}

export function useUsageLimits(): UseUsageLimitsReturn {
  const [claudeLimits, setClaudeLimits] = useState<ToolLimitsState>(DEFAULT_TOOL_LIMITS)
  const [codexLimits, setCodexLimits] = useState<ToolLimitsState>(DEFAULT_TOOL_LIMITS)
  const [limitsLoading, setLimitsLoading] = useState(false)
  const [savingLimits, setSavingLimits] = useState(false)

  const loadUsageLimits = useCallback(async () => {
    setLimitsLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('usage:getWithLimits')
      const usageData = result.usageWithLimits

      // Find claude and codex limits
      const claudeData = usageData.find((t: { tool_type: string }) => t.tool_type === 'claude')
      const codexData = usageData.find((t: { tool_type: string }) => t.tool_type === 'codex')

      if (claudeData?.limits) {
        setClaudeLimits({
          hourlyTokenLimit: claudeData.limits.hourly_token_limit?.toString() || '',
          dailyTokenLimit: claudeData.limits.daily_token_limit?.toString() || '',
          monthlyTokenLimit: claudeData.limits.monthly_token_limit?.toString() || '',
          hourlyCostLimit: claudeData.limits.hourly_cost_limit_usd?.toString() || '',
          dailyCostLimit: claudeData.limits.daily_cost_limit_usd?.toString() || '',
          monthlyCostLimit: claudeData.limits.monthly_cost_limit_usd?.toString() || ''
        })
      }
      if (codexData?.limits) {
        setCodexLimits({
          hourlyTokenLimit: codexData.limits.hourly_token_limit?.toString() || '',
          dailyTokenLimit: codexData.limits.daily_token_limit?.toString() || '',
          monthlyTokenLimit: codexData.limits.monthly_token_limit?.toString() || '',
          hourlyCostLimit: codexData.limits.hourly_cost_limit_usd?.toString() || '',
          dailyCostLimit: codexData.limits.daily_cost_limit_usd?.toString() || '',
          monthlyCostLimit: codexData.limits.monthly_cost_limit_usd?.toString() || ''
        })
      }
    } catch (err) {
      console.error('Failed to load usage limits:', err)
    } finally {
      setLimitsLoading(false)
    }
  }, [])

  const saveToolLimits = useCallback(
    async (toolType: 'claude' | 'codex', limits: ToolLimitsState) => {
      setSavingLimits(true)
      try {
        await window.electron.ipcRenderer.invoke('usage:setToolLimits', {
          toolType,
          hourlyTokenLimit: limits.hourlyTokenLimit ? parseInt(limits.hourlyTokenLimit, 10) : null,
          dailyTokenLimit: limits.dailyTokenLimit ? parseInt(limits.dailyTokenLimit, 10) : null,
          monthlyTokenLimit: limits.monthlyTokenLimit
            ? parseInt(limits.monthlyTokenLimit, 10)
            : null,
          hourlyCostLimitUsd: limits.hourlyCostLimit ? parseFloat(limits.hourlyCostLimit) : null,
          dailyCostLimitUsd: limits.dailyCostLimit ? parseFloat(limits.dailyCostLimit) : null,
          monthlyCostLimitUsd: limits.monthlyCostLimit ? parseFloat(limits.monthlyCostLimit) : null
        })
        toast.success(`${toolType === 'claude' ? 'Claude' : 'Codex'} limits saved`)
      } catch (err) {
        toast.error(`Failed to save ${toolType} limits`)
        console.error(err)
      } finally {
        setSavingLimits(false)
      }
    },
    []
  )

  return {
    claudeLimits,
    codexLimits,
    limitsLoading,
    savingLimits,
    setClaudeLimits,
    setCodexLimits,
    loadUsageLimits,
    saveToolLimits
  }
}
