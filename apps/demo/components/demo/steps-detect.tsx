'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DEFAULT_THRESHOLD, DEMO_KEY, ent, guardWith, P, type Rules, why } from '@/lib/pdpa'
import {
  AiView,
  ErrorBox,
  Fn,
  Hint,
  Marked,
  MessageInput,
  Panel,
  type Preset,
  Stage,
  Step,
} from './parts'

const engine = P.createEngine(P.BUILTIN_DETECTORS)

// ===================================================================== 1 · overview
export function StepOverview() {
  const [text, setText] = React.useState('เลขบัตร ๓-๑๐๐๕-๐๐๑๒๓-๔๕-๘ เบอร์ ๐๙๑-๘๘๘-​๗๗๗๗ ค่ะ')
  const { guard } = React.useMemo(
    () =>
      guardWith({ TH_NATIONAL_ID: { action: 'redact' }, PHONE: { action: 'mask', keep: 'last4' } }),
    [],
  )
  const norm = P.normalise(text)
  const det = engine.runSync(norm, { sessionId: 'demo', boundary: 'inbound' })
  const r = guard.processSync(text)
  const dropped = norm.original.length - norm.text.length
  const fixes: string[] = []
  if (dropped > 0) fixes.push(`ลบอักขระที่มองไม่เห็น ${dropped} ตัว`)
  if (/[๐-๙０-９]/.test(text)) fixes.push('เปลี่ยนเลขไทยและเลขตัวกว้างเป็นเลขปกติ')

  const insertInvisible = () => {
    const ta = document.getElementById('s1-input') as HTMLTextAreaElement | null
    const at = ta?.selectionStart ?? text.length
    setText(`${text.slice(0, at)}​${text.slice(at)}`)
  }

  return (
    <Step
      eyebrow="ภาพรวม"
      title="ก่อนถึง AI ทุกข้อความผ่าน 3 ขั้น"
      lede="ทำความสะอาด → หาข้อมูลส่วนบุคคล → ปิดตามกติกาของร้าน · ลองพิมพ์เลขไทย หรือแทรกอักขระที่มองไม่เห็นเข้าไปกลางเบอร์"
      foot="พอลบอักขระที่มองไม่เห็นออก ตำแหน่งตัวอักษรจะเลื่อน guard จึงคำนวณตำแหน่งกลับไปที่ข้อความต้นฉบับก่อนปิด ส่วนที่ไม่ใช่ข้อมูลส่วนบุคคลจึงเหมือนที่ลูกค้าพิมพ์ทุกตัวอักษร"
      left={
        <>
          <MessageInput
            id="s1-input"
            label="ข้อความจากลูกค้า"
            value={text}
            onChange={setText}
            presets={[
              {
                label: 'เลขไทย + อักขระล่องหน',
                text: 'เลขบัตร ๓-๑๐๐๕-๐๐๑๒๓-๔๕-๘ เบอร์ ๐๙๑-๘๘๘-​๗๗๗๗ ค่ะ',
              },
              { label: 'เลขตัวกว้าง', text: 'เบอร์ ０９１８８８７７７７ ค่ะ' },
              { label: 'เลขปกติ', text: 'เลขบัตร 3-1005-00123-45-8 เบอร์ 091-888-7777' },
              {
                label: 'ทะเบียนรถ + วันเกิด',
                text: 'ทะเบียนรถ กข 1234 กรุงเทพมหานคร วันเกิด 12 พ.ค. 2530 ค่ะ',
              },
            ]}
          >
            <div>
              <Button type="button" size="sm" variant="outline" onClick={insertInvisible}>
                แทรกอักขระที่มองไม่เห็นตรงเคอร์เซอร์
              </Button>
            </div>
          </MessageInput>
          <Panel title="กติกาที่ใช้ในหน้านี้">
            <Table>
              <TableBody>
                {[
                  ['เลขบัตรประชาชน', 'ลบออก', 'redact'],
                  ['เบอร์โทร', 'เหลือ 4 ตัวท้าย', 'mask · keep: last4'],
                  ['ประเภทอื่น', 'ลบออก', 'onUnmapped: redact'],
                ].map(([who, what, code]) => (
                  <TableRow key={who}>
                    <TableCell>{who}</TableCell>
                    <TableCell className="font-semibold">{what}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {code}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        </>
      }
      right={
        <>
          <Stage n="·" title="ข้อความที่ลูกค้าพิมพ์">
            <Marked text={text} />
          </Stage>
          <Stage
            n="1"
            title={
              <>
                ทำความสะอาด <Fn>normalise()</Fn>
              </>
            }
          >
            <Marked text={norm.text} />
            <Hint>{fixes.length ? fixes.join(' · ') : 'ไม่มีอะไรต้องแก้'}</Hint>
          </Stage>
          <Stage
            n="2"
            title={
              <>
                หาข้อมูลส่วนบุคคล <Fn>engine.runSync()</Fn>
              </>
            }
          >
            <Marked
              text={norm.text}
              marks={det.candidates.map((c) => ({
                start: c.start,
                end: c.end,
                tone: ent(c.entity).tone,
                tag: `${ent(c.entity).label} · ${c.confidence}`,
              }))}
            />
            <Hint>
              {det.candidates.length === 0
                ? 'ไม่เจอข้อมูลส่วนบุคคล'
                : `เจอ ${det.candidates.length} รายการ · ตัวเลขหลังชื่อประเภทคือความมั่นใจ (0–1) ลงมือเมื่อถึง ${DEFAULT_THRESHOLD}`}
            </Hint>
          </Stage>
          <Stage
            n="3"
            title={
              <>
                ปิดตามกติกา · สิ่งที่ AI ได้เห็น <Fn>guard.processSync()</Fn>
              </>
            }
          >
            <AiView original={text} result={r} />
          </Stage>
        </>
      }
    />
  )
}

// ===================================================================== 2 · detectors
const DETECT_PRESETS: Preset[] = [
  { label: 'บัตรประชาชน', text: 'เลขบัตรประชาชน 3-1005-00123-45-8', note: 'หลักตรวจถูก · มั่นใจ 0.99' },
  {
    label: 'หลักตรวจผิด',
    text: 'เลขบัตรประชาชน 3-1005-00123-45-1',
    note: 'รูปแบบเหมือน แต่หลักตรวจผิด · 0.2',
  },
  { label: 'บัตร Visa', text: 'บัตร 4111 1111 1111 1111', note: 'Luhn ผ่าน · ผู้ออกบัตรรู้จัก · 0.98' },
  { label: 'ผู้ออกบัตรไม่รู้จัก', text: 'เลขอ้างอิง 9999 9999 9999 9995', note: 'Luhn ผ่านโดยบังเอิญ · 0.6' },
  { label: 'อีเมล', text: 'ส่งใบเสร็จมาที่ somchai@example.com ด้วยค่ะ' },
  { label: 'LINE user', text: 'ลูกค้า U0123456789abcdef0123456789abcdef ค่ะ' },
  {
    label: 'LINE group',
    text: 'กลุ่ม C0123456789abcdef0123456789abcdef',
    note: 'ระบุห้อง ไม่ใช่คน · ไม่จับ',
    whyNot: 'ขึ้นต้นด้วย C คือรหัสกลุ่มแชท ไม่ได้ระบุตัวคน จึงไม่ใช่ข้อมูลส่วนบุคคล',
  },
  { label: 'เบอร์ +66', text: 'โทรหาผมที่ +66 91 888 7777 ครับ' },
  { label: 'เลขบัญชี', text: 'โอนมาที่ กสิกร 123-4-56789-0 นะครับ' },
  { label: 'เลขเดียวกัน ใต้คำว่าบัญชี', text: 'เลขบัญชี 0812345678', note: 'เบอร์โทรถอนตัว ให้เลขบัญชีจับแทน' },
  { label: 'ทะเบียนรถ', text: 'ทะเบียนรถ กข 1234 กรุงเทพมหานคร' },
  { label: 'วันเกิด', text: 'วันเกิด 12 พ.ค. 2530 ค่ะ' },
  { label: 'พาสปอร์ต', text: 'เลขพาสปอร์ต AA1234567' },
  { label: 'พาสปอร์ตไม่มีคำบอก', text: 'AA1234567', note: 'มั่นใจ 0.6 · ไม่ถึงเกณฑ์' },
  {
    label: 'เลขออเดอร์',
    text: 'เลขที่ออเดอร์ 8829301847 ราคา 250 บาท',
    note: 'ไม่มีคำว่าบัญชี · ไม่จับ',
    whyNot: 'ไม่ขึ้นต้นด้วย 0 จึงไม่ใช่เบอร์ และไม่มีคำว่า บัญชี หรือชื่อธนาคาร จึงไม่ใช่เลขบัญชี',
  },
]

export function StepDetect() {
  const [text, setText] = React.useState('เลขบัตร 3-1005-00123-45-8 บัตร 4111 1111 1111 1111')
  const norm = P.normalise(text)
  const det = engine.runSync(norm, { sessionId: 'demo', boundary: 'inbound' })
  const preset = DETECT_PRESETS.find((p) => p.text === text)
  return (
    <Step
      eyebrow="ตัวตรวจ 9 ประเภท"
      title="ตัวตรวจเห็นอะไร และมั่นใจแค่ไหน"
      lede={`แสดงทุกอย่างที่ตัวตรวจเจอ รวมถึงรายการที่มั่นใจไม่ถึงเกณฑ์ ${DEFAULT_THRESHOLD} ซึ่ง guard จะปล่อยไว้`}
      foot="เลขบัตรประชาชนกับบัตรเครดิตยืนยันด้วยหลักตรวจ (mod-11 · Luhn) · อีเมลกับ LINE ID ดูจากรูปแบบ · เบอร์โทรกับเลขบัญชีไม่มีหลักตรวจ จึงอ่านคำรอบข้างประกอบ · ทะเบียนรถ วันเกิด และพาสปอร์ต ต้องมีคำบอกใบ้ เช่น ทะเบียน วันเกิด พาสปอร์ต จึงจะลงมือ"
      left={
        <>
          <MessageInput
            id="s2-input"
            label="ข้อความ · กดตัวอย่างด้านล่าง หรือพิมพ์เอง"
            value={text}
            onChange={setText}
            presets={DETECT_PRESETS}
          />
          <Hint>ชี้ที่ปุ่มตัวอย่างค้างไว้เพื่อดูว่าควรได้ผลอะไร</Hint>
        </>
      }
      right={
        <>
          <Panel title="ข้อความ">
            <Marked
              text={norm.text}
              marks={det.candidates.map((c) => ({
                start: c.start,
                end: c.end,
                tone: ent(c.entity).tone,
                tag: ent(c.entity).label,
              }))}
            />
          </Panel>
          <Panel title="สิ่งที่ตัวตรวจเจอ · ก่อนดูกติกา">
            {det.candidates.length === 0 ? (
              <>
                <Hint>ไม่เจออะไร · ข้อความนี้ผ่านไปโดยไม่แก้</Hint>
                {preset?.whyNot ? <p className="text-sm">ทำไมไม่จับ: {preset.whyNot}</p> : null}
              </>
            ) : null}
            {det.candidates.map((c, i) => {
              const meta = ent(c.entity)
              const value = norm.text.slice(c.start, c.end)
              const acts = c.confidence >= DEFAULT_THRESHOLD
              return (
                <div
                  key={`${c.start}-${i}`}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b py-3 last:border-b-0"
                >
                  <mark className={`hl e-${meta.tone}`}>{meta.label}</mark>
                  <span className="truncate font-mono text-sm">{value}</span>
                  <Badge variant={acts ? 'success' : 'secondary'}>
                    {acts ? 'ปิด' : 'ไม่ถึงเกณฑ์ ปล่อยไว้'}
                  </Badge>
                  <p className="col-span-2 col-start-2 text-sm">
                    {acts ? 'เพราะ ' : 'เจอแต่ไม่มั่นใจ: '}
                    {why(c, value)}
                  </p>
                  <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="tabular-nums">ความมั่นใจ {c.confidence.toFixed(2)}</span>
                    <div className="relative w-36">
                      <Progress
                        value={Math.round(c.confidence * 100)}
                        tone={acts ? 'brand' : 'warning'}
                        size="sm"
                        aria-label={`ความมั่นใจ ${c.confidence} จากเกณฑ์ ${DEFAULT_THRESHOLD}`}
                      />
                      <span
                        className="absolute -top-1 -bottom-1 w-0.5 bg-foreground"
                        style={{ left: `${DEFAULT_THRESHOLD * 100}%` }}
                        aria-hidden
                      />
                    </div>
                    <span>ตัวตรวจ {c.detector}</span>
                  </div>
                </div>
              )
            })}
          </Panel>
        </>
      }
    />
  )
}

// ===================================================================== 3 · six actions
const ACTIONS = [
  { a: 'redact', when: 'ลบค่าออก ใส่ชื่อประเภทแทน · ไม่เหลือส่วนไหนของค่าเดิม' },
  { a: 'mask', when: 'เปลี่ยนตัวเลขเป็น x แต่คงขีดและเว้นวรรค · ใส่ keep: last4 จะเหลือ 4 ตัวท้าย' },
  {
    a: 'tokenise',
    when: 'แทนด้วยรหัสสุ่ม ค่าจริงเก็บไว้ฝั่ง server · ค่าเดิมในห้องแชทเดิมได้รหัสเดิม · tool ที่ได้รับอนุญาตแลกคืนได้ภายในเวลาที่กำหนด',
  },
  {
    a: 'hash',
    when: 'แทนด้วยลายนิ้วมือของค่า (HMAC) · ค่าเดียวกันได้ผลเดียวกันเสมอ แม้พิมพ์ต่างรูปแบบ · ถ้าไม่มี key ย้อนกลับไม่ได้',
  },
  { a: 'flag', when: 'ไม่แก้ข้อความ ส่งต่อตามเดิม · แต่บันทึกว่าเจออะไร ตรงไหน' },
  { a: 'block', when: 'ไม่ส่งข้อความนี้เลย คืนข้อความว่าง · บอกใน blockedBy ว่าเจอประเภทไหน' },
] as const

export function StepActions() {
  const [text, setText] = React.useState('ขอเปลี่ยนเบอร์เป็น 091-888-7777 ค่ะ')
  const [keep, setKeep] = React.useState(true)
  return (
    <Step
      eyebrow="วิธีปิด 6 แบบ"
      title="ข้อความเดียวกัน ปิดได้ 6 แบบ"
      lede="เปลี่ยนแค่วิธีปิดเบอร์โทร (action) · ข้อมูลประเภทอื่นถูกลบออกตามค่าเริ่มต้น"
      foot="token และ hash เป็นตัวอักษรล้วน ไม่มีตัวเลข ส่งผ่าน guard ซ้ำก็ไม่ถูกจับอีก · block คืนข้อความว่าง ถึงแอปจะลืมเช็คผล ก็ไม่มีอะไรหลุดออกไป"
      left={
        <MessageInput
          id="s3-input"
          label="ข้อความจากลูกค้า"
          value={text}
          onChange={setText}
          presets={[
            { label: 'เบอร์อย่างเดียว', text: 'ขอเปลี่ยนเบอร์เป็น 091-888-7777 ค่ะ' },
            { label: 'เบอร์เลขไทย', text: 'ขอเปลี่ยนเบอร์เป็น ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ' },
            { label: 'เบอร์ + อีเมล', text: 'เบอร์ 091-888-7777 อีเมล somchai@example.com' },
          ]}
        >
          <div className="flex items-center gap-2">
            <Switch id="s3-keep" checked={keep} onCheckedChange={setKeep} />
            <Label htmlFor="s3-keep" className="font-normal">
              mask เหลือ 4 ตัวท้าย (keep: last4)
            </Label>
          </div>
        </MessageInput>
      }
      right={
        <Panel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วิธี</TableHead>
                <TableHead>AI เห็น</TableHead>
                <TableHead>ผล</TableHead>
                <TableHead className="hidden xl:table-cell">ทำงานอย่างไร</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ACTIONS.map(({ a, when }) => {
                const rule: Rules['PHONE'] =
                  a === 'mask'
                    ? keep
                      ? { action: 'mask', keep: 'last4' }
                      : { action: 'mask' }
                    : a === 'tokenise'
                      ? { action: 'tokenise', allowedPurposes: ['otp_send'] }
                      : { action: a }
                let cell: React.ReactNode
                let state: React.ReactNode = null
                try {
                  const { guard } = guardWith(
                    { PHONE: rule },
                    a === 'hash' ? { hmacKey: DEMO_KEY } : {},
                  )
                  const r = guard.processSync(text, { sessionId: 'conv_demo' })
                  cell = <AiView original={text} result={r} />
                  state =
                    r.outcome === 'blocked' ? (
                      <Badge variant="destructive">blocked</Badge>
                    ) : (
                      <Badge variant="success">processed</Badge>
                    )
                } catch (e) {
                  cell = <ErrorBox error={e} />
                }
                return (
                  <TableRow key={a}>
                    <TableCell className="align-top font-mono font-semibold">
                      {a === 'mask' && keep ? 'mask · last4' : a}
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">
                      {cell}
                      <p className="mt-1 text-xs text-muted-foreground xl:hidden">{when}</p>
                    </TableCell>
                    <TableCell className="align-top">{state}</TableCell>
                    <TableCell className="hidden whitespace-normal align-top text-xs text-muted-foreground xl:table-cell">
                      {when}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Panel>
      }
    />
  )
}
