'use client'

import * as React from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { guardWith, P, type Rules } from '@/lib/pdpa'
import { AiView, ErrorBox, Fn, Hint, MessageInput, Panel, Step } from './parts'

const BROWSER_ACTIONS = ['redact', 'mask', 'flag', 'block', 'hash', 'tokenise'] as const
type BrowserAction = (typeof BROWSER_ACTIONS)[number]
const BROWSER_TYPES = ['TH_NATIONAL_ID', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'CREDIT_CARD'] as const

function ruleFor(action: BrowserAction): NonNullable<Rules['PHONE']> {
  if (action === 'tokenise') return { action, allowedPurposes: ['otp_send'] }
  return { action }
}

/** Step 9: the guard that runs on the customer's own device. */
export function StepBrowser() {
  const [text, setText] = React.useState('เบอร์ผม 091-888-7777 อีเมล somchai@example.com ค่ะ')
  const [action, setAction] = React.useState<BrowserAction>('redact')

  const entities = Object.fromEntries(BROWSER_TYPES.map((t) => [t, ruleFor(action)]))
  let body: React.ReactNode
  try {
    const guard = P.createBrowserGuard({
      policy: P.definePolicy({ entitySet: '0.2', onUnmapped: 'redact', entities }),
      onAudit: () => {},
    })
    const r = guard.processSync(text)
    body = (
      <>
        <Hint>นี่คือสิ่งที่ถูกส่งออกจากเครื่องลูกค้าไปที่เซิร์ฟเวอร์</Hint>
        <AiView original={text} result={r} />
      </>
    )
  } catch (e) {
    body = (
      <>
        <Hint>สร้างด่านไม่ได้ เพราะวิธีนี้ต้องใช้กุญแจหรือที่เก็บ token ซึ่งในเบราว์เซอร์ใครก็เปิดอ่านได้</Hint>
        <ErrorBox error={e} />
      </>
    )
  }

  return (
    <Step
      eyebrow="ในเบราว์เซอร์ · Release 0.3"
      title="ปิดข้อมูลตั้งแต่ก่อนออกจากเครื่องลูกค้า"
      lede="หน้านี้เองก็คือ “เบราว์เซอร์ของลูกค้า” ลองพิมพ์ แล้วดูว่าอะไรจะถูกส่งขึ้นเซิร์ฟเวอร์"
      foot="ด่านนี้เป็นความสะดวกของผู้ใช้และด่านแรก ไม่ใช่การป้องกันหลัก: คนที่ถือหน้าเว็บแก้หรือข้ามมันได้ ฝั่งเซิร์ฟเวอร์จึงต้องมี guard ของตัวเองเสมอ"
      left={
        <MessageInput
          id="s9-input"
          label="ข้อความที่ลูกค้าพิมพ์"
          value={text}
          onChange={setText}
          presets={[
            { label: 'เบอร์ + อีเมล', text: 'เบอร์ผม 091-888-7777 อีเมล somchai@example.com ค่ะ' },
            { label: 'เลขบัตร', text: 'เลขบัตรประชาชน 3-1005-00123-45-8 ค่ะ' },
            { label: 'บัตรเครดิต', text: 'จ่ายด้วยบัตร 4111 1111 1111 1111 ได้ไหมคะ' },
          ]}
        >
          <Label>วิธีปิด (action)</Label>
          <SegmentedControl
            aria-label="วิธีปิด"
            variant="brand"
            value={action}
            onValueChange={(v) => setAction(v as BrowserAction)}
            options={BROWSER_ACTIONS.map((a) => ({ value: a, label: a }))}
            className="w-max max-w-full overflow-x-auto"
          />
          <Hint>ใช้ได้ในเบราว์เซอร์: redact · mask · flag · block ส่วน hash และ tokenise ถูกปฏิเสธ</Hint>
        </MessageInput>
      }
      right={
        <>
          <Panel
            title={
              <>
                ผ่านด่านในเบราว์เซอร์
                <Fn>createBrowserGuard</Fn>
              </>
            }
          >
            {body}
          </Panel>
          <Alert>
            <AlertDescription>
              ใครเปิด DevTools ก็ข้ามด่านนี้ได้ ข้อความที่มาถึงเซิร์ฟเวอร์จึงต้องถูกตรวจซ้ำที่ฝั่ง server ด้วย{' '}
              <code className="font-mono">createGuard</code>
            </AlertDescription>
          </Alert>
        </>
      }
    />
  )
}

const SAMPLE_REPLY =
  'ขอบคุณที่แจ้งค่ะ เราจะส่งรหัสยืนยันไปที่เบอร์ 091-888-7777 และส่งใบเสร็จไปที่ somchai@example.com ภายในวันนี้ค่ะ ขอบคุณที่ใช้บริการนะคะ'
const CARD_REPLY =
  'ขอบคุณที่สั่งซื้อสินค้ากับร้านของเรานะคะ ตอนนี้ออเดอร์ของคุณลูกค้าอยู่ในขั้นตอนตรวจสอบรายการและยืนยันที่อยู่จัดส่งเรียบร้อยแล้วค่ะ ทางร้านจะแจ้งเลขพัสดุให้ทราบอีกครั้งเมื่อจัดส่ง ยืนยันการชำระเงินด้วยบัตร 4111 1111 1111 1111 เรียบร้อยแล้วค่ะ ขอบคุณที่ใช้บริการนะคะ'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Step 10: a reply that arrives a few characters at a time. */
export function StepStream() {
  const [text, setText] = React.useState(SAMPLE_REPLY)
  const [size, setSize] = React.useState('4')
  const [hold, setHold] = React.useState('128')
  const [block, setBlock] = React.useState(false)
  const [received, setReceived] = React.useState('')
  const [released, setReleased] = React.useState('')
  const [state, setState] = React.useState<'idle' | 'running' | 'done' | 'blocked'>('idle')
  const run = React.useRef(0)

  React.useEffect(
    () => () => {
      run.current++
    },
    [],
  )

  const play = async () => {
    const id = ++run.current
    setReceived('')
    setReleased('')
    setState('running')
    const { guard } = guardWith(block ? { CREDIT_CARD: { action: 'block' } } : {})
    const stream = P.createStreamGuard(guard, { holdBack: Number(hold) })
    const chars = [...text]
    for (let i = 0; i < chars.length; i += Number(size)) {
      const chunk = chars.slice(i, i + Number(size)).join('')
      setReceived((r) => r + chunk)
      const out = await stream.push(chunk)
      if (run.current !== id) return
      if (out) setReleased((r) => r + out)
      if (stream.blocked) {
        setState('blocked')
        return
      }
      await sleep(60)
      if (run.current !== id) return
    }
    const rest = await stream.end()
    if (run.current !== id) return
    if (rest) setReleased((r) => r + rest)
    setState(stream.blocked ? 'blocked' : 'done')
  }
  const stop = () => {
    run.current++
    setState('idle')
  }

  return (
    <Step
      eyebrow="สตรีม · Release 0.3"
      title="ข้อความที่ทยอยมาทีละนิด ก็ปิดได้"
      lede="AI ตอบทีละช่วงสั้น ๆ ด่านจะกั๊กท้ายสุดไว้ จนมั่นใจว่าไม่มีข้อมูลส่วนตัวครึ่ง ๆ กลาง ๆ แล้วค่อยปล่อย"
      foot="ราคาที่ต้องจ่าย: ผู้ใช้เห็นข้อความช้ากว่า AI เท่ากับส่วนที่กั๊กไว้ (holdBack) และถ้าเจอข้อมูลที่ต้อง block กลางทาง ส่วนที่ปล่อยไปแล้วเรียกคืนไม่ได้ ระบบหยุดส่งส่วนที่เหลือได้เท่านั้น"
      left={
        <MessageInput
          id="s10-input"
          label="คำตอบของ AI (ที่จะไหลมาทีละช่วง)"
          value={text}
          onChange={(v) => {
            stop()
            setText(v)
          }}
          rows={5}
          presets={[
            { label: 'เบอร์ + อีเมล', text: SAMPLE_REPLY },
            { label: 'บัตรเครดิต', text: CARD_REPLY },
          ]}
        >
          <Label>ขนาดแต่ละชิ้นที่ไหลมา (ตัวอักษร)</Label>
          <SegmentedControl
            aria-label="ขนาดชิ้น"
            variant="brand"
            value={size}
            onValueChange={setSize}
            options={['1', '4', '12'].map((v) => ({ value: v, label: v }))}
            className="w-max"
          />
          <Label>กั๊กท้ายไว้ (holdBack)</Label>
          <SegmentedControl
            aria-label="holdBack"
            variant="brand"
            value={hold}
            onValueChange={setHold}
            options={[
              { value: '0', label: '0 · ไม่กั๊ก' },
              { value: '32', label: '32' },
              { value: '128', label: '128 · ค่าเริ่มต้น' },
            ]}
            className="w-max max-w-full overflow-x-auto"
          />
          <div className="flex items-center gap-2">
            <Switch id="s10-block" checked={block} onCheckedChange={setBlock} />
            <Label htmlFor="s10-block" className="font-normal">
              บัตรเครดิต = block (ดูว่าเกิดอะไรกับส่วนที่ปล่อยไปแล้ว)
            </Label>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={play} disabled={state === 'running'}>
              เล่น
            </Button>
            <Button type="button" variant="outline" onClick={stop} disabled={state !== 'running'}>
              หยุด
            </Button>
          </div>
        </MessageInput>
      }
      right={
        <>
          <Panel title="AI ส่งมา (ยังไม่ผ่านด่าน)">
            <p className="min-h-[3.5em] whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-muted-foreground">
              {received || '—'}
            </p>
            <Hint>{[...received].length} ตัวอักษร</Hint>
          </Panel>
          <Panel
            title={
              <>
                ผู้ใช้เห็น (ผ่านด่านแล้ว)
                <Fn>createStreamGuard</Fn>
              </>
            }
          >
            <p className="min-h-[3.5em] whitespace-pre-wrap break-words text-base leading-relaxed">
              {released || '—'}
              {state === 'running' ? <span className="animate-pulse text-primary"> ▍</span> : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Hint>{[...released].length} ตัวอักษร (ตัวเลขน้อยกว่า เพราะค่าที่ปิดถูกแทนด้วยป้ายสั้น ๆ)</Hint>
              {state === 'done' ? <Badge variant="success">จบ</Badge> : null}
              {state === 'blocked' ? <Badge variant="destructive">ถูก block กลางทาง</Badge> : null}
            </div>
            {state === 'blocked' ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {released
                    ? 'ด่านหยุดส่งส่วนที่เหลือแล้ว แต่ข้อความข้างบนที่ผู้ใช้เห็นไปแล้วเรียกคืนไม่ได้ ถ้าห้ามหลุดแม้แต่นิดเดียว ให้ตรวจหลังข้อความจบ (process) แทน'
                    : 'รอบนี้ยังไม่มีอะไรหลุดออกไปเลย เพราะส่วนต้นยังถูกกั๊กไว้ แต่ถ้า block เจอช้ากว่านี้ ส่วนที่ปล่อยไปแล้วจะเรียกคืนไม่ได้ ลองกับตัวอย่าง “บัตรเครดิต” ที่บัตรอยู่ท้ายข้อความ'}
                </AlertDescription>
              </Alert>
            ) : null}
          </Panel>
        </>
      }
    />
  )
}
