/**
 * Settings Constants
 *
 * Static configuration arrays for settings sections and options
 */

import type { ReactNode } from 'react'
import {
  Sun,
  Moon,
  Monitor,
  Palette,
  Settings2,
  Key,
  Bot,
  AlertTriangle,
  Sparkles,
  Code,
  Brain,
  Zap,
  ClipboardList,
  Users,
  Info
} from 'lucide-react'
import type { ThemePreference, WorkerToolPreference, SectionConfig } from './types'
import type { ThinkingMode, PlanningMode, MergeStrategy, ConflictResolution } from '@shared/types'

// Section configuration
export const SETTINGS_SECTIONS: SectionConfig[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'features', label: 'Features', icon: Settings2 },
  { id: 'shortcuts', label: 'Shortcuts', icon: Key },
  { id: 'ai-agents', label: 'AI Agents', icon: Bot },
  { id: 'usage-limits', label: 'Usage & Limits', icon: Zap },
  { id: 'danger-zone', label: 'Danger Zone', icon: AlertTriangle },
  { id: 'about', label: 'About', icon: Info }
]

// Theme options
interface ThemeOption {
  id: ThemePreference
  title: string
  description: string
  icon: ReactNode
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'light',
    title: 'Light',
    description: 'Use light theme regardless of system preference.',
    icon: <Sun className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'dark',
    title: 'Dark',
    description: 'Use dark theme regardless of system preference.',
    icon: <Moon className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'system',
    title: 'System',
    description: 'Automatically match your operating system theme.',
    icon: <Monitor className="h-4 w-4 text-foreground/70" />
  }
]

// Tool preference options
interface ToolOption {
  id: WorkerToolPreference
  title: string
  description: string
  icon: ReactNode
}

export const TOOL_OPTIONS: ToolOption[] = [
  {
    id: 'auto',
    title: 'Auto',
    description: 'Use Claude Code if available; otherwise use Codex.',
    icon: <Sparkles className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'claude',
    title: 'Claude Code',
    description: 'Prefer the Claude Code CLI when the worker runs.',
    icon: <Bot className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'codex',
    title: 'Codex',
    description: 'Prefer the Codex CLI when the worker runs.',
    icon: <Code className="h-4 w-4 text-foreground/70" />
  }
]

// Thinking mode options
interface ThinkingModeOption {
  id: ThinkingMode
  title: string
  description: string
  tokens: string
  icon: ReactNode
}

export const THINKING_MODE_OPTIONS: ThinkingModeOption[] = [
  {
    id: 'none',
    title: 'None',
    description: 'Standard processing without extended thinking.',
    tokens: '0',
    icon: <Zap className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'medium',
    title: 'Medium',
    description: 'Balanced thinking for most tasks.',
    tokens: '~1K',
    icon: <Brain className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'deep',
    title: 'Deep',
    description: 'More thorough analysis for complex problems.',
    tokens: '~4K',
    icon: <Brain className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'ultra',
    title: 'Ultra',
    description: 'Maximum thinking depth for difficult tasks.',
    tokens: '~16K',
    icon: <Brain className="h-4 w-4 text-foreground/70" />
  }
]

// Planning mode options
interface PlanningModeOption {
  id: PlanningMode
  title: string
  description: string
  icon: ReactNode
}

export const PLANNING_MODE_OPTIONS: PlanningModeOption[] = [
  {
    id: 'skip',
    title: 'Skip',
    description: 'No planning phase, proceed directly to implementation.',
    icon: <Zap className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'lite',
    title: 'Lite',
    description: 'Basic plan with task overview and high-level approach.',
    icon: <ClipboardList className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'spec',
    title: 'Spec',
    description: 'Detailed specification with file analysis and dependencies.',
    icon: <ClipboardList className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'full',
    title: 'Full',
    description: 'Comprehensive plan with risk analysis and verification steps.',
    icon: <ClipboardList className="h-4 w-4 text-foreground/70" />
  }
]

// Merge strategy options
interface MergeStrategyOption {
  id: MergeStrategy
  title: string
  description: string
  icon: ReactNode
}

export const MERGE_STRATEGY_OPTIONS: MergeStrategyOption[] = [
  {
    id: 'sequential',
    title: 'Sequential',
    description: 'Agents work one at a time, changes applied in order.',
    icon: <Users className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'parallel-merge',
    title: 'Parallel Merge',
    description: 'Agents work simultaneously, changes merged at the end.',
    icon: <Users className="h-4 w-4 text-foreground/70" />
  }
]

// Conflict resolution options
interface ConflictResolutionOption {
  id: ConflictResolution
  title: string
  description: string
  icon: ReactNode
}

export const CONFLICT_RESOLUTION_OPTIONS: ConflictResolutionOption[] = [
  {
    id: 'auto',
    title: 'Automatic',
    description: 'AI automatically resolves merge conflicts.',
    icon: <Sparkles className="h-4 w-4 text-foreground/70" />
  },
  {
    id: 'manual',
    title: 'Manual',
    description: 'Pause for user review when conflicts occur.',
    icon: <AlertTriangle className="h-4 w-4 text-foreground/70" />
  }
]

// Default empty limits state
export const DEFAULT_TOOL_LIMITS = {
  hourlyTokenLimit: '',
  dailyTokenLimit: '',
  monthlyTokenLimit: '',
  hourlyCostLimit: '',
  dailyCostLimit: '',
  monthlyCostLimit: ''
}

// Default profile form data
export const DEFAULT_PROFILE_FORM_DATA = {
  name: '',
  description: '',
  modelProvider: 'auto' as const,
  modelName: '',
  temperature: '',
  maxTokens: '',
  topP: '',
  systemPrompt: '',
  thinkingEnabled: false,
  thinkingMode: 'medium' as const,
  thinkingBudgetTokens: '',
  planningEnabled: false,
  planningMode: 'lite' as const
}
