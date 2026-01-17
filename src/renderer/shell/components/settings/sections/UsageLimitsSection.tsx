/**
 * Usage Limits Section
 *
 * Token and cost limits for AI tools
 */

import { useEffect } from 'react'
import { Bot, Code, Loader2 } from 'lucide-react'
import { Button } from '../../../../src/components/ui/button'
import { Input } from '../../../../src/components/ui/input'
import { SettingsCard } from '../components/SettingsCard'
import { useUsageLimits } from '../hooks/useUsageLimits'

export function UsageLimitsSection(): React.JSX.Element {
  const {
    claudeLimits,
    codexLimits,
    limitsLoading,
    savingLimits,
    setClaudeLimits,
    setCodexLimits,
    loadUsageLimits,
    saveToolLimits
  } = useUsageLimits()

  useEffect(() => {
    loadUsageLimits()
  }, [loadUsageLimits])

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
          Set daily and monthly limits for token usage and cost per AI tool. Leave empty for no
          limit. When limits are reached, the worker will try to fall back to the other tool or
          pause.
        </p>
      </div>

      {/* Claude Limits */}
      <SettingsCard title="Claude Code" icon={<Bot className="h-4 w-4 text-foreground/70" />}>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="space-y-2">
            <label className="text-xs font-medium">Hourly Token Limit</label>
            <Input
              type="number"
              placeholder="e.g., 50000"
              value={claudeLimits.hourlyTokenLimit}
              onChange={(e) =>
                setClaudeLimits((prev) => ({
                  ...prev,
                  hourlyTokenLimit: e.target.value
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Daily Token Limit</label>
            <Input
              type="number"
              placeholder="e.g., 100000"
              value={claudeLimits.dailyTokenLimit}
              onChange={(e) =>
                setClaudeLimits((prev) => ({
                  ...prev,
                  dailyTokenLimit: e.target.value
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Monthly Token Limit</label>
            <Input
              type="number"
              placeholder="e.g., 3000000"
              value={claudeLimits.monthlyTokenLimit}
              onChange={(e) =>
                setClaudeLimits((prev) => ({
                  ...prev,
                  monthlyTokenLimit: e.target.value
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Hourly Cost Limit ($)</label>
            <Input
              type="number"
              step="0.01"
              placeholder="e.g., 5.00"
              value={claudeLimits.hourlyCostLimit}
              onChange={(e) =>
                setClaudeLimits((prev) => ({
                  ...prev,
                  hourlyCostLimit: e.target.value
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Daily Cost Limit ($)</label>
            <Input
              type="number"
              step="0.01"
              placeholder="e.g., 10.00"
              value={claudeLimits.dailyCostLimit}
              onChange={(e) =>
                setClaudeLimits((prev) => ({
                  ...prev,
                  dailyCostLimit: e.target.value
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Monthly Cost Limit ($)</label>
            <Input
              type="number"
              step="0.01"
              placeholder="e.g., 50.00"
              value={claudeLimits.monthlyCostLimit}
              onChange={(e) =>
                setClaudeLimits((prev) => ({
                  ...prev,
                  monthlyCostLimit: e.target.value
                }))
              }
            />
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={savingLimits}
          onClick={() => saveToolLimits('claude', claudeLimits)}
        >
          {savingLimits ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save Claude Limits
        </Button>
      </SettingsCard>

      {/* Codex Limits */}
      <SettingsCard title="Codex (OpenAI)" icon={<Code className="h-4 w-4 text-foreground/70" />}>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="space-y-2">
            <label className="text-xs font-medium">Hourly Token Limit</label>
            <Input
              type="number"
              placeholder="e.g., 50000"
              value={codexLimits.hourlyTokenLimit}
              onChange={(e) =>
                setCodexLimits((prev) => ({
                  ...prev,
                  hourlyTokenLimit: e.target.value
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Daily Token Limit</label>
            <Input
              type="number"
              placeholder="e.g., 100000"
              value={codexLimits.dailyTokenLimit}
              onChange={(e) =>
                setCodexLimits((prev) => ({
                  ...prev,
                  dailyTokenLimit: e.target.value
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Monthly Token Limit</label>
            <Input
              type="number"
              placeholder="e.g., 3000000"
              value={codexLimits.monthlyTokenLimit}
              onChange={(e) =>
                setCodexLimits((prev) => ({
                  ...prev,
                  monthlyTokenLimit: e.target.value
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Hourly Cost Limit ($)</label>
            <Input
              type="number"
              step="0.01"
              placeholder="e.g., 5.00"
              value={codexLimits.hourlyCostLimit}
              onChange={(e) =>
                setCodexLimits((prev) => ({
                  ...prev,
                  hourlyCostLimit: e.target.value
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Daily Cost Limit ($)</label>
            <Input
              type="number"
              step="0.01"
              placeholder="e.g., 10.00"
              value={codexLimits.dailyCostLimit}
              onChange={(e) =>
                setCodexLimits((prev) => ({
                  ...prev,
                  dailyCostLimit: e.target.value
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Monthly Cost Limit ($)</label>
            <Input
              type="number"
              step="0.01"
              placeholder="e.g., 50.00"
              value={codexLimits.monthlyCostLimit}
              onChange={(e) =>
                setCodexLimits((prev) => ({
                  ...prev,
                  monthlyCostLimit: e.target.value
                }))
              }
            />
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={savingLimits}
          onClick={() => saveToolLimits('codex', codexLimits)}
        >
          {savingLimits ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save Codex Limits
        </Button>
      </SettingsCard>

      {/* Info note */}
      <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
        <p className="font-medium mb-1">How limits work:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Hourly limits reset at the top of each hour</li>
          <li>Daily limits reset at midnight (local time)</li>
          <li>Monthly limits reset on the 1st of each month</li>
          <li>When a limit is reached, the worker tries the other tool if available</li>
          <li>Token counts are estimated (~4 characters per token)</li>
        </ul>
      </div>
    </div>
  )
}
