import { useState, useEffect, useRef } from 'react'
import { Activity, ChevronDown, Cpu, Zap } from 'lucide-react'
import { Badge } from '../../src/components/ui/badge'
import { cn } from '../../src/lib/utils'

interface AIToolLimits {
  tool_type: string
  daily_token_limit: number | null
  monthly_token_limit: number | null
  daily_cost_limit_usd: number | null
  monthly_cost_limit_usd: number | null
}

interface UsageWithLimits {
  tool_type: string
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost_usd: number
  invocation_count: number
  avg_duration_ms: number
  limits: AIToolLimits | null
  daily_tokens_used: number
  monthly_tokens_used: number
  daily_cost_used: number
  monthly_cost_used: number
}

interface UsageIndicatorProps {
  className?: string
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return tokens.toString()
}

function formatCost(cost: number): string {
  if (cost < 0.01) {
    return cost > 0 ? '<$0.01' : '$0.00'
  }
  return `$${cost.toFixed(2)}`
}

function getToolIcon(toolType: string): React.ReactNode {
  switch (toolType) {
    case 'claude':
      return <Zap className="h-3.5 w-3.5" />
    case 'codex':
      return <Cpu className="h-3.5 w-3.5" />
    default:
      return <Activity className="h-3.5 w-3.5" />
  }
}

function getToolLabel(toolType: string): string {
  switch (toolType) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    default:
      return 'Other'
  }
}

function UsageProgress({
  used,
  limit,
  label
}: {
  used: number
  limit: number | null
  label: string
}): React.JSX.Element | null {
  if (!limit) return null

  const percentage = Math.min((used / limit) * 100, 100)
  const isWarning = percentage >= 80
  const isDanger = percentage >= 95

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn(isDanger ? 'text-destructive' : isWarning ? 'text-yellow-500' : '')}>
          {formatTokens(used)} / {formatTokens(limit)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full transition-all duration-300',
            isDanger ? 'bg-destructive' : isWarning ? 'bg-yellow-500' : 'bg-primary'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

export function UsageIndicator({ className }: UsageIndicatorProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [totalUsage, setTotalUsage] = useState<{ tokens: number; cost: number }>({
    tokens: 0,
    cost: 0
  })
  const [usageDetails, setUsageDetails] = useState<UsageWithLimits[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load usage data
  useEffect(() => {
    const loadUsage = async (): Promise<void> => {
      try {
        const [totalResult, detailsResult] = await Promise.all([
          window.projectAPI.getTotalUsage(),
          window.projectAPI.getUsageWithLimits()
        ])
        setTotalUsage(totalResult.usage)
        setUsageDetails(detailsResult.usageWithLimits)
      } catch (err) {
        console.error('Failed to load usage:', err)
      }
    }

    loadUsage()

    // Subscribe to state updates to refresh usage
    const unsubscribe = window.projectAPI.onStateUpdate(() => {
      loadUsage()
    })

    return unsubscribe
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const hasUsage = totalUsage.tokens > 0 || usageDetails.length > 0

  return (
    <div className={cn('relative', className)} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors',
          'hover:bg-muted/50 border border-transparent',
          isOpen && 'bg-muted/50 border-border'
        )}
      >
        <Activity className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">Usage</span>
        {hasUsage && (
          <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
            {formatTokens(totalUsage.tokens)}
          </Badge>
        )}
        <ChevronDown
          className={cn('h-3 w-3 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-72 rounded-lg border bg-popover p-3 shadow-lg z-50">
          <div className="space-y-3">
            {/* Header with total */}
            <div className="flex items-center justify-between pb-2 border-b">
              <span className="font-medium text-sm">Monthly Usage</span>
              <div className="text-right">
                <div className="text-sm font-medium">{formatTokens(totalUsage.tokens)} tokens</div>
                <div className="text-xs text-muted-foreground">{formatCost(totalUsage.cost)}</div>
              </div>
            </div>

            {/* Per-tool breakdown */}
            {usageDetails.length > 0 ? (
              <div className="space-y-3">
                {usageDetails.map((tool) => (
                  <div key={tool.tool_type} className="space-y-2">
                    <div className="flex items-center gap-2">
                      {getToolIcon(tool.tool_type)}
                      <span className="font-medium text-sm">{getToolLabel(tool.tool_type)}</span>
                      <Badge variant="outline" className="ml-auto text-xs">
                        {tool.invocation_count} calls
                      </Badge>
                    </div>

                    <div className="pl-5 space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Tokens:</span>{' '}
                          <span className="font-medium">{formatTokens(tool.total_tokens)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Cost:</span>{' '}
                          <span className="font-medium">{formatCost(tool.total_cost_usd)}</span>
                        </div>
                      </div>

                      {/* Limits progress bars */}
                      {tool.limits && (
                        <div className="space-y-2 pt-1">
                          <UsageProgress
                            used={tool.daily_tokens_used}
                            limit={tool.limits.daily_token_limit}
                            label="Daily"
                          />
                          <UsageProgress
                            used={tool.monthly_tokens_used}
                            limit={tool.limits.monthly_token_limit}
                            label="Monthly"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-sm text-muted-foreground py-4">
                No usage recorded yet
              </div>
            )}

            {/* Footer note */}
            <div className="pt-2 border-t text-xs text-muted-foreground">
              Resets monthly. Configure limits in Settings.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
