import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_DETECTORS } from '../src/detectors/index.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { createMemoryTokenStore } from '../src/tokens/memory-store.js'
import type {
  AuditEvent,
  AuditRecord,
  Detector,
  GuardOptions,
  PolicyInput,
  ProcessResult,
  TokenRecord,
  TokenStore,
} from '../src/types.js'
import { inSession } from './helpers/in-session.js'

/**
 * D4 — what happens when the guard itself fails, as opposed to missing a value.
 *
 *   level 1  a detector fails        → keep scanning with the rest, flag it  (test:degrade)
 *   level 2  an action fails         → block the message                     (test:fail-closed)
 *   level 3  anything else           → throw; the caller decides
 *
 * And the rule before all three: a guard that could not apply its own policy is
 * refused at construction, so level 2 is never the first time anyone learns of it.
 *
 * This file is the record that each of those holds. These are the behaviours
 * most likely to be "fixed" by accident while chasing an unrelated bug.
 */

const PHONE = '0918887777'
const CARD = '4111 1111 1111 1111'
const MESSAGE = `เบอร์ ${PHONE} บัตร ${CARD}`

const TOKENISE: PolicyInput['entities'] = {
  PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'] },
  CREDIT_CARD: { action: 'redact' },
}

function guardWith(extra: Partial<GuardOptions>, entities = TOKENISE) {
  const events: AuditRecord[] = []
  const guard = inSession(
    createGuard({
      policy: definePolicy({ entitySet: '0.1', entities }),
      onAudit: (e) => events.push(e),
      ...extra,
    }),
  )
  const scans = () => events.filter((e): e is AuditEvent => e.type === 'scan')
  return { guard, scans }
}

/** Nothing about the message may survive a blocked result — not the value, not its neighbours. */
function expectBlockedWithNothingInside(r: ProcessResult) {
  expect(r.outcome).toBe('blocked')
  expect(r.text).toBe('')
  expect(r.blockedBy).toContain('PHONE')
  const json = JSON.stringify(r)
  expect(json).not.toContain(PHONE)
  expect(json).not.toContain('4111')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('before any message: a guard that cannot apply its policy is not built', () => {
  it('tokenise with no secure random source', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() => guardWith({})).toThrow(expect.objectContaining({ code: 'ERR_PDPA_NO_CSPRNG' }))
  })

  it('tokenise with a random source that fails its probe', () => {
    expect(() => guardWith({ randomSource: () => new Uint8Array(2) })).toThrow(
      expect.objectContaining({ code: 'ERR_PDPA_NO_CSPRNG' }),
    )
  })

  it('hash with no key', () => {
    expect(() => guardWith({}, { PHONE: { action: 'hash' } })).toThrow(
      expect.objectContaining({ code: 'ERR_PDPA_HMAC_KEY' }),
    )
  })

  it('hash with a key too short to be safe', () => {
    expect(() => guardWith({ hmacKey: 'short' }, { PHONE: { action: 'hash' } })).toThrow(
      expect.objectContaining({ code: 'ERR_PDPA_HMAC_KEY' }),
    )
  })

  it('tokenise with no purpose that could ever resolve the token', () => {
    expect(() =>
      definePolicy({ entitySet: '0.1', entities: { PHONE: { action: 'tokenise' } } }),
    ).toThrow(expect.objectContaining({ code: 'ERR_PDPA_INVALID_POLICY' }))
  })
})

describe('test:fail-closed — an action that fails mid-message blocks it (level 2)', () => {
  it('when the token store is full', () => {
    const { guard } = guardWith({ tokenStore: createMemoryTokenStore({ maxTokens: 1 }) })
    guard.processSync('เบอร์ 0812345678') // fills it

    expectBlockedWithNothingInside(guard.processSync(MESSAGE))
  })

  it('when the token store throws', () => {
    const broken: TokenStore = {
      sync: true,
      set: () => {
        throw new Error('connection reset')
      },
      get: () => undefined,
      delete: () => {},
      clearSession: () => {},
    }
    expectBlockedWithNothingInside(guardWith({ tokenStore: broken }).guard.processSync(MESSAGE))
  })

  it('when the random source passes its probe and then starts returning short arrays', () => {
    // Without a check on every call this produced [tok:bbbb] — guessable, and
    // the same id for every value, each overwriting the last in the store.
    let calls = 0
    const degrading = (n: number) => (calls++ === 0 ? new Uint8Array(n).fill(7) : new Uint8Array(2))
    expectBlockedWithNothingInside(
      guardWith({ randomSource: degrading }).guard.processSync(MESSAGE),
    )
  })

  it('when the random source throws', () => {
    let calls = 0
    const failing = (n: number) => {
      if (calls++ === 0) return new Uint8Array(n).fill(7)
      throw new Error('entropy unavailable')
    }
    expectBlockedWithNothingInside(guardWith({ randomSource: failing }).guard.processSync(MESSAGE))
  })

  it('and says so in the audit event, without the value', () => {
    const { guard, scans } = guardWith({ tokenStore: createMemoryTokenStore({ maxTokens: 0 }) })
    guard.processSync(MESSAGE)

    expect(scans()[0]?.outcome).toBe('blocked')
    expect(JSON.stringify(scans())).not.toContain(PHONE)
  })

  it('leaves nothing half-done: once the store recovers, the same value tokenises and resolves', () => {
    let fail = true
    const map = new Map<string, TokenRecord>()
    const flaky: TokenStore = {
      sync: true,
      set: (id, rec) => {
        if (fail) throw new Error('down')
        map.set(id, rec)
      },
      get: (id) => map.get(id),
      delete: (id) => {
        map.delete(id)
      },
      clearSession: () => {},
    }
    const { guard } = guardWith({ tokenStore: flaky })
    expect(guard.processSync(`เบอร์ ${PHONE}`).outcome).toBe('blocked')

    fail = false
    const r = guard.processSync(`เบอร์ ${PHONE}`)
    const token = /\[tok:[a-z]{16}\]/.exec(r.text)?.[0] ?? ''
    expect(guard.resolveSync(token, { purpose: 'otp_send' })).toEqual({ ok: true, value: PHONE })
  })
})

describe('never skipped: a store processSync cannot wait for stops the call', () => {
  it('throws rather than carrying on without tokenising', () => {
    const asyncStore: TokenStore = {
      sync: false,
      set: async () => {},
      get: async () => undefined,
      delete: async () => {},
      clearSession: async () => {},
    }
    expect(() => guardWith({ tokenStore: asyncStore }).guard.processSync(MESSAGE)).toThrow(
      expect.objectContaining({ code: 'ERR_PDPA_ASYNC_STORE' }),
    )
  })
})

describe('test:degrade — a detector that fails does not stop the scan (level 1)', () => {
  const broken: Detector = {
    id: 'thai-ner',
    entities: ['PHONE'],
    detect() {
      throw new Error('model failed to load')
    },
  }

  it('protects everything the remaining detectors can see', () => {
    const { guard } = guardWith(
      { detectors: [broken, ...BUILTIN_DETECTORS] },
      { PHONE: { action: 'redact' }, CREDIT_CARD: { action: 'redact' } },
    )
    const r = guard.processSync(MESSAGE)

    expect(r.outcome).toBe('processed')
    expect(r.text).toBe('เบอร์ [เบอร์โทร] บัตร [บัตรเครดิต]')
  })

  it('names the failed detector in the audit event, so the result is known to be partial', () => {
    const { guard, scans } = guardWith(
      { detectors: [broken, ...BUILTIN_DETECTORS] },
      { PHONE: { action: 'redact' } },
    )
    guard.processSync(MESSAGE)
    expect(scans()[0]?.degradedDetectors).toEqual(['thai-ner'])
  })
})
