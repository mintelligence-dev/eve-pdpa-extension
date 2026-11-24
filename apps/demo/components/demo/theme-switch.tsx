'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import * as React from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'

declare global {
  interface Window {
    pdpaTheme?: { get: () => string; set: (choice: string) => void }
  }
}

const OPTIONS = [
  { value: 'light', icon: Sun, label: 'สว่าง' },
  { value: 'system', icon: Monitor, label: 'ตามเครื่อง' },
  { value: 'dark', icon: Moon, label: 'มืด' },
]

/** Light · system · dark. The choice is kept in this browser only. */
export function ThemeSwitch() {
  const [choice, setChoice] = React.useState<string | undefined>(undefined)
  React.useEffect(() => setChoice(window.pdpaTheme?.get() ?? 'system'), [])
  return (
    <SegmentedControl
      aria-label="ธีม"
      value={choice ?? 'system'}
      onValueChange={(v) => {
        window.pdpaTheme?.set(v)
        setChoice(v)
      }}
      options={OPTIONS.map(({ value, icon: Icon, label }) => ({
        value,
        label: (
          <span className="inline-flex items-center gap-1.5" title={label}>
            <Icon className="size-4" aria-hidden />
            <span className="max-sm:sr-only">{label}</span>
          </span>
        ),
      }))}
    />
  )
}
