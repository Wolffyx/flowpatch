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
          onClick={() => onChange(opt.id)}
          className={cn(
            'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
            value === opt.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
          )}
        >
          <div
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded-full border',
              value === opt.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-muted-foreground'
            )}
          >
            {value === opt.id && <Check className="h-3 w-3" />}
          </div>
          {opt.icon}
          <div className="flex-1">
            <div className="font-medium">
              {opt.title}
              {opt.tokens && (
                <span className="text-xs text-muted-foreground ml-1">({opt.tokens} tokens)</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{opt.description}</div>
          </div>
        </button>
      ))}
    </div>
  )
}
