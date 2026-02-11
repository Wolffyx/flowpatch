/**
 * Usage Limits Hook
 *
 * Manages usage and spending limits for AI tools (claude, codex, opencode, cursor, other).
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { ToolLimitsState } from '../types'
import { DEFAULT_TOOL_LIMITS } from '../constants'
import type { AIToolType } from '@shared/types'

const TOOL_TYPES: AIToolType[] = ['claude', 'codex', 'opencode', 'cursor', 'other']

function limitsFromApi(limits?: {
  hourly_token_limit: number | null
  daily_token_limit: number | null
  monthly_token_limit: number | null
  hourly_cost_limit_usd: number | null
  daily_cost_limit_usd: number | null
  monthly_cost_limit_usd: number | null
}): ToolLimitsState {
  if (!limits) return DEFAULT_TOOL_LIMITS
  return {
    hourlyTokenLimit: limits.hourly_token_limit?.toString() ?? '',
    dailyTokenLimit: limits.daily_token_limit?.toString() ?? '',
    monthlyTokenLimit: limits.monthly_token_limit?.toString() ?? '',
    hourlyCostLimit: limits.hourly_cost_limit_usd?.toString() ?? '',
    dailyCostLimit: limits.daily_cost_limit_usd?.toString() ?? '',
    monthlyCostLimit: limits.monthly_cost_limit_usd?.toString() ?? ''
  }
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex (OpenAI)',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  other: 'Other'
}

interface UseUsageLimitsReturn {
  limitsByTool: Record<string, ToolLimitsState>
  limitsLoading: boolean
  savingLimits: boolean
  toolTypes: AIToolType[]
  getLimits: (toolType: string) => ToolLimitsState
  setLimits: (toolType: string, state: ToolLimitsState | React.SetStateAction<ToolLimitsState>) => void
  loadUsageLimits: () => Promise<void>
  saveToolLimits: (toolType: AIToolType, limits: ToolLimitsState) => Promise<void>
  getToolDisplayName: (toolType: string) => string
}

export function useUsageLimits(): UseUsageLimitsReturn {
  const [limitsByTool, setLimitsByTool] = useState<Record<string, ToolLimitsState>>(() => {
    const initial: Record<string, ToolLimitsState> = {}
    for (const t of TOOL_TYPES) {
      initial[t] = { ...DEFAULT_TOOL_LIMITS }
    }
    return initial
  })
  const [limitsLoading, setLimitsLoading] = useState(false)
  const [savingLimits, setSavingLimits] = useState(false)

  const loadUsageLimits = useCallback(async () => {
    setLimitsLoading(true)
    try {
      const result = (await window.electron.ipcRenderer.invoke('usage:getWithLimits')) as {
        usageWithLimits: {
          tool_type: string
          limits?: {
            hourly_token_limit: number | null
            daily_token_limit: number | null
            monthly_token_limit: number | null
            hourly_cost_limit_usd: number | null
            daily_cost_limit_usd: number | null
            monthly_cost_limit_usd: number | null
          }
        }[]
      }
      const usageData = result.usageWithLimits
      setLimitsByTool((prev) => {
        const next = { ...prev }
        for (const t of TOOL_TYPES) {
          const data = usageData.find((u: { tool_type: string }) => u.tool_type === t)
          next[t] = limitsFromApi(data?.limits)
        }
        return next
      })
    } catch (err) {
      console.error('Failed to load usage limits:', err)
    } finally {
      setLimitsLoading(false)
    }
  }, [])

  const getLimits = useCallback(
    (toolType: string) => limitsByTool[toolType] ?? DEFAULT_TOOL_LIMITS,
    [limitsByTool]
  )

  const setLimits = useCallback(
    (toolType: string, state: ToolLimitsState | React.SetStateAction<ToolLimitsState>) => {
      setLimitsByTool((prev) => ({
        ...prev,
        [toolType]: typeof state === 'function' ? state(prev[toolType] ?? DEFAULT_TOOL_LIMITS) : state
      }))
    },
    []
  )

  const saveToolLimits = useCallback(
    async (toolType: AIToolType, limits: ToolLimitsState) => {
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
        const name = TOOL_DISPLAY_NAMES[toolType] ?? toolType
        toast.success(`${name} limits saved`)
      } catch (err) {
        toast.error(`Failed to save ${toolType} limits`)
        console.error(err)
      } finally {
        setSavingLimits(false)
      }
    },
    []
  )

  const getToolDisplayName = useCallback((toolType: string) => TOOL_DISPLAY_NAMES[toolType] ?? toolType, [])

  return {
    limitsByTool,
    limitsLoading,
    savingLimits,
    toolTypes: TOOL_TYPES,
    getLimits,
    setLimits,
    loadUsageLimits,
    saveToolLimits,
    getToolDisplayName
  }
}
