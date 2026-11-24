import * as React from 'react'

import { cn } from '@/lib/utils'

const TONES = {
  brand: 'bg-[image:var(--brand-gradient)]',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
} as const

/**
 * Linear progress. With a `value` (0–100) the bar eases to it; without one it is indeterminate (a
 * sweeping segment, a gentle pulse under reduced motion).
 */
function Progress({
  value,
  tone = 'brand',
  size = 'default',
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  value?: number | null
  tone?: keyof typeof TONES
  size?: 'sm' | 'default' | 'lg'
}) {
  const indeterminate = value === undefined || value === null
  const v = indeterminate ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(v)}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-muted',
        { sm: 'h-1', default: 'h-2', lg: 'h-3' }[size],
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'h-full rounded-full',
          TONES[tone],
          indeterminate
            ? 'absolute inset-y-0 w-2/5 motion-safe:animate-[mintel-progress-sweep_1.4s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-pulse'
            : 'transition-[width] duration-700 ease-spring-smooth motion-reduce:transition-none',
        )}
        style={indeterminate ? undefined : { width: `${v}%` }}
      />
    </div>
  )
}

export { Progress }
