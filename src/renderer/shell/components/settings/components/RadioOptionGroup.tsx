/**
 * Radio Option Group Component
 *
 * Reusable radio-style selection buttons for settings options
 */

import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../../../src/lib/utils'

interface RadioOption<T extends string> {
  id: T
  title: string
  description: string
  icon?: ReactNode
  tokens?: string // Optional token count for thinking modes
  disabled?: boolean // Whether this option is disabled
  badge?: string // Optional badge text (e.g., "Not Installed")
}

interface RadioOptionGroupProps<T extends string> {
  options: RadioOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

export function RadioOptionGroup<T extends string>({
  options,
  value,
  onChange,
  className
}: RadioOptionGroupProps<T>): React.JSX.Element {
  return (
    <div className={cn('grid gap-2', className)}>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => !opt.disabled && onChange(opt.id)}
          disabled={opt.disabled}
          title={opt.disabled ? `${opt.title} is not installed` : undefined}
          className={cn(
            'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
            value === opt.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
            opt.disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent'
          )}
        >
          <div
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded-full border shrink-0',
              value === opt.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-muted-foreground'
            )}
          >
            {value === opt.id && <Check className="h-3 w-3" />}
          </div>
          {opt.icon}
          <div className="flex-1 min-w-0">
            <div className="font-medium flex items-center gap-2 flex-wrap">
              <span>{opt.title}</span>
              {opt.tokens && (
                <span className="text-xs text-muted-foreground">({opt.tokens} tokens)</span>
              )}
              {opt.badge && (
                <span className="text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
                  {opt.badge}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{opt.description}</div>
          </div>
        </button>
      ))}
    </div>
  )
}
