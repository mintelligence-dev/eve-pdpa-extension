import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // text-base on phones prevents iOS Safari from zooming into the field
        'field-sizing-content flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow,border-color,background-color] duration-200 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        // A short shake when a field becomes invalid (motion-safe only).
        'motion-safe:aria-invalid:animate-[mintel-shake_0.4s_ease-in-out]',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
