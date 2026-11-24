'use client'

import * as React from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import examplePolicy from '../../../../examples/pdpa-policy.json'
import { AiView, ErrorBox, Fn, Hint, Json, Marked, MessageInput, Panel, Step } from './parts'

const EXAMPLE_POLICY = `${JSON.stringify(examplePolicy, null, 2)}\n`

function Rows({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r[0]}>
            {r.map((c, i) => (
              <TableCell
                key={c}
                className={i === 0 ? 'align-top font-mono text-xs' : 'whitespace-normal align-top'}
              >
                {c}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ===================================================================== 4 · the policy file
export function StepPolicy() {
  const [source, setSource] = React.useState(EXAMPLE_POLICY)
  const [msg, setMsg] = React.useState(
    'เลขบัตร 3-1005-00123-45-8 เบอร์ 091-888-7777 โอนเข้าบัญชี 123-4-56789-0 ติดต่อ support@myshop.co.th',
  )
  let body: React.ReactNode
  try {
    const events: AuditRecord[] = []
    const policy = P.parsePolicy(source)
    const guard = P.createGuard({ policy, hmacKey: DEMO_KEY, onAudit: (e) => void events.push(e) })
    const r = guard.processSync(msg, { sessionId: 'conv_8f2a' })
    body = (
      <>
        <Panel title="เส้นทางของไฟล์นี้">
          <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm">
            <li>dev เขียน pdpa-policy.json</li>
            <li>commit ลง git · รีวิวเหมือนโค้ด</li>
            <li>server เริ่ม → parsePolicy() ตรวจไฟล์ → createGuard() → บันทึก policy.loaded</li>
            <li>guard ใช้กฎนี้กับทุกข้อความ จนกว่าจะ deploy ใหม่</li>
            <li>แก้กฎ = แก้ไฟล์ → รีวิว → deploy · hash เปลี่ยน</li>
          </ol>
        </Panel>
        <Panel title="โหลดแล้ว">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="success">โหลดผ่าน</Badge> policy.hash{' '}
            <b className="font-mono">{policy.hash}</b>
          </p>
          <Hint>ทุกบันทึกมี hash นี้ · แก้ไฟล์ทางซ้ายแม้ตัวเดียว hash จะเปลี่ยน</Hint>
          <Accordion type="single" collapsible>
            <AccordionItem value="loaded">
              <AccordionTrigger>บันทึกแรก: policy.loaded</AccordionTrigger>
              <AccordionContent>
                <Hint>
                  guard บันทึกกฎฉบับเต็มครั้งเดียวตอนสร้าง · ค่าใน allowlist.exact ถูกเก็บเป็น sha256 ไม่ใช่ค่าจริง
                </Hint>
                <Json value={events[0]} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Panel>
        <Panel>
          <Label htmlFor="sp-msg">ลองส่งข้อความผ่านกติกานี้</Label>
          <Textarea id="sp-msg" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} />
          <h3 className="text-sm font-semibold text-muted-foreground">AI เห็น</h3>
          <AiView original={msg} result={r} />
          <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
            {r.findings.map((f) => (
              <li key={`${f.start}`}>
                <span className="font-mono">{f.entity}</span> →{' '}
                <b>{f.allowlisted ? 'ปล่อยผ่าน (allowlist)' : f.action}</b>
              </li>
            ))}
          </ul>
        </Panel>
      </>
    )
  } catch (e) {
    body = (
      <Panel title="โหลดกติกา">
        <ErrorBox error={e} />
        <Hint>โหลดไม่ผ่าน = server ไม่ยอมเริ่ม · ดีกว่าไปพังตอนข้อความแรกของลูกค้า</Hint>
      </Panel>
    )
  }
  return (
    <Step
      eyebrow="กติกา (policy)"
      title="กติกาของร้านอยู่ในไฟล์เดียว"
      lede="บอกว่าเจอข้อมูลแต่ละประเภทแล้วให้ทำอะไร · เขียนครั้งเดียว รีวิวเหมือนโค้ด แล้ว guard โหลดตอน server เริ่ม"
      foot="ไฟล์นี้คือ examples/pdpa-policy.json ใน repo และมีเทสต์บังคับว่าต้องโหลดผ่านเสมอ · hmacKey ไม่อยู่ในไฟล์นี้ เพราะไฟล์ถูก commit ลง git ส่วน key ต้องอ่านจาก secret"
      left={
        <>
          <Panel>
            <Label htmlFor="sp-policy">pdpa-policy.json · แก้ได้</Label>
            <Textarea
              id="sp-policy"
              rows={18}
              value={source}
              spellCheck={false}
              onChange={(e) => setSource(e.target.value)}
              className="font-mono text-xs"
            />
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSource(EXAMPLE_POLICY)}
              >
                คืนค่าตัวอย่าง
              </Button>
            </div>
          </Panel>
          <Panel title="ช่องบนสุดของไฟล์">
            <Rows
              head={['ช่อง', 'ทำอะไร']}
              rows={[
                ['entitySet', 'เขียนสำหรับตัวตรวจชุดไหน · บังคับ · อัปเดตไลบรารีแล้วมีข้อมูลประเภทใหม่ ร้านจะรู้'],
                ['onUnmapped', 'เจอข้อมูลประเภทที่ไม่ได้เขียนกฎไว้ ให้ทำอะไร · ค่าเริ่มต้น redact'],
                ['placeholderLanguage', 'th → [เบอร์โทร] · en → [phone]'],
                ['entities', 'กฎของข้อมูลแต่ละประเภท: action และตัวเลือกของ action นั้น'],
                ['allowlist', 'ค่าที่ไม่ต้องปิด เช่นอีเมลและเบอร์ของร้านเอง'],
                ['$schema', 'ให้ editor ตรวจไฟล์ตอนพิมพ์ · guard ไม่ใช้'],
              ]}
            />
          </Panel>
          <Panel title="ช่องในกฎของแต่ละประเภท (entities)">
            <Rows
              head={['ช่อง', 'ใช้กับ', 'ทำอะไร']}
              rows={[
                ['action', 'ทุกตัว · บังคับ', 'redact · mask · tokenise · hash · flag · block'],
                ['minConfidence', 'ทุกตัว', 'ความมั่นใจขั้นต่ำที่จะลงมือ · ค่าเริ่มต้น 0.95'],
                ['keep', 'mask', '"last4" เหลือ 4 ตัวท้าย · ไม่ใส่ = ปิดหมด'],
                ['allowedPurposes', 'tokenise · บังคับ', 'เหตุผลที่แลก token กลับได้'],
                ['ttlSec', 'tokenise', 'อายุ token 1–3600 วินาที · ค่าเริ่มต้น 300'],
                ['display', 'tokenise', 'ตอนตอบลูกค้า โชว์เป็น mask หรือ redact'],
              ]}
            />
            <Hint>ช่องที่ไม่มีในตาราง หรือใช้ผิด action เช่น keep กับ block → โหลดไม่ผ่าน</Hint>
          </Panel>
        </>
      }
      right={body}
    />
  )
}

// ===================================================================== 5 · tokens
type Loose = Record<string, unknown> & { type: string }

function summary(e: Loose): string {
  const f = (e.findings as Loose[] | undefined) ?? []
  if (e.type === 'policy.loaded') {
    const p = e.policy as { hash: string; entities: object }
    return `${p.hash} · กฎ ${Object.keys(p.entities).length} ประเภท`
  }
  if (e.type === 'scan') {
    const found = f
      .map((x) => `${x.entity}→${x.action}${x.tokenId ? ` (${x.tokenId})` : ''}`)
      .join(', ')
    return `${e.boundary} · ${e.sessionId} · ${e.outcome}${found ? ` · ${found}` : ''}`
  }
  return `${e.sessionId} · ${e.tokenId ?? 'null'} · purpose ${e.purpose} · ${e.outcome}${e.reason ? ` (${e.reason})` : ''}`
}

const RENDERED_AS: Record<string, ['success' | 'secondary' | 'destructive' | 'warning', string]> = {
  masked: ['success', 'token ของห้องนี้ ลูกค้าเห็นแบบปิดไว้'],
  placeholder: ['secondary', 'แสดงเป็นชื่อประเภท'],
  foreign: ['destructive', 'token ของห้องอื่น · ข้อมูลข้ามห้อง ต้องตามดู'],
  unknown: ['warning', 'token ที่ไม่มีอยู่ หมดอายุ หรือปลอม · อาจมีคนลองหลอก AI'],
}

export function StepTokens() {
  const [state, setState] = React.useState(() =>
    guardWith({ PHONE: { action: 'tokenise', ttlSec: 300, allowedPurposes: ['otp_send'] } }),
  )
  const [, rerender] = React.useReducer((n: number) => n + 1, 0)
  const [text, setText] = React.useState('ขอ OTP ที่เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ')
  const [sent, setSent] = React.useState<{ text: string; r: ProcessResult } | null>(null)
  const [token, setToken] = React.useState('')
  const [purpose, setPurpose] = React.useState('otp_send')
  const [caller, setCaller] = React.useState('otp-service')
  const [session, setSession] = React.useState('conv_8f2a')
  const [resolved, setResolved] = React.useState<React.ReactNode>(null)
  const [reply, setReply] = React.useState('')
  const [replied, setReplied] = React.useState<React.ReactNode>(null)
  const seq = React.useRef(10290)
  const nextRef = (kind: string) => `${kind}_${++seq.current}`

  const send = React.useCallback(
    (t: string) => {
      const r = state.guard.processSync(t, { sessionId: 'conv_8f2a', ref: `msg_${++seq.current}` })
      const tok = r.text.match(/\[tok:[a-z]{16}\]/)?.[0]
      if (tok) {
        setToken(tok)
        setReply(`ส่ง OTP ไปที่ ${tok} แล้วค่ะ`)
      }
      setSent({ text: t, r })
    },
    [state],
  )
  // Send the first message once, when the step opens (dev runs effects twice).
  const opened = React.useRef(false)
  React.useEffect(() => {
    if (opened.current) return
    opened.current = true
    send(text)
  }, [])

  const resolve = () => {
    const before = state.events.length
    const r = state.guard.resolveSync(token.trim(), {
      purpose,
      caller: caller || undefined,
      sessionId: session,
      ref: nextRef('call'),
    })
    const ev = state.events.slice(before).find((e) => e.type === 'token.resolve')
    setResolved(
      <>
        <Panel title="ผลที่ tool ได้">
          {r.ok ? (
            <p className="flex items-center gap-2">
              <Badge variant="success">ได้ค่า</Badge> <b className="font-mono">{r.value}</b>
            </p>
          ) : (
            <p className="flex items-center gap-2">
              <Badge variant="destructive">ถูกปฏิเสธ</Badge> <code>{r.reason}</code>
            </p>
          )}
        </Panel>
        <Panel title="บันทึกที่เกิดขึ้น">{ev ? <Json value={ev} /> : <Hint>—</Hint>}</Panel>
      </>,
    )
  }
  const answer = (t: string) => {
    setReply(t)
    const before = state.events.length
    const r = state.guard.processSync(t, {
      sessionId: session,
      boundary: 'outbound',
      ref: nextRef('msg'),
    })
    const ev = state.events.slice(before).find((e) => e.type === 'scan') as Loose | undefined
    const rendered = (ev?.rendered as Loose[] | undefined) ?? []
    setReplied(
      <Panel title="ลูกค้าเห็นใน LINE">
        <Marked text={r.text} />
        {rendered.length ? (
          <>
            <Hint>บันทึกทีละตัว (rendered) · ไม่มีค่าจริงและไม่มีรูปที่ปิดไว้</Hint>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>as</TableHead>
                  <TableHead>tokenId</TableHead>
                  <TableHead>แปลว่า</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rendered.map((x, i) => {
                  const [tone, note] = RENDERED_AS[String(x.as)] ?? ['secondary', '']
                  return (
                    <TableRow key={`${x.as}-${i}`}>
                      <TableCell>
                        <Badge variant={tone}>{String(x.as)}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {String(x.tokenId ?? '—')}
                      </TableCell>
                      <TableCell className="whitespace-normal">{note}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </>
        ) : (
          <Hint>ไม่มี token ให้แปลง</Hint>
        )}
      </Panel>,
    )
    rerender()
  }

  const events = state.events as unknown as Loose[]
  return (
    <Step
      eyebrow="token และการแลกค่าจริง"
      title="AI เห็นแค่ token · tool ที่ได้รับอนุญาตเท่านั้นแลกเบอร์จริงได้"
      lede="purpose ไม่ใช่รหัสผ่าน แต่เป็นเหตุผลที่กติกาอนุญาต · ทุกครั้งที่ขอแลกถูกบันทึก ทั้งที่ได้และที่ถูกปฏิเสธ"
      foot="ค่าเดิมในห้องแชทเดิมได้ token เดิม AI จึงไม่เข้าใจผิดว่ามีสองเบอร์ · แลกได้ค่าในรูปแบบมาตรฐาน 0918887777 ที่ tool ใช้ได้ทันที · ตอนตอบลูกค้า guard ขาออกแปลง token เป็นเบอร์ที่ปิดไว้ ลูกค้าไม่เห็น token และไม่เห็นเบอร์เต็ม · sessionId ควรเป็น id ห้องแชทที่ระบบสร้างเอง ไม่ใช่ LINE userId"
      left={
        <>
          <MessageInput
            id="s4-input"
            label="ข้อความจากลูกค้า (ห้องแชท conv_8f2a)"
            value={text}
            onChange={setText}
          >
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => send(text)}>
                ส่งผ่าน guard
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setText('ยืนยันเบอร์ 091-888-7777 อีกทีค่ะ')
                  send('ยืนยันเบอร์ 091-888-7777 อีกทีค่ะ')
                }}
              >
                ส่งเบอร์เดิมอีกครั้ง
              </Button>
            </div>
          </MessageInput>
          <Panel
            title={
              <>
                tool ขอแลก token <Fn>guard.resolveSync()</Fn>
              </>
            }
          >
            <Label htmlFor="s4-token">token</Label>
            <Input
              id="s4-token"
              className="font-mono"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Label>purpose · ขอไปทำอะไร</Label>
            <Select value={purpose} onValueChange={setPurpose}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="otp_send">otp_send · อยู่ใน allowedPurposes</SelectItem>
                <SelectItem value="marketing">marketing · ไม่อยู่</SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor="s4-caller">caller · ใครขอ</Label>
            <Input id="s4-caller" value={caller} onChange={(e) => setCaller(e.target.value)} />
            <Label>session · ใช้ทั้งตอนแลกค่าและตอนตอบลูกค้า</Label>
            <Select value={session} onValueChange={setSession}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conv_8f2a">ห้องแชทเดียวกัน (conv_8f2a)</SelectItem>
                <SelectItem value="conv_b71c">ห้องแชทอื่น (conv_b71c)</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={resolve}>
                แลกค่า
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  state.guard.endSession('conv_8f2a')
                  setResolved(
                    <Alert variant="brand">
                      <AlertDescription>
                        จบการสนทนาแล้ว · token ทั้งหมดของ conv_8f2a ถูกลบ ลองกดแลกค่าอีกครั้ง · endSession
                        ไม่สร้างบันทึก
                      </AlertDescription>
                    </Alert>,
                  )
                }}
              >
                จบการสนทนา (endSession)
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setState(
                    guardWith({
                      PHONE: { action: 'tokenise', ttlSec: 300, allowedPurposes: ['otp_send'] },
                    }),
                  )
                  setResolved(null)
                  setReplied(null)
                  setSent(null)
                }}
              >
                เริ่มใหม่
              </Button>
            </div>
          </Panel>
          <Panel title="AI ตอบลูกค้า · guard ขาออก (boundary: outbound)">
            <Label htmlFor="s4-reply">คำตอบที่ AI พิมพ์</Label>
            <Textarea
              id="s4-reply"
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {[
                ['มี token', `ส่ง OTP ไปที่ ${token} แล้วค่ะ`],
                ['AI ตัดวงเล็บออก', `ส่งไปที่ ${token.replace(/^\[|\]$/g, '')} แล้วค่ะ`],
                ['token ปลอม', 'ส่งไปที่ [tok:bcdfghjkmnpqrstv] แล้วค่ะ'],
                ['AI พิมพ์เบอร์เต็ม', 'เบอร์ของคุณคือ 091-888-7777 นะคะ'],
              ].map(([label, t]) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 rounded-full px-3 text-xs"
                  onClick={() => answer(t as string)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div>
              <Button type="button" onClick={() => answer(reply)}>
                ส่งคำตอบผ่าน guard
              </Button>
            </div>
            <Hint>เปลี่ยน session ด้านบนเป็นห้องอื่นแล้วส่ง จะเห็นว่าไม่ได้เบอร์ของห้องนี้</Hint>
          </Panel>
        </>
      }
      right={
        <>
          {sent ? (
            <Panel title="AI เห็น">
              <AiView original={sent.text} result={sent.r} />
              <Hint>token นี้อายุ 5 นาที (ttlSec: 300) · ค่าจริงอยู่ในที่เก็บฝั่ง server เท่านั้น</Hint>
            </Panel>
          ) : null}
          {resolved}
          {replied}
          <Panel title={`บันทึกทั้งหมดของห้องนี้ · ${events.length} รายการ`}>
            <Hint>
              กดแต่ละบรรทัดเพื่อดูบันทึกเต็ม · tokenId เชื่อมการออก token กับการแลกทีหลัง · ref คือ id ข้อความหรือ
              tool call ในระบบของแอป ใช้ตามกลับไปหาต้นทาง
            </Hint>
            <Accordion type="multiple">
              {events.map((e, i) => (
                <AccordionItem key={String(e.eventId ?? i)} value={String(i)}>
                  <AccordionTrigger className="text-left">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="tabular-nums">{i + 1}.</span>
                      <Badge
                        variant={
                          e.type === 'policy.loaded'
                            ? 'secondary'
                            : e.outcome === 'denied' || e.outcome === 'blocked'
                              ? 'destructive'
                              : 'success'
                        }
                      >
                        {e.type}
                      </Badge>
                      <span className="break-all font-mono text-xs font-normal">
                        {summary(e)}
                        {e.ref ? ` · ref ${e.ref}` : ''}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Json value={e} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Panel>
        </>
      }
    />
  )
}
