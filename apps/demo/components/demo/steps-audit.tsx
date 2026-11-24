'use client'

import * as React from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { type AuditRecord, DEMO_KEY, guardWith, P, type ProcessResult } from '@/lib/pdpa'
import { AiView, ErrorBox, Hint, Json, Marked, MessageInput, Panel, Step } from './parts'

const Chip = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <Button
    type="button"
    size="sm"
    variant="secondary"
    className="h-7 rounded-full px-3 text-xs"
    onClick={onClick}
  >
    {children}
  </Button>
)

// ===================================================================== 6 · hash
export function StepHash() {
  const [text, setText] = React.useState(
    'เบอร์ 091-888-7777\nเบอร์ ๐๙๑๘๘๘๗๗๗๗\nเบอร์ +66 91 888 7777\nเลขบัญชี 0918887777\nเบอร์ 091-888-7778',
  )
  const [key, setKey] = React.useState(DEMO_KEY)
  let body: React.ReactNode
  try {
    const { guard } = guardWith(
      { PHONE: { action: 'hash' }, BANK_ACCOUNT: { action: 'hash' } },
      { hmacKey: key },
    )
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const seen = new Map<string, number>()
    const rows = lines.map((line) => {
      const r = guard.processSync(line)
      for (const x of r.text.match(/\[[A-Z_]+:[a-z]{16}\]/g) ?? [])
        seen.set(x, (seen.get(x) ?? 0) + 1)
      return { line, r }
    })
    const repeats = [...seen.values()].filter((n) => n > 1).length
    body = (
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ลูกค้าพิมพ์</TableHead>
              <TableHead>AI เห็น</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ line, r }, i) => (
              <TableRow key={`${i}-${line}`}>
                <TableCell className="whitespace-normal align-top">
                  <Marked text={line} />
                </TableCell>
                <TableCell className="whitespace-normal align-top">
                  <AiView original={line} result={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Hint>
          {repeats > 0 ? `มี hash ที่ซ้ำกัน ${repeats} ค่า · คือเบอร์เดียวกันที่พิมพ์ต่างรูปแบบ` : 'ไม่มี hash ซ้ำกัน'}
        </Hint>
      </Panel>
    )
  } catch (e) {
    body = (
      <Panel title="สร้าง guard ไม่ได้">
        <ErrorBox error={e} />
        <Hint>guard ไม่ยอมเริ่มทำงานถ้าใช้ hash ไม่ได้ · ล้มตอนเริ่มแอป ไม่ใช่ตอนข้อความแรก</Hint>
      </Panel>
    )
  }
  return (
    <Step
      eyebrow="hash"
      title="ค่าเดียวกันได้ hash เดียวกันเสมอ"
      lede="ใช้นับหรือเชื่อมข้อมูลโดยไม่เห็นค่าจริง · เบอร์เดียวกันพิมพ์ต่างรูปแบบก็ได้ hash เดียวกัน"
      foot="คนที่มี key ไล่ hash เบอร์มือถือไทยได้ครบ ~100 ล้านเบอร์ในไม่กี่นาที · hash จึงยังนับเป็นข้อมูลส่วนบุคคลตราบที่ key ยังอยู่ · key ในหน้านี้เป็นตัวอย่างสำหรับ demo เท่านั้น"
      left={
        <>
          <MessageInput
            id="s5-input"
            label="ข้อความ · บรรทัดละข้อความ"
            value={text}
            onChange={setText}
            rows={6}
          />
          <Panel>
            <Label htmlFor="s5-key">hmacKey · ลองแก้ key แล้วดู hash เปลี่ยน หรือลบให้สั้นกว่า 32 ตัว</Label>
            <Input
              id="s5-key"
              className="font-mono text-xs"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              <Chip onClick={() => setKey(DEMO_KEY)}>key ตัวอย่าง</Chip>
              <Chip onClick={() => setKey('b'.repeat(64))}>key อื่น</Chip>
              <Chip onClick={() => setKey('pdpa2026')}>key สั้นเกินไป</Chip>
            </div>
          </Panel>
        </>
      }
      right={body}
    />
  )
}

// ===================================================================== 7 · allowlist
export function StepAllowlist() {
  const [text, setText] = React.useState(
    'ติดต่อร้านได้ที่ support@myshop.co.th หรือโทร 021234567 ค่ะ · ส่งใบเสร็จไปที่ somchai@example.com แล้วนะคะ',
  )
  const [exact, setExact] = React.useState('support@myshop.co.th\n02-123-4567')
  const [pattern, setPattern] = React.useState('')
  let body: React.ReactNode
  try {
    const policy = P.definePolicy({
      entitySet: '0.2',
      entities: { EMAIL: { action: 'redact' }, PHONE: { action: 'redact' } },
      allowlist: {
        exact: exact
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
        pattern: pattern.trim() ? [pattern.trim()] : [],
      },
    })
    const guard = P.createGuard({ policy, onAudit: () => {} })
    const r = guard.processSync(text, { boundary: 'outbound' })
    body = (
      <>
        <Panel title="ลูกค้าได้รับ">
          <AiView original={text} result={r} />
        </Panel>
        <Panel title="สิ่งที่เจอ ตามที่บันทึกไว้ (findings)">
          <Json value={r.findings} />
        </Panel>
      </>
    )
  } catch (e) {
    body = (
      <Panel title="โหลดกติกาไม่ผ่าน">
        <ErrorBox error={e} />
      </Panel>
    )
  }
  return (
    <Step
      eyebrow="ข้อมูลของร้าน (allowlist)"
      title="ร้านส่งข้อมูลของร้านเองได้ ข้อมูลลูกค้ายังถูกปิด"
      lede="เทียบค่าหลังตัดรูปแบบออก ร้านเขียน 02-123-4567 ไว้ ลูกค้าพิมพ์ ๐๒๑๒๓๔๕๖๗ ก็ตรงกัน"
      foot="pattern ต้องตรงทั้งค่า ระบบครอบ ^(?:…)$ ให้เอง · ค่าที่ปล่อยผ่านยังถูกบันทึกว่า allowlisted: true แต่ไม่มีค่าจริงอยู่ในบันทึก"
      left={
        <>
          <MessageInput
            id="s6-input"
            label="ข้อความที่ AI ตอบลูกค้า (ขาออก)"
            value={text}
            onChange={setText}
          />
          <Panel>
            <Label htmlFor="s6-exact">allowlist.exact · บรรทัดละค่า</Label>
            <Textarea
              id="s6-exact"
              rows={3}
              className="font-mono text-xs"
              value={exact}
              onChange={(e) => setExact(e.target.value)}
            />
            <Label htmlFor="s6-pattern">allowlist.pattern (ไม่บังคับ)</Label>
            <Input
              id="s6-pattern"
              className="font-mono text-xs"
              placeholder="เช่น .*@myshop\.co\.th"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              <Chip onClick={() => setPattern('.*@myshop\\.co\\.th')}>ทุกอีเมลของร้าน</Chip>
              <Chip onClick={() => setPattern('0')}>pattern "0"</Chip>
              <Chip onClick={() => setPattern('a)|(b')}>pattern ที่หลุดการครอบ</Chip>
              <Chip
                onClick={() => {
                  setExact('')
                  setPattern('')
                }}
              >
                ไม่มี allowlist
              </Chip>
            </div>
          </Panel>
        </>
      }
      right={body}
    />
  )
}

// ===================================================================== 8 · audit
export function StepAudit() {
  const [text, setText] = React.useState('เลขบัตร 3-1005-00123-45-8 เบอร์ 091-888-7777 ค่ะ')
  const [broken, setBroken] = React.useState(false)
  const ok = React.useMemo(
    () =>
      guardWith({ PHONE: { action: 'mask', keep: 'last4' }, TH_NATIONAL_ID: { action: 'redact' } }),
    [],
  )
  const errors = React.useRef(0)
  const brokenGuard = React.useMemo(
    () =>
      P.createGuard({
        policy: P.definePolicy({
          entitySet: '0.2',
          entities: {
            PHONE: { action: 'mask', keep: 'last4' },
            TH_NATIONAL_ID: { action: 'redact' },
          },
        }),
        onAudit: () => {
          throw new Error('log pipeline down')
        },
        onError: () => {
          errors.current++
        },
      }),
    [],
  )
  const [shown, setShown] = React.useState<{
    text: string
    r: ProcessResult
    ev: AuditRecord | undefined
    broken: boolean
  } | null>(null)
  const run = React.useCallback(() => {
    if (broken) {
      setShown({ text, r: brokenGuard.processSync(text), ev: undefined, broken: true })
      return
    }
    const before = ok.events.length
    const r = ok.guard.processSync(text, {
      sessionId: 'conv_8f2a',
      ref: `msg_${10300 + ok.events.length}`,
    })
    setShown({ text, r, ev: ok.events[before], broken: false })
  }, [broken, brokenGuard, ok, text])
  React.useEffect(() => run(), [broken])

  let body: React.ReactNode = null
  if (shown?.broken) {
    body = (
      <>
        <Panel title="ข้อความยังผ่าน">
          <AiView original={shown.text} result={shown.r} />
        </Panel>
        <Panel title="แต่ถูกนับ ไม่หายเงียบ">
          <p>
            guard.stats.auditSinkErrors ={' '}
            <b className="tabular-nums">{brokenGuard.stats.auditSinkErrors}</b>
          </p>
          <p>
            onError ถูกเรียก <b className="tabular-nums">{errors.current}</b> ครั้ง
          </p>
          <Hint>นับรวม policy.loaded ที่หายไปตอนสร้าง guard 1 ครั้ง</Hint>
        </Panel>
      </>
    )
  } else if (shown?.ev) {
    const ev = shown.ev
    const blob = JSON.stringify(ev)
    const findings = (ev as { findings?: { start: number; end: number }[] }).findings ?? []
    const values = findings.map((f) => shown.text.slice(f.start, f.end))
    const leaked = values.filter((v) => blob.includes(v) || blob.includes(v.replace(/[\s-]/g, '')))
    const loaded = ok.events[0]
    body = (
      <>
        <Panel title="ค่าจริงอยู่ในบันทึกไหม">
          {values.length === 0 ? (
            <Hint>ข้อความนี้ไม่มีข้อมูลส่วนบุคคล</Hint>
          ) : leaked.length === 0 ? (
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant="success">ไม่มี</Badge> ค้นหาทั้ง {values.length} ค่าในบันทึกแล้ว ไม่เจอสักค่า
            </p>
          ) : (
            <p className="flex items-center gap-2">
              <Badge variant="destructive">เจอ</Badge> {leaked.join(', ')}
            </p>
          )}
        </Panel>
        <Panel title="บันทึกที่ onAudit ได้รับ">
          <Json value={ev} />
        </Panel>
        {loaded ? (
          <Panel title="บันทึกแรกตอนสร้าง guard · policy.loaded">
            <Hint>บอกว่า policy.hash ข้างบนคือกฎอะไร · เกิดครั้งเดียวต่อ guard</Hint>
            <Accordion type="single" collapsible>
              <AccordionItem value="loaded">
                <AccordionTrigger>policy.loaded</AccordionTrigger>
                <AccordionContent>
                  <Json value={loaded} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Panel>
        ) : null}
      </>
    )
  }

  return (
    <Step
      eyebrow="บันทึกตรวจสอบ (audit)"
      title="บันทึกทุกครั้ง โดยไม่มีค่าจริงอยู่ข้างใน"
      lede="หน้านี้ค้นให้ดูสด ๆ ว่าค่าที่เจอในข้อความไม่อยู่ในบันทึก (audit event) เลย"
      foot="ref คือ id ข้อความในระบบของแอป บันทึกไม่มีค่าจริง แต่ชี้กลับไปหาข้อความต้นทางได้ · ถ้าระบบบันทึกพัง ข้อความยังผ่าน แต่ไม่หายเงียบ ระบบนับไว้ใน guard.stats และแจ้ง onError · บันทึกต้องเก็บแยกจากข้อความต้นฉบับ เพราะตำแหน่งบวกข้อความเดิมประกอบกลับเป็นค่าจริงได้"
      left={
        <MessageInput id="s8-input" label="ข้อความจากลูกค้า" value={text} onChange={setText}>
          <div className="flex items-center gap-2">
            <Switch id="s8-broken" checked={broken} onCheckedChange={setBroken} />
            <Label htmlFor="s8-broken" className="font-normal">
              จำลองว่าระบบบันทึกพัง (onAudit throw)
            </Label>
          </div>
          <div>
            <Button type="button" onClick={run}>
              ส่งข้อความ
            </Button>
          </div>
        </MessageInput>
      }
      right={body}
    />
  )
}
