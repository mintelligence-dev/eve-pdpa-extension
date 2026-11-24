'use client'

import { ArrowLeft, ArrowRight } from 'lucide-react'
import * as React from 'react'
import { StepAllowlist, StepAudit, StepHash } from '@/components/demo/steps-audit'
import { StepActions, StepDetect, StepOverview } from '@/components/demo/steps-detect'
import { StepPolicy, StepTokens } from '@/components/demo/steps-policy'
import { ThemeSwitch } from '@/components/demo/theme-switch'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { P } from '@/lib/pdpa'

const STEPS = [
  { label: 'ภาพรวม', Step: StepOverview },
  { label: 'ตัวตรวจ', Step: StepDetect },
  { label: 'วิธีปิด', Step: StepActions },
  { label: 'กติกา', Step: StepPolicy },
  { label: 'token', Step: StepTokens },
  { label: 'hash', Step: StepHash },
  { label: 'ข้อมูลร้าน', Step: StepAllowlist },
  { label: 'บันทึก', Step: StepAudit },
]

export default function Page() {
  const [current, setCurrent] = React.useState(0)

  // #s1 … #s8, as the old page used, so links into a step keep working.
  React.useEffect(() => {
    const fromHash = () => {
      const m = /^#s(\d+)$/.exec(window.location.hash)
      if (m) setCurrent(Math.max(0, Math.min(STEPS.length - 1, Number(m[1]) - 1)))
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [])
  const show = React.useCallback((i: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i))
    setCurrent(next)
    try {
      history.replaceState(null, '', `#s${next + 1}`)
    } catch {}
  }, [])
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && ['TEXTAREA', 'INPUT', 'SELECT'].includes(t.tagName)) return
      if (t?.closest('[role="radiogroup"]')) return
      if (e.key === 'ArrowRight') show(current + 1)
      if (e.key === 'ArrowLeft') show(current - 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current, show])

  const { Step } = STEPS[current] as (typeof STEPS)[number]
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-12 sm:px-8">
      <header className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-b bg-grouped/90 px-4 pt-4 pb-3 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-[image:var(--brand-gradient)]" />
        <div className="flex min-w-0 flex-col">
          <b className="bg-[image:var(--brand-gradient)] bg-clip-text font-heading text-lg text-transparent">
            eve-pdpa-extension
          </b>
          <span className="text-sm text-muted-foreground">
            ใช้ @eve-pdpa-extension/core v{P.VERSION} ตัวจริง ทำงานในเบราว์เซอร์นี้ · ข้อความไม่ถูกส่งออกไปไหน
          </span>
        </div>
        <nav aria-label="ขั้นตอนของ demo" className="order-3 -mb-1 w-full overflow-x-auto pb-1">
          <SegmentedControl
            aria-label="ขั้นตอน"
            variant="brand"
            value={String(current)}
            onValueChange={(v) => show(Number(v))}
            options={STEPS.map((s, i) => ({ value: String(i), label: s.label }))}
            className="w-max"
          />
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <ThemeSwitch />
          <Button
            size="icon"
            variant="outline"
            aria-label="ก่อนหน้า"
            disabled={current === 0}
            onClick={() => show(current - 1)}
          >
            <ArrowLeft />
          </Button>
          <span className="min-w-[3.5em] text-center text-sm tabular-nums text-muted-foreground">
            {current + 1} / {STEPS.length}
          </span>
          <Button
            size="icon"
            variant="outline"
            aria-label="ถัดไป"
            disabled={current === STEPS.length - 1}
            onClick={() => show(current + 1)}
          >
            <ArrowRight />
          </Button>
        </div>
      </header>
      <main>
        <Step key={current} />
      </main>
    </div>
  )
}
