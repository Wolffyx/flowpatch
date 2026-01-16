import { Button } from '../../../src/components/ui/button'
import { Loader2 } from 'lucide-react'

export function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</h3>
      {children}
    </section>
  )
}

export function ActionButton({
  onClick,
  loading,
  disabled,
  icon: Icon,
  children
}: {
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading || disabled} className="h-8">
      {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Icon className="mr-1.5 h-3.5 w-3.5" />}
      {children}
    </Button>
  )
}
