import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  [
    // Base styles
    "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium",
    // Transitions - smooth hover/active animations
    "transition-all duration-150 ease-out",
    // Active state - subtle press effect
    "active:scale-[0.98]",
    // Disabled state
    "disabled:pointer-events-none disabled:opacity-50",
    // SVG sizing
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
    // Focus ring
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    // Invalid state
    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive"
  ].join(' '),
  {
    variants: {
      variant: {
        default: [
          'bg-primary text-primary-foreground shadow-sm',
          'hover:bg-primary/90 hover:shadow-md',
          'active:bg-primary/95'
        ].join(' '),
        destructive: [
          'bg-destructive text-white shadow-sm',
          'hover:bg-destructive/90 hover:shadow-md',
          'focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
          'dark:bg-destructive/80'
        ].join(' '),
        outline: [
          'border bg-background shadow-xs',
          'hover:bg-accent hover:text-accent-foreground hover:border-accent',
          'dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
        ].join(' '),
        secondary: [
          'bg-secondary text-secondary-foreground',
          'hover:bg-secondary/80'
        ].join(' '),
        ghost: [
          'hover:bg-accent hover:text-accent-foreground',
          'dark:hover:bg-accent/50'
        ].join(' '),
        link: 'text-primary underline-offset-4 hover:underline active:scale-100'
      },
      size: {
        default: 'h-9 px-4 py-2 rounded-lg has-[>svg]:px-3',
        sm: 'h-8 rounded-lg gap-1.5 px-3 has-[>svg]:px-2.5 text-xs',
        lg: 'h-11 rounded-xl px-6 has-[>svg]:px-4 text-base',
        icon: 'size-9 rounded-lg',
        'icon-sm': 'size-8 rounded-lg',
        'icon-lg': 'size-10 rounded-xl'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
