import { describe, expect, it } from 'vitest'
import { PdpaError } from '../src/errors.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { createMemoryTokenStore } from '../src/tokens/memory-store.js'
import type {
  AuditEvent,
  AuditRecord,
  Detector,
  GuardOptions,
  PolicyInput,
  ProcessOptions,
  TokenRecord,
  TokenStore,
} from '../src/types.js'
import { inSession } from './helpers/in-session.js'

const KEY = 'a3f1c9e07b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a'
const TOKEN = /\[tok:[bcdfghjkmnpqrstv]{16}\]/

const POLICY: PolicyInput = {
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] },
    TH_NATIONAL_ID: { action: 'redact' },
    BANK_ACCOUNT: { action: 'mask', keep: 'last4' },
    EMAIL: { action: 'hash' },
    CREDIT_CARD: { action: 'block' },
    LINE_USER_ID: { action: 'flag' },
  },
  allowlist: { exact: ['support@myshop.co.th'] },
}

/** The bundled memory store behind an async interface — what a Redis store looks like to the guard. */
function asyncStore(inner: TokenStore = createMemoryTokenStore()): TokenStore & { calls: number } {
  const s = {
    sync: false,
    calls: 0,
    async set(id: string, rec: TokenRecord) {
      s.calls++
      await Promise.resolve()
      inner.set(id, rec)
    },
    async get(id: string) {
      s.calls++
      await Promise.resolve()
      return inner.get(id) as TokenRecord | undefined
    },
    async delete(id: string) {
      inner.delete(id)
    },
    async clearSession(sessionId: string) {
      inner.clearSession(sessionId)
    },
  }
  return s
}

function build(extra: Partial<GuardOptions> = {}) {
  const events: AuditRecord[] = []
  const guard = inSession(
    createGuard({
      policy: definePolicy(POLICY),
      hmacKey: KEY,
      onAudit: (e) => events.push(e),
      ...extra,
    }),
  )
  const scans = () => events.filter((e): e is AuditEvent => e.type === 'scan')
  return { guard, events, scans }
}

const MESSAGES: [string, ProcessOptions][] = [
  ['เลขบัตร 3-1005-00123-45-8 ค่ะ', {}],
  ['บัญชี 123-4-56789-0 อีเมล somchai@example.com', { sessionId: 'conv_a' }],
  ['ติดต่อ support@myshop.co.th', { sessionId: 'conv_a', boundary: 'outbound' }],
  ['บัตร 4111 1111 1111 1111', { sessionId: 'conv_a' }],
  ['ลูกค้า U0123456789abcdef0123456789abcdef', { sessionId: 'conv_a', ref: 'msg_1' }],
  ['ไม่มีอะไรเลย', {}],
  ['อีเมล [EMAIL:bcdfghjkmnpqrstv]', { sessionId: 'conv_a', boundary: 'outbound' }],
]

describe('process() — the same rules as processSync', () => {
  it('gives the same result for every action, with no tokens involved', async () => {
    for (const [text, opts] of MESSAGES) {
      const a = build()
      const b = build()
      expect(await a.guard.process(text, opts)).toEqual(b.guard.processSync(text, opts))
      const strip = (e: AuditEvent) => ({ ...e, eventId: '', at: '', durationMs: 0 })
      expect(a.scans().map(strip)).toEqual(b.scans().map(strip))
    }
  })

  it('tokenises, resolves and renders through the sync store as well', async () => {
    const { guard } = build()
    const inbound = await guard.process('เบอร์ 091-888-7777', { sessionId: 'conv_a' })
    const tok = TOKEN.exec(inbound.text)?.[0] ?? ''
    expect(await guard.resolve(tok, { purpose: 'otp_send', sessionId: 'conv_a' })).toEqual({
      ok: true,
      value: '0918887777',
    })
    const out = await guard.process(`ส่งไปที่ ${tok}`, { sessionId: 'conv_a', boundary: 'outbound' })
    expect(out.text).toBe('ส่งไปที่ xxx-xxx-7777')
  })
})

describe('process() — an async token store (D10.2)', () => {
  it('works end to end: issue, reuse, resolve, render', async () => {
    const store = asyncStore()
    const { guard } = build({ tokenStore: store })

    const first = await guard.process('เบอร์ 091-888-7777', { sessionId: 'conv_a' })
    const again = await guard.process('เบอร์ ๐๙๑๘๘๘๗๗๗๗', { sessionId: 'conv_a' })
    const tok = TOKEN.exec(first.text)?.[0] ?? ''
    expect(tok).not.toBe('')
    expect(TOKEN.exec(again.text)?.[0]).toBe(tok)

    expect(await guard.resolve(tok, { purpose: 'otp_send', sessionId: 'conv_a' })).toEqual({
      ok: true,
      value: '0918887777',
    })
    const out = await guard.process(`ส่งไปที่ ${tok}`, { sessionId: 'conv_a', boundary: 'outbound' })
    expect(out.text).toBe('ส่งไปที่ xxx-xxx-7777')
    expect(store.calls).toBeGreaterThan(0)
  })

  it('is still refused by processSync', () => {
    const { guard } = build({ tokenStore: asyncStore() })
    expect(() => guard.processSync('เบอร์ 091-888-7777')).toThrow(PdpaError)
  })

  it('blocks the message when the store rejects a write (D4 level 2)', async () => {
    const broken = asyncStore()
    broken.set = async () => {
      throw new Error('redis down')
    }
    const { guard } = build({ tokenStore: broken })
    const r = await guard.process('เบอร์ 091-888-7777', { sessionId: 'conv_a' })
    expect(r).toMatchObject({ text: '', outcome: 'blocked', blockedBy: ['PHONE'] })
  })

  it('shows a placeholder, never the token, when the store cannot answer on the way out', async () => {
    const broken = asyncStore()
    broken.get = async () => {
      throw new Error('redis down')
    }
    const { guard, scans } = build({ tokenStore: broken })
    const r = await guard.process('ส่งไปที่ [tok:bcdfghjkmnpqrstv]', {
      sessionId: 'conv_a',
      boundary: 'outbound',
    })
    expect(r.text).toBe('ส่งไปที่ [ข้อมูลที่ปิดไว้]')
    expect(scans().at(-1)?.rendered).toEqual([
      { kind: 'token', tokenId: 'bcdfghjkmnpqrstv', entity: null, as: 'unavailable' },
    ])
    // Said as a store failure, not passed off as a token nobody issued (D15).
    expect(guard.stats.tokenStoreErrors).toBe(1)
  })

  it('keeps sessions apart when messages from two chats are in flight at once', async () => {
    const { guard } = build({ tokenStore: asyncStore() })
    const [a, b] = await Promise.all([
      guard.process('เบอร์ 091-888-7777', { sessionId: 'conv_a' }),
      guard.process('เบอร์ 091-888-7777', { sessionId: 'conv_b' }),
    ])
    const ta = TOKEN.exec(a.text)?.[0] ?? ''
    const tb = TOKEN.exec(b.text)?.[0] ?? ''
    expect(ta).not.toBe(tb)
    expect(await guard.resolve(ta, { purpose: 'otp_send', sessionId: 'conv_b' })).toEqual({
      ok: false,
      reason: 'session_mismatch',
    })
  })
})

describe('process() — async detectors', () => {
  const slowOrderIds: Detector = {
    id: 'order-as-email',
    entities: ['EMAIL'],
    async detect(input) {
      await Promise.resolve()
      const at = input.text.indexOf('ORDER-')
      return at < 0
        ? []
        : [{ entity: 'EMAIL', start: at, end: at + 10, confidence: 0.99, detector: '' }]
    },
  }

  it('runs them, where processSync can only report them skipped', async () => {
    const policy = definePolicy({ entitySet: '0.1', entities: { EMAIL: { action: 'redact' } } })
    const guard = createGuard({ policy, detectors: [slowOrderIds], onAudit: () => {} })
    const sync = guard.processSync('ref ORDER-1234 ok')
    const async = await guard.process('ref ORDER-1234 ok')
    expect(sync.skippedDetectors).toEqual(['order-as-email'])
    expect(sync.text).toBe('ref ORDER-1234 ok')
    expect(async.skippedDetectors).toEqual([])
    expect(async.text).toBe('ref [อีเมล] ok')
  })
})
