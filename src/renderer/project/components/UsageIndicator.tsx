import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Activity, ChevronDown, Cpu, Zap, AlertTriangle, RefreshCw } from 'lucide-react'
import { Badge } from '../../src/components/ui/badge'
import { cn } from '../../src/lib/utils'

interface AIToolLimits {
  tool_type: string
  hourly_token_limit: number | null
  daily_token_limit: number | null
  monthly_token_limit: number | null
  hourly_cost_limit_usd: number | null
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
  hourly_tokens_used: number
  daily_tokens_used: number
  monthly_tokens_used: number
  hourly_cost_used: number
  daily_cost_used: number
  monthly_cost_used: number
}

interface ResetTimes {
  hourly: number // seconds until reset
  daily: number
  monthly: number
}

interface UsageIndicatorProps {
  className?: string
}

// ============================================================================
// Formatting Helpers
// ============================================================================

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

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'now'
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }
  return `${secs}s`
}

function formatLastUpdated(date: Date | null): string {
  if (!date) return ''
  
  const now = new Date()
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  
  if (diffSeconds < 5) return 'just now'
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
  return `${Math.floor(diffSeconds / 3600)}h ago`
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

// ============================================================================
// Limit Progress Component (unified for tokens and cost)
// ============================================================================

interface LimitProgressProps {
  used: number
  limit: number | null
  label: string
  type: 'tokens' | 'cost'
  resetsIn?: number // seconds until reset
}

function LimitProgress({ used, limit, label, type, resetsIn }: LimitProgressProps): React.JSX.Element | null {
  if (!limit) return null

  const remaining = Math.max(0, limit - used)
  const percentage = Math.min((used / limit) * 100, 100)
  const isWarning = percentage >= 80
  const isDanger = percentage >= 95

  const formatValue = type === 'cost' ? formatCost : formatTokens

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <div className="text-right">
          <span className={cn(isDanger ? 'text-destructive' : isWarning ? 'text-yellow-500' : '')}>
            {formatValue(used)} / {formatValue(limit)}
          </span>
          <span className="text-muted-foreground ml-1">({formatValue(remaining)} left)</span>
        </div>
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
      {resetsIn !== undefined && resetsIn > 0 && (
        <div className="text-[10px] text-muted-foreground/70">
          Resets in {formatTimeRemaining(resetsIn)}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Critical Limit Calculator
// ============================================================================

interface CriticalLimit {
  percentage: number
  label: string
  isWarning: boolean
  isDanger: boolean
}

function calculateCriticalLimit(usageDetails: UsageWithLimits[]): CriticalLimit | null {
  let highestPercentage = 0
  let criticalLabel = ''

  for (const tool of usageDetails) {
    if (!tool.limits) continue

    const checks = [
      {
        used: tool.hourly_tokens_used,
        limit: tool.limits.hourly_token_limit,
        label: `${getToolLabel(tool.tool_type)} hourly tokens`
      },
      {
        used: tool.hourly_cost_used,
        limit: tool.limits.hourly_cost_limit_usd,
        label: `${getToolLabel(tool.tool_type)} hourly cost`
      },
      {
        used: tool.daily_tokens_used,
        limit: tool.limits.daily_token_limit,
        label: `${getToolLabel(tool.tool_type)} daily tokens`
      },
      {
        used: tool.daily_cost_used,
        limit: tool.limits.daily_cost_limit_usd,
        label: `${getToolLabel(tool.tool_type)} daily cost`
      },
      {
        used: tool.monthly_tokens_used,
        limit: tool.limits.monthly_token_limit,
        label: `${getToolLabel(tool.tool_type)} monthly tokens`
      },
      {
        used: tool.monthly_cost_used,
        limit: tool.limits.monthly_cost_limit_usd,
        label: `${getToolLabel(tool.tool_type)} monthly cost`
      }
    ]

    for (const check of checks) {
      if (check.limit && check.limit > 0) {
        const pct = (check.used / check.limit) * 100
        if (pct > highestPercentage) {
          highestPercentage = pct
          criticalLabel = check.label
        }
      }
    }
  }

  if (highestPercentage === 0) return null

  return {
    percentage: Math.min(highestPercentage, 100),
    label: criticalLabel,
    isWarning: highestPercentage >= 80,
    isDanger: highestPercentage >= 95
  }
}

// ============================================================================
// Main Component
// ============================================================================

export function UsageIndicator({ className }: UsageIndicatorProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [totalUsage, setTotalUsage] = useState<{ tokens: number; cost: number }>({
    tokens: 0,
    cost: 0
  })
  const [usageDetails, setUsageDetails] = useState<UsageWithLimits[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [resetTimes, setResetTimes] = useState<ResetTimes>({
    hourly: 0,
    daily: 0,
    monthly: 0
  })
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load usage data
  const loadUsage = useCallback(async (showLoading = false): Promise<void> => {
    try {
      if (showLoading) setIsRefreshing(true)
      const [totalResult, detailsResult] = await Promise.all([
        window.projectAPI.getTotalUsage(),
        window.projectAPI.getUsageWithLimits()
      ])
      setTotalUsage(totalResult.usage)
      setUsageDetails(detailsResult.usageWithLimits)
      // Update reset times from server response
      if (detailsResult.resetTimes) {
        setResetTimes({
          hourly: detailsResult.resetTimes.hourly_resets_in,
          daily: detailsResult.resetTimes.daily_resets_in,
          monthly: detailsResult.resetTimes.monthly_resets_in
        })
      }
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Failed to load usage:', err)
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  // Manual refresh handler
  const handleRefresh = useCallback(() => {
    loadUsage(true)
  }, [loadUsage])

  // Initial load and periodic refresh
  useEffect(() => {
    loadUsage()

    // Periodic refresh every 60 seconds
    const interval = setInterval(() => loadUsage(), 60_000)

    // Subscribe to state updates to refresh usage immediately
    const unsubscribe = window.projectAPI.onStateUpdate(() => {
      loadUsage()
    })

    return () => {
      clearInterval(interval)
      unsubscribe()
    }
  }, [loadUsage])

  // Countdown timer - decrements reset times every second
  useEffect(() => {
    const timer = setInterval(() => {
      setResetTimes((prev) => ({
        hourly: Math.max(0, prev.hourly - 1),
        daily: Math.max(0, prev.daily - 1),
        monthly: Math.max(0, prev.monthly - 1)
      }))
    }, 1000)
    return () => clearInterval(timer)
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

  // Calculate critical limit for badge display
  const criticalLimit = useMemo(() => calculateCriticalLimit(usageDetails), [usageDetails])

  const hasUsage = totalUsage.tokens > 0 || usageDetails.length > 0
  const hasLimits = usageDetails.some((t) => t.limits !== null)

  // Determine badge content and style
  const badgeContent = useMemo(() => {
    if (criticalLimit && criticalLimit.isWarning) {
      return {
        text: `${Math.round(criticalLimit.percentage)}%`,
        variant: criticalLimit.isDanger ? 'destructive' : 'warning'
      }
    }
    if (hasUsage) {
      return {
        text: formatCost(totalUsage.cost),
        variant: 'secondary'
      }
    }
    return null
  }, [criticalLimit, hasUsage, totalUsage.cost])

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
        {badgeContent && (
          <Badge
            variant={badgeContent.variant === 'destructive' ? 'destructive' : 'secondary'}
            className={cn(
              'ml-1 px-1.5 py-0 text-xs',
              badgeContent.variant === 'warning' && 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
            )}
          >
            {criticalLimit?.isDanger && <AlertTriangle className="h-3 w-3 mr-0.5" />}
            {badgeContent.text}
          </Badge>
        )}
        <ChevronDown
          className={cn('h-3 w-3 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-80 rounded-lg border bg-popover p-3 shadow-lg z-50">
          <div className="space-y-3">
            {/* Header with total and refresh button */}
            <div className="flex items-center justify-between pb-2 border-b">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">Monthly Usage</span>
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className={cn(
                    'p-1 rounded-md hover:bg-muted/50 transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                  title="Refresh usage data"
                >
                  <RefreshCw
                    className={cn('h-3.5 w-3.5 text-muted-foreground', isRefreshing && 'animate-spin')}
                  />
                </button>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">{formatTokens(totalUsage.tokens)} tokens</div>
                <div className="text-xs text-muted-foreground">{formatCost(totalUsage.cost)}</div>
              </div>
            </div>

            {/* Per-tool breakdown */}
            {usageDetails.length > 0 ? (
              <div className="space-y-4">
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
                      {/* Current usage summary */}
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
                          {/* Hourly limits */}
                          <LimitProgress
                            used={tool.hourly_tokens_used}
                            limit={tool.limits.hourly_token_limit}
                            label="Hourly Tokens"
                            type="tokens"
                            resetsIn={resetTimes.hourly}
                          />
                          <LimitProgress
                            used={tool.hourly_cost_used}
                            limit={tool.limits.hourly_cost_limit_usd}
                            label="Hourly Cost"
                            type="cost"
                            resetsIn={resetTimes.hourly}
                          />

                          {/* Daily limits */}
                          <LimitProgress
                            used={tool.daily_tokens_used}
                            limit={tool.limits.daily_token_limit}
                            label="Daily Tokens"
                            type="tokens"
                            resetsIn={resetTimes.daily}
                          />
                          <LimitProgress
                            used={tool.daily_cost_used}
                            limit={tool.limits.daily_cost_limit_usd}
                            label="Daily Cost"
                            type="cost"
                            resetsIn={resetTimes.daily}
                          />

                          {/* Monthly limits */}
                          <LimitProgress
                            used={tool.monthly_tokens_used}
                            limit={tool.limits.monthly_token_limit}
                            label="Monthly Tokens"
                            type="tokens"
                            resetsIn={resetTimes.monthly}
                          />
                          <LimitProgress
                            used={tool.monthly_cost_used}
                            limit={tool.limits.monthly_cost_limit_usd}
                            label="Monthly Cost"
                            type="cost"
                            resetsIn={resetTimes.monthly}
                          />
                        </div>
                      )}

                      {/* No limits configured message */}
                      {!tool.limits && (
                        <div className="text-xs text-muted-foreground italic">
                          No limits configured
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
            <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
              <div>
                {hasLimits
                  ? 'Configure limits in Settings → Usage & Limits.'
                  : 'Configure spending limits in Settings → Usage & Limits.'}
              </div>
              {lastUpdated && (
                <div className="text-[10px] text-muted-foreground/70">
                  Updated {formatLastUpdated(lastUpdated)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
