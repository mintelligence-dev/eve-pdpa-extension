'use client'

import { OctagonX } from 'lucide-react'
import * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { type AuditFinding, ent, type ProcessResult, splitOutput } from '@/lib/pdpa'
import { cn } from '@/lib/utils'

const INVISIBLE: Record<string, string> = {
  '​': 'ZWSP',
  '‌': 'ZWNJ',
  '‍': 'ZWJ',
  '‎': 'LRM',
  '‏': 'RLM',
  '⁠': 'WJ',
  '﻿': 'BOM',
  '­': 'SHY',
  ' ': 'NBSP',
}

/** Text with invisible characters shown as small labels. */
export function Visible({ text }: { text: string }) {
  const out: React.ReactNode[] = []
  let buf = ''
  let k = 0
  for (const ch of text) {
    const name = INVISIBLE[ch]
    if (name) {
      if (buf) out.push(buf)
      buf = ''
      out.push(
        <span key={k++} className="inv" title="อักขระที่มองไม่เห็น">
          {name}
        </span>,
      )
    } else buf += ch
  }
  if (buf) out.push(buf)
  return <>{out}</>
}

export type Mark = { start: number; end: number; tone: string; tag?: string }

/** Text with highlighted spans; marks are offsets into `text`. */
export function Marked({ text, marks = [] }: { text: string; marks?: Mark[] }) {
  const out: React.ReactNode[] = []
  let at = 0
  for (const [i, m] of [...marks].sort((a, b) => a.start - b.start).entries()) {
    if (m.start < at) continue
    out.push(<Visible key={`t${i}`} text={text.slice(at, m.start)} />)
    out.push(
      <mark key={`m${i}`} className={cn('hl', `e-${m.tone}`)}>
        <Visible text={text.slice(m.start, m.end)} />
        {m.tag ? <span className="tag">{m.tag}</span> : null}
      </mark>,
    )
    at = m.end
  }
  out.push(<Visible key="end" text={text.slice(at)} />)
  return <div className="marked">{out}</div>
}

/** What the AI (or the customer) gets, each replacement marked by its data type. */
export function AiView({ original, result }: { original: string; result: ProcessResult }) {
  if (result.outcome === 'blocked') {
    return (
      <Alert variant="destructive">
        <OctagonX />
        <AlertTitle>ไม่ส่งข้อความนี้ให้ AI</AlertTitle>
        <AlertDescription>
          ได้ข้อความว่าง · blockedBy: {(result.blockedBy ?? []).join(', ')}
        </AlertDescription>
      </Alert>
    )
  }
  const parts = splitOutput(original, result.text, result.findings)
  if (parts === null) return <Marked text={result.text} />
  return (
    <div className="marked">
      {parts.map((p, i) => {
        if ('same' in p) return <Visible key={i} text={p.same} />
        const f: AuditFinding = p.finding
        const meta = ent(f.entity)
        const untouched = p.rep === p.was
        const tag = f.allowlisted ? 'ปล่อยผ่าน · allowlist' : untouched ? 'flag · ไม่ได้แก้' : meta.label
        return (
          <mark key={i} className={cn('hl', untouched ? 'e-kept' : `e-${meta.tone}`)}>
            <Visible text={p.rep} />
            <span className="tag">{tag}</span>
          </mark>
        )
      })}
    </div>
  )
}

/** A function name, shown small next to a heading. */
export function Fn({ children }: { children: React.ReactNode }) {
  return (
    <code className="ms-1.5 font-mono text-xs font-normal text-muted-foreground">{children}</code>
  )
}

export function Panel({
  title,
  children,
  className,
}: {
  title?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn('gap-3 py-4', className)}>
      <CardContent className="flex min-w-0 flex-col gap-3 px-5">
        {title ? <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3> : null}
        {children}
      </CardContent>
    </Card>
  )
}

/** One numbered stage of the message's path. */
export function Stage({
  n,
  title,
  children,
}: {
  n: string
  title: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="py-4">
      <CardContent className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-5">
        <span className="font-heading text-lg font-semibold text-primary text-center">{n}</span>
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
          {children}
        </div>
      </CardContent>
    </Card>
  )
}

export type Preset = { label: string; text: string; note?: string; whyNot?: string }

export function MessageInput({
  id,
  label,
  value,
  onChange,
  presets = [],
  rows = 4,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  presets?: Preset[]
  rows?: number
  children?: React.ReactNode
}) {
  return (
    <Panel>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="text-base leading-relaxed"
      />
      {presets.length ? (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <Button
              key={p.label}
              type="button"
              size="sm"
              variant={p.text === value ? 'default' : 'secondary'}
              title={p.note}
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => onChange(p.text)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      ) : null}
      {children}
    </Panel>
  )
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[30em] overflow-auto rounded-lg bg-[#181b31] p-4 font-mono text-xs leading-relaxed text-[#e8ebf5] dark:bg-black/40">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  const e = error as { code?: string; name?: string; message?: string }
  return (
    <Alert variant="destructive">
      <OctagonX />
      <AlertTitle className="font-mono">{e?.code ?? e?.name ?? 'Error'}</AlertTitle>
      <AlertDescription>{e?.message ?? String(error)}</AlertDescription>
    </Alert>
  )
}

/** One step: heading, controls on the left, live results on the right, a footnote. */
export function Step({
  eyebrow,
  title,
  lede,
  left,
  right,
  foot,
}: {
  eyebrow: string
  title: string
  lede: string
  left: React.ReactNode
  right: React.ReactNode
  foot?: string
}) {
  return (
    <section className="grid grid-cols-1 gap-7 pt-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <header className="flex max-w-[70ch] flex-col gap-1.5 lg:col-span-2">
        <p className="text-sm font-semibold tracking-wide text-primary">{eyebrow}</p>
        <h2 className="font-heading text-3xl font-bold leading-tight text-balance sm:text-4xl">
          {title}
        </h2>
        <p className="text-lg text-muted-foreground">{lede}</p>
      </header>
      <div className="flex min-w-0 flex-col gap-4">{left}</div>
      <div className="flex min-w-0 flex-col gap-4" aria-live="polite">
        {right}
      </div>
      {foot ? (
        <p className="border-t pt-4 text-sm text-muted-foreground lg:col-span-2">{foot}</p>
      ) : null}
    </section>
  )
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}
