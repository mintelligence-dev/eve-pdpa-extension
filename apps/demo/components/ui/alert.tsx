import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-300 grid-cols-[0_1fr] items-start gap-y-0.5 rounded-xl border px-4 py-3 text-sm has-[>svg]:grid-cols-[1.25rem_1fr] has-[>svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-px [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        brand: 'border-brand/25 bg-brand/8 text-brand [&_[data-slot=alert-description]]:text-brand',
        success:
          'border-success/30 bg-success/8 text-success [&_[data-slot=alert-description]]:text-success',
        warning:
          'border-warning/30 bg-warning/8 text-warning [&_[data-slot=alert-description]]:text-warning',
        destructive:
          'border-destructive/30 bg-destructive/8 text-destructive [&_[data-slot=alert-description]]:text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

/** Inline message. Put a lucide icon first, then AlertTitle and AlertDescription. */
function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-muted-foreground [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle, alertVariants }
