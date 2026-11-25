import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { createStreamGuard, protectStream } from '../src/stream.js'
import type { AuditEvent, PolicyInput } from '../src/types.js'

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rnd = () => number
const int = (r: Rnd, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const pick = <T>(r: Rnd, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const digits = (r: Rnd, n: number) => Array.from({ length: n }, () => int(r, 0, 9)).join('')

const FILLER = [
  'สวัสดีครับ อยากสอบถามเรื่องสินค้าหน่อยครับ',
  'ขอบคุณมากค่ะ ได้รับของเรียบร้อยแล้ว',
  'ราคา 250 บาท ส่งด่วน 2 ชิ้น',
  'Thanks, the order arrived on Monday and everything was fine.',
  'รบกวนแจ้งเลขพัสดุด้วยนะคะ',
]
const SENSITIVE: ((r: Rnd) => string)[] = [
  (r) => `เบอร์ 09${digits(r, 8)} นะครับ`,
  (r) => `โทร 0${int(r, 8, 9)}${digits(r, 1)}-${digits(r, 3)}-${digits(r, 4)} ค่ะ`,
  () => 'เลขบัตรประชาชน 3-1005-00123-45-8 ครับ',
  (r) => `อีเมล user${digits(r, 3)}@example.com ครับ`,
  (r) => `โอนเข้าเลขบัญชี ${digits(r, 3)}-${digits(r, 1)}-${digits(r, 5)}-${digits(r, 1)} ได้เลย`,
  () => 'บัตร 4111 1111 1111 1111 ค่ะ',
  () => 'ผมชื่อ สมชาย ใจดี ครับ',
  () => 'ที่อยู่ 99/12 ซอยลาดพร้าว 5 แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900',
  () => 'ส่งที่ 12 หมู่ 3 ตำบลสุเทพ อำเภอเมือง จังหวัดเชียงใหม่ 50200 นะคะ',
  (r) => `พร้อมเพย์ 09${digits(r, 8)}`,
]

function message(r: Rnd): string {
  const parts: string[] = []
  const n = int(r, 3, 9)
  for (let i = 0; i < n; i++) parts.push(r() < 0.45 ? pick(r, SENSITIVE)(r) : pick(r, FILLER))
  return parts.join(r() < 0.5 ? ' ' : '\n')
}

/** Cut anywhere, at every size from one character up. */
function chunks(r: Rnd, text: string, max: number): string[] {
  const out: string[] = []
  const chars = [...text]
  for (let i = 0; i < chars.length; ) {
    const n = int(r, 1, max)
    out.push(chars.slice(i, i + n).join(''))
    i += n
  }
  return out
}

function make(entities: PolicyInput['entities'], extra: Partial<PolicyInput> = {}) {
  const events: AuditEvent[] = []
  const guard = createGuard({
    policy: definePolicy({ entitySet: '0.1', onUnmapped: 'redact', entities, ...extra }),
    onAudit: (e) => {
      events.push(e as AuditEvent)
    },
  })
  return { guard, events }
}

async function streamed(guard: ReturnType<typeof make>['guard'], parts: string[], opts = {}) {
  const s = createStreamGuard(guard, opts)
  let out = ''
  for (const p of parts) out += await s.push(p)
  return out + (await s.end())
}

const N = Number(process.env.PDPA_N ?? 150)

describe('createStreamGuard', () => {
  it('gives what one call on the whole text gives, wherever the stream is cut', async () => {
    const { guard } = make({
      PHONE: { action: 'redact' },
      EMAIL: { action: 'mask' },
      BANK_ACCOUNT: { action: 'redact' },
    })
    const r = seeded(7)
    const misses: string[] = []
    for (let i = 0; i < N; i++) {
      const text = message(r)
      const whole = (await guard.process(text)).text
      const parts = chunks(r, text, [1, 3, 17, 90][i % 4] as number)
      const got = await streamed(guard, parts)
      if (got !== whole) misses.push(`${JSON.stringify(parts)}\nWHOLE ${whole}\nGOT   ${got}`)
    }
    expect(misses).toEqual([])
  })

  it('never lets a value through, whatever the chunk size', async () => {
    const { guard } = make({}, { onUnmapped: 'redact' })
    const r = seeded(11)
    for (let i = 0; i < N; i++) {
      const text = message(r)
      const got = await streamed(guard, chunks(r, text, [1, 2, 5, 40][i % 4] as number))
      expect(got).not.toMatch(/09\d{8}|3-1005-00123-45-8|4111 1111 1111 1111|@example\.com/)
    }
  })

  it('holds the end back, and says nothing newer than holdBack until the stream ends', async () => {
    const { guard } = make({ PHONE: { action: 'redact' } })
    const s = createStreamGuard(guard, { holdBack: 40 })
    const filler = 'ขอบคุณมากค่ะ '.repeat(10)
    const first = await s.push(`${filler}เบอร์ 0918`)
    expect(first.length).toBeLessThanOrEqual(filler.length + 8 - 40 + 1)
    const rest = (await s.push('887777 ค่ะ')) + (await s.end())
    expect(first + rest).not.toContain('0918887777')
    expect(first + rest).not.toContain('887777')
  })

  it('does not split a value that arrives one character at a time', async () => {
    const { guard } = make({ PHONE: { action: 'redact' } })
    const got = await streamed(guard, [...'ติดต่อ เบอร์ 091-888-7777 ได้เลยค่ะ'])
    expect(got).not.toMatch(/888/)
  })

  it('stops and says so when a block rule fires; later chunks return nothing', async () => {
    const { guard } = make({ CREDIT_CARD: { action: 'block' } })
    const s = createStreamGuard(guard, { holdBack: 10 })
    let out = await s.push('บัตร 4111 1111 1111 1111 ค่ะ ')
    out += await s.push('ขอบคุณ'.repeat(20))
    out += await s.end()
    expect(s.blocked).toBe(true)
    expect(s.blockedBy).toEqual(['CREDIT_CARD'])
    expect(out).not.toContain('4111')
    expect(await s.push('ต่อ')).toBe('')
  })

  it('works on a stream with no spaces, by cutting at maxPending', async () => {
    const { guard } = make({ PHONE: { action: 'redact' } })
    const text = `${'ก'.repeat(300)}0918887777${'ข'.repeat(300)}`
    const got = await streamed(guard, chunks(seeded(3), text, 25), { maxPending: 100 })
    expect(got).not.toContain('0918887777')
    expect(got.replace(/\[[^\]]*\]/g, '').replace(/[^กข]/g, '').length).toBe(600)
  })

  it('writes audit events with no real value in them', async () => {
    const { guard, events } = make({ PHONE: { action: 'redact' } })
    await streamed(guard, chunks(seeded(5), 'เบอร์ 0918887777 ค่ะ '.repeat(20), 9))
    expect(events.length).toBeGreaterThan(1)
    expect(JSON.stringify(events)).not.toContain('0918887777')
  })

  it('rejects settings that cannot work', () => {
    const { guard } = make({})
    expect(() => createStreamGuard(guard, { holdBack: -1 })).toThrow(RangeError)
    expect(() => createStreamGuard(guard, { maxPending: 0 })).toThrow(RangeError)
  })
})

describe('createStreamGuard on the way out', () => {
  it('turns a token into the masked value even when the stream cuts through it', async () => {
    const events: AuditEvent[] = []
    const guard = createGuard({
      policy: definePolicy({
        entitySet: '0.1',
        entities: {
          PHONE: {
            action: 'tokenise',
            allowedPurposes: ['otp_send'],
            display: 'mask',
          },
        },
      }),
      onAudit: (e) => {
        events.push(e as AuditEvent)
      },
    })
    const sessionId = 'conv_a'
    const inbound = await guard.process('เบอร์ 091-888-7777 ค่ะ', { sessionId })
    const token = /\[tok:[a-z0-9]+\]/.exec(inbound.text)?.[0] as string
    expect(token).toBeDefined()
    const reply = `${'รับทราบค่ะ '.repeat(15)}จะส่งรหัสไปที่ ${token} นะคะ ${'ขอบคุณค่ะ '.repeat(15)}`
    for (const size of [1, 2, 7, 33]) {
      const got = await streamed(guard, chunks(seeded(size), reply, size), {
        sessionId,
        boundary: 'outbound',
      })
      expect(got).not.toContain('tok:')
      expect(got).toContain('7777')
      expect(got).not.toContain('091-888')
    }
  })
})

describe('protectStream', () => {
  it('protects an async iterable', async () => {
    const { guard } = make({ PHONE: { action: 'redact' } })
    async function* src() {
      for (const p of chunks(seeded(9), 'ติดต่อ เบอร์ 0918887777 ได้เลยค่ะ', 4)) yield p
    }
    let out = ''
    for await (const t of protectStream(src(), guard)) out += t
    expect(out).not.toContain('0918887777')
    expect(out).toContain('ติดต่อ')
  })
})
