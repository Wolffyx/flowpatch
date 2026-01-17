/**
 * Settings Card Component
 *
 * Reusable card wrapper for grouping related settings
 */

import type { ReactNode } from 'react'
import { cn } from '../../../../src/lib/utils'

interface SettingsCardProps {
  title?: string
  description?: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  variant?: 'default' | 'danger'
}

export function SettingsCard({
  title,
  description,
  icon,
  children,
  className,
  variant = 'default'
}: SettingsCardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        variant === 'danger' && 'border-destructive/50',
        className
      )}
    >
      {(title || icon) && (
        <div className="flex items-center gap-2 mb-3">
          {icon}
          {title && (
            <h3 className={cn('text-sm font-medium', variant === 'danger' && 'text-destructive')}>
              {title}
            </h3>
          )}
        </div>
      )}
      {description && <p className="text-xs text-muted-foreground mb-3">{description}</p>}
      {children}
    </div>
  )
}
