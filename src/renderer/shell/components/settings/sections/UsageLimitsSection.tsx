/**
 * Usage Limits Section
 *
 * Token and cost limits for AI tools (Claude, Codex, OpenCode, Cursor, Other).
 */

import { useEffect } from 'react'
import { Bot, Code, Loader2, Zap, Cpu, Activity } from 'lucide-react'
import { Button } from '../../../../src/components/ui/button'
import { Input } from '../../../../src/components/ui/input'
import { SettingsCard } from '../components/SettingsCard'
import { useUsageLimits } from '../hooks/useUsageLimits'
import { SUGGESTED_TOOL_LIMITS } from '../constants'

function getToolIcon(toolType: string) {
  switch (toolType) {
    case 'claude':
      return <Bot className="h-4 w-4 text-foreground/70" />
    case 'codex':
      return <Code className="h-4 w-4 text-foreground/70" />
    case 'opencode':
      return <Cpu className="h-4 w-4 text-foreground/70" />
    case 'cursor':
      return <Activity className="h-4 w-4 text-foreground/70" />
    default:
      return <Zap className="h-4 w-4 text-foreground/70" />
  }
}

export function UsageLimitsSection(): React.JSX.Element {
  const {
    limitsByTool,
    limitsLoading,
    savingLimits,
    toolTypes,
    getLimits,
    setLimits,
    loadUsageLimits,
    saveToolLimits,
    getToolDisplayName
  } = useUsageLimits()

  useEffect(() => {
    loadUsageLimits()
  }, [loadUsageLimits])

  const handlePreFillSuggested = () => {
    for (const toolType of toolTypes) {
      const current = getLimits(toolType)
      const hasAnyLimit =
        current.hourlyTokenLimit ||
        current.dailyTokenLimit ||
        current.monthlyTokenLimit ||
        current.hourlyCostLimit ||
        current.dailyCostLimit ||
        current.monthlyCostLimit
      if (!hasAnyLimit) {
        setLimits(toolType, {
          ...current,
          hourlyTokenLimit: SUGGESTED_TOOL_LIMITS.hourlyTokenLimit,
          dailyTokenLimit: SUGGESTED_TOOL_LIMITS.dailyTokenLimit,
          monthlyTokenLimit: SUGGESTED_TOOL_LIMITS.monthlyTokenLimit
        })
      }
    }
  }

  if (limitsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Usage & Spending Limits</h3>
        <p className="text-xs text-muted-foreground">
          Set hourly, daily and monthly limits for token usage and cost per AI tool. Leave empty for
          no limit. When limits are reached, the worker will try to fall back to another tool or
          pause.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Suggested for typical use: hourly 200k–500k tokens, daily 1M–2M, monthly 10M+ (adjust for
          your plan and iterations per card).
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 text-xs"
          onClick={handlePreFillSuggested}
        >
          Pre-fill suggested token limits (only where empty)
        </Button>
      </div>

      {toolTypes.map((toolType) => (
        <SettingsCard
          key={toolType}
          title={getToolDisplayName(toolType)}
          icon={getToolIcon(toolType)}
        >
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="space-y-2">
              <label className="text-xs font-medium">Hourly Token Limit</label>
              <Input
                type="number"
                placeholder="e.g., 300000"
                value={getLimits(toolType).hourlyTokenLimit}
                onChange={(e) =>
                  setLimits(toolType, (prev) => ({ ...prev, hourlyTokenLimit: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium">Daily Token Limit</label>
              <Input
                type="number"
                placeholder="e.g., 1500000"
                value={getLimits(toolType).dailyTokenLimit}
                onChange={(e) =>
                  setLimits(toolType, (prev) => ({ ...prev, dailyTokenLimit: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium">Monthly Token Limit</label>
              <Input
                type="number"
                placeholder="e.g., 10000000"
                value={getLimits(toolType).monthlyTokenLimit}
                onChange={(e) =>
                  setLimits(toolType, (prev) => ({ ...prev, monthlyTokenLimit: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium">Hourly Cost Limit ($)</label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g., 5.00"
                value={getLimits(toolType).hourlyCostLimit}
                onChange={(e) =>
                  setLimits(toolType, (prev) => ({ ...prev, hourlyCostLimit: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium">Daily Cost Limit ($)</label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g., 10.00"
                value={getLimits(toolType).dailyCostLimit}
                onChange={(e) =>
                  setLimits(toolType, (prev) => ({ ...prev, dailyCostLimit: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium">Monthly Cost Limit ($)</label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g., 50.00"
                value={getLimits(toolType).monthlyCostLimit}
                onChange={(e) =>
                  setLimits(toolType, (prev) => ({ ...prev, monthlyCostLimit: e.target.value }))
                }
              />
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={savingLimits}
            onClick={() => saveToolLimits(toolType, getLimits(toolType))}
          >
            {savingLimits ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save {getToolDisplayName(toolType)} Limits
          </Button>
        </SettingsCard>
      ))}

      {/* Info note */}
      <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
        <p className="font-medium mb-1">How limits work:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Hourly limits reset at the top of each hour (local time)</li>
          <li>Daily limits reset at midnight (local time)</li>
          <li>Monthly limits reset on the 1st of each month</li>
          <li>When a limit is reached, the worker tries another tool if available</li>
          <li>Token counts are estimated (~4 characters per token)</li>
        </ul>
      </div>
    </div>
  )
}
