import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTokeniser } from '../src/actions/tokenise.js'
import { PdpaError } from '../src/errors.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { createMemoryTokenStore } from '../src/tokens/memory-store.js'
import type {
  AuditRecord,
  EntityRule,
  GuardOptions,
  TokenRecord,
  TokenResolveEvent,
  TokenStore,
} from '../src/types.js'
import { inSession } from './helpers/in-session.js'

const PHONE_RULE: EntityRule = {
  action: 'tokenise',
  ttlSec: 300,
  allowedPurposes: ['otp_send'],
}

function guardWith(extra: Partial<GuardOptions> = {}, rule: EntityRule = PHONE_RULE) {
  const events: AuditRecord[] = []
  const guard = inSession(
    createGuard({
      policy: definePolicy({ entitySet: '0.1', entities: { PHONE: rule } }),
      onAudit: (e) => events.push(e),
      ...extra,
    }),
  )
  const resolves = () => events.filter((e): e is TokenResolveEvent => e.type === 'token.resolve')
  return { guard, events, resolves }
}

/** The token written into the text, bracketed exactly as the model sees it. */
function tokenIn(text: string): string {
  const m = /\[tok:[bcdfghjkmnpqrstv]{16}\]/.exec(text)
  if (m === null) throw new Error(`no token in: ${text}`)
  return m[0]
}

afterEach(() => {
  vi.useRealTimers()
})

describe('policy — tokenise must say who may resolve it', () => {
  const load = (rule: unknown) => () =>
    definePolicy({ entitySet: '0.1', entities: { PHONE: rule as EntityRule } })

  it('rejects a rule with no allowedPurposes, since such a token can never be resolved', () => {
    expect(load({ action: 'tokenise' })).toThrow(/allowedPurposes: required for tokenise/)
  })

  it('rejects an empty list and an empty purpose', () => {
    expect(load({ action: 'tokenise', allowedPurposes: [] })).toThrow(PdpaError)
    expect(load({ action: 'tokenise', allowedPurposes: [''] })).toThrow(PdpaError)
  })

  it('caps ttlSec at an hour and requires whole seconds — D6', () => {
    const rule = (ttlSec: number) => ({ action: 'tokenise', ttlSec, allowedPurposes: ['x'] })
    expect(load(rule(0))).toThrow(/ttlSec/)
    expect(load(rule(3601))).toThrow(/ttlSec/)
    expect(load(rule(1.5))).toThrow(/ttlSec/)
    expect(load(rule(3600))).not.toThrow()
  })
})

describe('round trip', () => {
  it('writes a token into the text and records it in the finding', () => {
    const { guard } = guardWith()
    const r = guard.processSync('ขอ OTP ที่เบอร์ 0918887777')

    expect(r.text).toMatch(/^ขอ OTP ที่เบอร์ \[tok:[bcdfghjkmnpqrstv]{16}\]$/)
    expect(r.findings[0]).toMatchObject({ action: 'tokenise', ttlSec: 300 })
    expect(`[tok:${r.findings[0]?.tokenId}]`).toBe(tokenIn(r.text))
  })

  it('gives the real value back for an allowed purpose', () => {
    const { guard } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    expect(guard.resolveSync(token, { purpose: 'otp_send' })).toEqual({
      ok: true,
      value: '0918887777',
    })
  })

  it('works through the async resolve too', async () => {
    const { guard } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    await expect(guard.resolve(token, { purpose: 'otp_send' })).resolves.toEqual({
      ok: true,
      value: '0918887777',
    })
  })

  it('returns the canonical value — what a tool can dial, not how it was typed', () => {
    const { guard } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗').text)
    expect(guard.resolveSync(token, { purpose: 'otp_send' })).toEqual({
      ok: true,
      value: '0918887777',
    })
  })

  it('accepts the bare id a tool might pass on without the brackets', () => {
    const { guard } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    const bare = token.slice(5, -1)
    expect(guard.resolveSync(bare, { purpose: 'otp_send' }).ok).toBe(true)
  })
})

// D21: the token reaches resolve through an AI's tool call, spelt however the
// model copied it — read it the way an outbound reply is read.
describe('resolve reads a token the way an outbound reply does', () => {
  function issued() {
    const { guard, resolves } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    return { guard, resolves, id: token.slice(5, -1) }
  }

  it('takes the brackets dropped, half dropped, or with spaces inside', () => {
    const { guard, id } = issued()
    for (const t of [`tok:${id}`, `[tok:${id}`, `tok:${id}]`, `[ tok:${id} ]`]) {
      expect(guard.resolveSync(t, { purpose: 'otp_send' }), t).toEqual({
        ok: true,
        value: '0918887777',
      })
    }
  })

  it('takes spaces and quotes round the whole value', () => {
    const { guard, id } = issued()
    for (const t of [
      ` [tok:${id}] `,
      `"[tok:${id}]"`,
      `'tok:${id}'`,
      `“[tok:${id}]”`,
      `\n${id}\n`,
    ]) {
      expect(guard.resolveSync(t, { purpose: 'otp_send' }).ok, t).toBe(true)
    }
  })

  it('reads the same token in a reply and in a tool call', async () => {
    const { guard, id } = issued()
    const spelt = `tok:${id}`
    const reply = guard.processSync(`ส่งไปที่ ${spelt} แล้วค่ะ`, { boundary: 'outbound' })
    expect(reply.text).not.toContain(id)
    await expect(guard.resolve(spelt, { purpose: 'otp_send' })).resolves.toMatchObject({ ok: true })
  })

  it('still refuses anything that is not one token on its own', () => {
    const { guard, resolves, id } = issued()
    for (const t of [
      `เบอร์ [tok:${id}] ค่ะ`,
      `[tok:${id}] [tok:${id}]`,
      `[TOK:${id}]`,
      `tok: ${id}`,
      `[tok:${id.slice(1)}]`,
    ]) {
      expect(guard.resolveSync(t, { purpose: 'otp_send' }), t).toEqual({
        ok: false,
        reason: 'not_found',
      })
    }
    // What was passed in never reaches audit — only an id this guard issued would.
    expect(JSON.stringify(resolves())).not.toContain('เบอร์')
  })

  it('reads a long value in linear time, and refuses one too long to be a token (D22)', () => {
    const { guard, id } = issued()
    // A trim regex backtracks on a long inner run: this took 0.8 s before.
    const started = performance.now()
    for (const t of [`a${' '.repeat(40_000)}a`, ' '.repeat(200_000), `"${' '.repeat(100_000)}`]) {
      expect(guard.resolveSync(t, { purpose: 'otp_send' })).toEqual({
        ok: false,
        reason: 'not_found',
      })
    }
    // Generous for coverage on a CI runner, as many-values.test.ts is; the old
    // regex took about 20 s on the 200,000-space case alone.
    expect(performance.now() - started).toBeLessThan(2000)
    // Up to 256 characters is read; a real token wrapped in that much is not.
    expect(guard.resolveSync(`${' '.repeat(230)}[tok:${id}]`, { purpose: 'otp_send' }).ok).toBe(
      true,
    )
    expect(guard.resolveSync(`${' '.repeat(240)}[tok:${id}]`, { purpose: 'otp_send' }).ok).toBe(
      false,
    )
  })

  it('changes nothing else: another purpose is still refused', () => {
    const { guard, id } = issued()
    expect(guard.resolveSync(`tok:${id}`, { purpose: 'marketing' })).toEqual({
      ok: false,
      reason: 'purpose_not_allowed',
    })
  })
})

describe('same value, same session, same token — D8.4', () => {
  it('reuses the token for a repeated value', () => {
    const { guard } = guardWith()
    const a = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's1' }).text)
    const b = tokenIn(guard.processSync('ยืนยันเบอร์ 0918887777', { sessionId: 's1' }).text)
    expect(b).toBe(a)
  })

  it('reuses it however the number was written', () => {
    const { guard } = guardWith()
    const a = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's1' }).text)
    const b = tokenIn(guard.processSync('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗', { sessionId: 's1' }).text)
    const c = tokenIn(guard.processSync('เบอร์ +66 91 888 7777', { sessionId: 's1' }).text)
    expect(new Set([a, b, c]).size).toBe(1)
  })

  it('issues a different token in another session, so tokens cannot link two sessions', () => {
    const { guard } = guardWith()
    const a = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's1' }).text)
    const b = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's2' }).text)
    expect(b).not.toBe(a)
  })

  it('issues a different token for a different value', () => {
    const { guard } = guardWith()
    const a = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    const b = tokenIn(guard.processSync('เบอร์ 0918887778').text)
    expect(b).not.toBe(a)
  })

  it('does not extend the lifetime when a token is reused', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
    const { guard } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)

    vi.setSystemTime(new Date('2026-10-05T10:04:00Z'))
    expect(tokenIn(guard.processSync('อีกที 0918887777').text)).toBe(token)

    // 301 seconds after the FIRST issue, not the reuse.
    vi.setSystemTime(new Date('2026-10-05T10:05:01Z'))
    expect(guard.resolveSync(token, { purpose: 'otp_send' })).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('issues a fresh token once the old one has expired', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
    const { guard } = guardWith()
    const first = tokenIn(guard.processSync('เบอร์ 0918887777').text)

    vi.setSystemTime(new Date('2026-10-05T10:06:00Z'))
    const second = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    expect(second).not.toBe(first)
    expect(guard.resolveSync(second, { purpose: 'otp_send' }).ok).toBe(true)
  })
})

describe('resolve refuses — D6, in order', () => {
  it('not_found for a token this guard never issued', () => {
    const { guard } = guardWith()
    expect(guard.resolveSync('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send' })).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  it('not_found for anything that is not a token, and never logs what was passed', () => {
    const { guard, resolves } = guardWith()
    expect(guard.resolveSync('0918887777', { purpose: 'otp_send' })).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(resolves()[0]?.tokenId).toBeNull()
    expect(JSON.stringify(resolves())).not.toContain('0918887777')
  })

  it('session_mismatch for a token from another session', () => {
    const { guard } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's1' }).text)
    expect(guard.resolveSync(token, { purpose: 'otp_send', sessionId: 's2' })).toEqual({
      ok: false,
      reason: 'session_mismatch',
    })
  })

  it('expired after the TTL, and the token is gone afterwards', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
    const { guard } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)

    vi.setSystemTime(new Date('2026-10-05T10:05:00Z'))
    expect(guard.resolveSync(token, { purpose: 'otp_send' })).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(guard.resolveSync(token, { purpose: 'otp_send' })).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  it('purpose_not_allowed for a purpose the policy did not list', () => {
    const { guard } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    expect(guard.resolveSync(token, { purpose: 'marketing' })).toEqual({
      ok: false,
      reason: 'purpose_not_allowed',
    })
  })

  it('reports session before expiry', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
    const { guard } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's1' }).text)

    vi.setSystemTime(new Date('2026-10-05T11:00:00Z'))
    expect(guard.resolveSync(token, { purpose: 'otp_send', sessionId: 's2' })).toEqual({
      ok: false,
      reason: 'session_mismatch',
    })
  })

  it('not_found from a guard whose policy never tokenises', () => {
    const guard = createGuard({
      policy: definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'redact' } } }),
    })
    expect(guard.resolveSync('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'x' }).ok).toBe(false)
  })
})

describe('audit — every attempt, allowed or refused', () => {
  it('records an allowed resolve with who asked and why', () => {
    const { guard, resolves } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    guard.resolveSync(token, { purpose: 'otp_send', caller: 'otp-service' })

    expect(resolves()).toEqual([
      expect.objectContaining({
        type: 'token.resolve',
        tokenId: token.slice(5, -1),
        entity: 'PHONE',
        purpose: 'otp_send',
        caller: 'otp-service',
        outcome: 'allowed',
      }),
    ])
  })

  it('records a refusal with its reason', () => {
    const { guard, resolves } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    guard.resolveSync(token, { purpose: 'marketing', caller: 'crm' })

    expect(resolves()[0]).toMatchObject({ outcome: 'denied', reason: 'purpose_not_allowed' })
  })

  it('does not name the entity to a caller from the wrong session', () => {
    const { guard, resolves } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's1' }).text)
    guard.resolveSync(token, { purpose: 'otp_send', sessionId: 's2' })
    expect(resolves()[0]?.entity).toBeNull()
  })

  it('never contains the real value, even on a successful resolve', () => {
    const { guard, events } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    guard.resolveSync(token, { purpose: 'otp_send' })
    expect(JSON.stringify(events)).not.toContain('0918887777')
  })
})

describe('endSession', () => {
  it('deletes every token of the session', () => {
    const { guard } = guardWith()
    const token = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's1' }).text)
    guard.endSession('s1')
    expect(guard.resolveSync(token, { purpose: 'otp_send', sessionId: 's1' })).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  it('leaves other sessions alone', () => {
    const { guard } = guardWith()
    tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's1' }).text)
    const other = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's2' }).text)
    guard.endSession('s1')
    expect(guard.resolveSync(other, { purpose: 'otp_send', sessionId: 's2' }).ok).toBe(true)
  })

  it('stops reuse, so the next mention gets a fresh token', () => {
    const { guard } = guardWith()
    const before = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's1' }).text)
    guard.endSession('s1')
    const after = tokenIn(guard.processSync('เบอร์ 0918887777', { sessionId: 's1' }).text)
    expect(after).not.toBe(before)
  })
})

describe('the memory store', () => {
  it('blocks the message when full, rather than evicting a live token — D4 level 2', () => {
    const { guard } = guardWith({ tokenStore: createMemoryTokenStore({ maxTokens: 1 }) })
    expect(guard.processSync('เบอร์ 0918887777').outcome).toBe('processed')

    const r = guard.processSync('เบอร์ 0812345678')
    expect(r).toMatchObject({ text: '', outcome: 'blocked', blockedBy: ['PHONE'] })
  })

  it('still reuses an existing token when full, since nothing new needs storing', () => {
    const { guard } = guardWith({ tokenStore: createMemoryTokenStore({ maxTokens: 1 }) })
    const token = tokenIn(guard.processSync('เบอร์ 0918887777').text)
    expect(tokenIn(guard.processSync('อีกที 0918887777').text)).toBe(token)
  })

  it('sweeps expired tokens on write, so a full store recovers on its own', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
    const { guard } = guardWith({ tokenStore: createMemoryTokenStore({ maxTokens: 1 }) })
    guard.processSync('เบอร์ 0918887777')

    vi.setSystemTime(new Date('2026-10-05T10:06:00Z'))
    expect(guard.processSync('เบอร์ 0812345678').outcome).toBe('processed')
  })
})

describe('the reuse index past its limit (D22)', () => {
  it('is trimmed from its own records, without asking the store about each entry', () => {
    // The tokeniser alone, not the guard: 20,001 messages through every
    // detector overran the 5 s limit under coverage on CI.
    const tokeniser = createTokeniser((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)))
    let gets = 0
    // 20,001 different numbers: one past the index limit. Each is new, so no
    // issue asks the store anything; only a prune that reads the store would.
    for (let i = 0; i <= 20_000; i++) {
      const steps = tokeniser.issue(
        's1',
        'PHONE',
        `08${String(i).padStart(8, '0')}`,
        PHONE_RULE,
        undefined,
      )
      for (let step = steps.next(); !step.done; step = steps.next(undefined)) {
        if (step.value.op === 'get') gets++
      }
    }
    expect(gets).toBe(0)
  })
})

describe('a store the host plugs in — D6', () => {
  it('is used instead of the memory store', () => {
    const map = new Map<string, TokenRecord>()
    const store: TokenStore = {
      sync: true,
      set: (id, rec) => {
        map.set(id, rec)
      },
      get: (id) => map.get(id),
      delete: (id) => {
        map.delete(id)
      },
      clearSession: () => {},
    }
    const { guard } = guardWith({ tokenStore: store })
    guard.processSync('เบอร์ 0918887777')

    expect([...map.values()]).toEqual([
      expect.objectContaining({ value: '0918887777', entity: 'PHONE', purposes: ['otp_send'] }),
    ])
  })

  it('blocks the message when the store throws, rather than letting the value through', () => {
    const store: TokenStore = {
      sync: true,
      set: () => {
        throw new Error('redis down')
      },
      get: () => undefined,
      delete: () => {},
      clearSession: () => {},
    }
    const { guard } = guardWith({ tokenStore: store })
    const r = guard.processSync('เบอร์ 0918887777')
    expect(r.text).toBe('')
    expect(r.outcome).toBe('blocked')
  })

  it('makes processSync and resolveSync throw when it is async, never skip tokenise', () => {
    const store: TokenStore = {
      sync: false,
      set: async () => {},
      get: async () => undefined,
      delete: async () => {},
      clearSession: async () => {},
    }
    const { guard } = guardWith({ tokenStore: store })

    expect(() => guard.processSync('เบอร์ 0918887777')).toThrow(
      expect.objectContaining({ code: 'ERR_PDPA_ASYNC_STORE' }),
    )
    expect(() => guard.resolveSync('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send' })).toThrow(
      expect.objectContaining({ code: 'ERR_PDPA_ASYNC_STORE' }),
    )
  })
})

describe('a second pass through the guard', () => {
  it('leaves the token alone — item 6', () => {
    const { guard } = guardWith()
    const once = guard.processSync('เบอร์ 0918887777').text
    expect(guard.processSync(once).text).toBe(once)
  })
})

// D10.4 — one shared 'anonymous' session would let one customer's chat
// resolve another's token. A policy that tokenises refuses to guess.
describe('a policy that tokenises needs a sessionId', () => {
  const tokenising = definePolicy({ entitySet: '0.1', entities: { PHONE: PHONE_RULE } })
  const bare = () => createGuard({ policy: tokenising, onAudit: () => {} })
  const noSession = { code: 'ERR_PDPA_NO_SESSION' }

  it('refuses processSync and process without one', async () => {
    expect(() => bare().processSync('เบอร์ 0918887777')).toThrow(expect.objectContaining(noSession))
    await expect(bare().process('เบอร์ 0918887777')).rejects.toMatchObject(noSession)
  })

  it('refuses even a message with nothing to tokenise, so the mistake shows on the first call', () => {
    expect(() => bare().processSync('สวัสดีครับ')).toThrow(PdpaError)
  })

  it('refuses resolveSync and resolve without one', async () => {
    expect(() => bare().resolveSync('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send' })).toThrow(
      expect.objectContaining(noSession),
    )
    await expect(
      bare().resolve('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send' }),
    ).rejects.toMatchObject(noSession)
  })

  it('treats an empty string as missing', () => {
    expect(() => bare().processSync('x', { sessionId: '' })).toThrow(PdpaError)
  })

  it('never names the message in the error', () => {
    expect(() => bare().processSync('เบอร์ 0918887777')).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining('0918887777') }),
    )
  })

  it('works with one', () => {
    const r = bare().processSync('เบอร์ 0918887777', { sessionId: 'conv_a' })
    expect(r.text).toMatch(/\[tok:[a-z]{16}\]/)
  })

  it('still defaults to anonymous when the policy does not tokenise', () => {
    const events: AuditRecord[] = []
    const guard = createGuard({
      policy: definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'redact' } } }),
      onAudit: (e) => events.push(e),
    })
    expect(guard.processSync('เบอร์ 0918887777').text).toBe('เบอร์ [เบอร์โทร]')
    expect(events.at(-1)).toMatchObject({ type: 'scan', sessionId: 'anonymous' })
  })
})
