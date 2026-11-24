'use client'

import { motion, useReducedMotion } from 'motion/react'
import * as React from 'react'

import { cn } from '@/lib/utils'

// Same values as tokens.motion.spring.snappy in @m-intelligence/tokens.
const SPRING = { type: 'spring', stiffness: 400, damping: 32, mass: 1 } as const

type Option = { value: string; label: React.ReactNode }

/**
 * Segmented control: a tinted track with a thumb that springs to the selected option.
 * Keyboard: arrow keys move the selection (radiogroup semantics).
 */
function SegmentedControl({
  options,
  value: controlled,
  defaultValue,
  onValueChange,
  className,
  'aria-label': ariaLabel,
  variant = 'default',
}: {
  options: Option[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  className?: string
  'aria-label'?: string
  /** `default`: white thumb (neutral). `brand`: brand-colored thumb. */
  variant?: 'default' | 'brand'
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? options[0]?.value)
  const value = controlled ?? uncontrolled
  const layoutId = `segmented-${React.useId()}`
  const reduceMotion = useReducedMotion()
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])

  const select = (v: string) => {
    if (controlled === undefined) setUncontrolled(v)
    onValueChange?.(v)
  }

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!dir) return
    e.preventDefault()
    const next = (index + dir + options.length) % options.length
    select(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-slot="segmented-control"
      className={cn(
        // Tinted track (no backdrop-filter): readable on any surface, including inside glass cards,
        // and avoids a second, nested backdrop blur.
        'relative inline-flex items-center gap-0.5 rounded-full p-1',
        'bg-foreground/[0.07] shadow-[inset_0_1px_2px_0_rgb(0_0_0/0.08)] dark:bg-white/[0.08]',
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // If the value matches no option, keep the first one reachable by keyboard.
            tabIndex={active || (i === 0 && !options.some((x) => x.value === value)) ? 0 : -1}
            onClick={() => select(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative z-10 min-h-9 flex-1 rounded-full px-4 text-sm whitespace-nowrap outline-none touch-manipulation select-none',
              'transition-[color,transform] duration-300 ease-spring-snappy active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
              'focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              // larger hit area on touch screens without changing the visual size
              'after:absolute after:-inset-y-1.5 after:inset-x-0 pointer-fine:after:hidden',
              active
                ? variant === 'brand'
                  ? 'font-semibold text-brand-foreground'
                  : 'font-semibold text-foreground'
                : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={reduceMotion ? { duration: 0 } : SPRING}
                className={cn(
                  'absolute inset-0 -z-10 rounded-full',
                  variant === 'brand'
                    ? 'bg-brand shadow-[0_4px_14px_-4px_var(--brand),inset_0_1px_0_0_rgb(255_255_255/0.25)]'
                    : 'bg-background shadow-[0_1px_2px_rgb(0_0_0/0.1),0_6px_16px_-6px_var(--glass-shadow)] ring-1 ring-black/5 dark:bg-white/20 dark:ring-white/10',
                )}
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export { SegmentedControl }
