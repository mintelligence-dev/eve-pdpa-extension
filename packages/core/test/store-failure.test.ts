import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { createMemoryTokenStore } from '../src/tokens/memory-store.js'
import type {
  AuditEvent,
  AuditRecord,
  GuardErrorContext,
  GuardOptions,
  TokenRecord,
  TokenResolveEvent,
  TokenStore,
} from '../src/types.js'

/**
 * D15 — a token store that fails must never fail quietly.
 *
 * The message is still blocked rather than let through (D4), and a resolve is
 * still refused. What changed is that someone hears about it: onError is told,
 * guard.stats counts it, and the audit event says the store was the reason.
 * Before, a Redis outage blocked every message with a phone number in it while
 * the log read exactly like a policy doing its job.
 */

const policy = definePolicy({
  entitySet: '0.1',
  entities: {
    PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] },
    CREDIT_CARD: { action: 'block' },
  },
})

const STORE_DOWN = new Error('ClientClosedError: The client is closed')

function store(
  sync: boolean,
  failing: Partial<Record<'set' | 'get' | 'delete', true>>,
): TokenStore {
  const inner = createMemoryTokenStore()
  const fail = () => {
    if (sync) throw STORE_DOWN
    return Promise.reject(STORE_DOWN)
  }
  const wrap = <T>(f: () => T) => (sync ? f() : Promise.resolve().then(f))
  return {
    sync,
    set: (id: string, rec: TokenRecord) => (failing.set ? fail() : wrap(() => inner.set(id, rec))),
    get: (id: string) => (failing.get ? fail() : wrap(() => inner.get(id))),
    delete: (id: string) => (failing.delete ? fail() : wrap(() => inner.delete(id))),
    clearSession: (id: string) => wrap(() => inner.clearSession(id)),
  } as TokenStore
}

function build(extra: Partial<GuardOptions>) {
  const events: AuditRecord[] = []
  const errors: [unknown, GuardErrorContext][] = []
  const guard = createGuard({
    policy,
    onAudit: (e) => events.push(e),
    onError: (e, c) => errors.push([e, c]),
    ...extra,
  })
  const scans = () => events.filter((e): e is AuditEvent => e.type === 'scan')
  const resolves = () => events.filter((e): e is TokenResolveEvent => e.type === 'token.resolve')
  return { guard, errors, scans, resolves }
}

for (const sync of [true, false]) {
  const run = sync ? 'processSync' : 'process'
  describe(`a ${sync ? 'sync' : 'async'} store that fails`, () => {
    it(`on the way in: still blocks, and says the store was why (${run})`, async () => {
      const { guard, errors, scans } = build({ tokenStore: store(sync, { set: true }) })
      const r = sync
        ? guard.processSync('เบอร์ 0918887777', { sessionId: 's' })
        : await guard.process('เบอร์ 0918887777', { sessionId: 's' })

      expect(r).toMatchObject({ text: '', outcome: 'blocked', blockedBy: ['PHONE'] })
      expect(scans().at(-1)?.findings).toEqual([
        expect.objectContaining({ entity: 'PHONE', action: 'tokenise', failed: 'token_store' }),
      ])
      expect(errors).toEqual([[STORE_DOWN, { source: 'token_store', eventType: 'scan' }]])
      expect(guard.stats).toEqual({ auditSinkErrors: 0, tokenStoreErrors: 1 })
    })

    it('on resolve: refuses with store_unavailable, audits it, never throws', async () => {
      const { guard, errors, resolves } = build({ tokenStore: store(sync, { get: true }) })
      const opts = { purpose: 'otp_send', sessionId: 's', caller: 'otp-tool' }
      const r = sync
        ? guard.resolveSync('[tok:bbbbbbbbbbbbbbbb]', opts)
        : await guard.resolve('[tok:bbbbbbbbbbbbbbbb]', opts)

      expect(r).toEqual({ ok: false, reason: 'store_unavailable' })
      expect(resolves()).toEqual([
        expect.objectContaining({
          tokenId: 'bbbbbbbbbbbbbbbb',
          entity: null,
          outcome: 'denied',
          reason: 'store_unavailable',
          caller: 'otp-tool',
        }),
      ])
      expect(errors).toEqual([[STORE_DOWN, { source: 'token_store', eventType: 'token.resolve' }]])
      expect(guard.stats.tokenStoreErrors).toBe(1)
    })

    it('on the way out: placeholder for the customer, unavailable in the audit', async () => {
      const { guard, errors, scans } = build({ tokenStore: store(sync, { get: true }) })
      const opts = { sessionId: 's', boundary: 'outbound' as const }
      const r = sync
        ? guard.processSync('ส่งไป [tok:bbbbbbbbbbbbbbbb]', opts)
        : await guard.process('ส่งไป [tok:bbbbbbbbbbbbbbbb]', opts)

      expect(r.text).toBe('ส่งไป [ข้อมูลที่ปิดไว้]')
      expect(scans().at(-1)?.rendered).toEqual([
        { kind: 'token', tokenId: 'bbbbbbbbbbbbbbbb', entity: null, as: 'unavailable' },
      ])
      expect(errors.map(([, c]) => c)).toEqual([{ source: 'token_store', eventType: 'scan' }])
    })
  })
}

describe('telling a store failure from everything else', () => {
  it('a block the policy asked for carries no failed mark and reports nothing', () => {
    const { guard, errors, scans } = build({})
    guard.processSync('บัตร 4111 1111 1111 1111', { sessionId: 's' })
    expect(scans().at(-1)?.outcome).toBe('blocked')
    expect(scans().at(-1)?.findings[0]).not.toHaveProperty('failed')
    expect(errors).toEqual([])
  })

  it('a full memory store is a store failure too — otherwise it blocks in silence', () => {
    const { guard, errors, scans } = build({ tokenStore: createMemoryTokenStore({ maxTokens: 0 }) })
    guard.processSync('เบอร์ 0918887777', { sessionId: 's' })
    expect(scans().at(-1)?.findings[0]).toMatchObject({ failed: 'token_store' })
    expect(errors[0]?.[0]).toMatchObject({ code: 'ERR_PDPA_TOKEN_STORE_FULL' })
  })

  it('a random source that breaks mid-run still blocks, but is not blamed on the store', () => {
    let calls = 0
    const { guard, errors, scans } = build({
      randomSource: (n) => {
        // The first call is createGuard's probe; break after it.
        if (calls++ > 0) throw new Error('entropy gone')
        return new Uint8Array(n)
      },
    })
    expect(guard.processSync('เบอร์ 0918887777', { sessionId: 's' }).outcome).toBe('blocked')
    expect(scans().at(-1)?.findings[0]).not.toHaveProperty('failed')
    expect(guard.stats.tokenStoreErrors).toBe(0)
    expect(errors).toEqual([])
  })

  it('a store that fails only on deleting an expired token still refuses it as expired', async () => {
    const s = store(false, { delete: true })
    const { guard, errors } = build({ tokenStore: s })
    const tok = (await guard.process('เบอร์ 0918887777', { sessionId: 's' })).findings[0]?.tokenId
    const rec = (await s.get(tok as string)) as TokenRecord
    await s.set(tok as string, { ...rec, expiresAt: 0 })
    expect(await guard.resolve(`[tok:${tok}]`, { purpose: 'otp_send', sessionId: 's' })).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(errors.map(([, c]) => c)).toEqual([
      { source: 'token_store', eventType: 'token.resolve' },
    ])
  })

  it('a broken onError cannot turn a store failure into a thrown error', async () => {
    const guard = createGuard({
      policy,
      tokenStore: store(false, { get: true }),
      onAudit: () => {},
      onError: () => {
        throw new Error('handler broken too')
      },
    })
    await expect(
      guard.resolve('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send', sessionId: 's' }),
    ).resolves.toEqual({
      ok: false,
      reason: 'store_unavailable',
    })
  })
})
