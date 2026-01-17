/**
 * Setting Row Component
 *
 * Reusable row for a single setting with label, description, and control
 */

import type { ReactNode } from 'react'
import { cn } from '../../../../src/lib/utils'

interface SettingRowProps {
  title: string
  description?: string
  children: ReactNode // Control element (Switch, Input, Button)
  className?: string
  noBorder?: boolean
}

export function SettingRow({
  title,
  description,
  children,
  className,
  noBorder = false
}: SettingRowProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 p-3',
        !noBorder && 'rounded-lg border',
        className
      )}
    >
      <div className="flex-1">
        <div className="font-medium text-sm">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  )
}
