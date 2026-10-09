import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_DETECTORS } from '../src/detectors/index.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { createMemoryTokenStore } from '../src/tokens/memory-store.js'
import type {
  Action,
  AuditRecord,
  Detector,
  EntityRule,
  EntityType,
  GuardOptions,
  PolicyInput,
} from '../src/types.js'
import { ACTIONS, ENTITY_TYPES } from '../src/types.js'

/**
 * Every event the guard emits must pass audit-event.schema.json, and the schema
 * must describe nothing the guard never emits. Customers will store these logs
 * and build on their shape; once 0.1 is on npm the shape cannot change without
 * a new schemaVersion. D2.
 *
 * The schema is strict (additionalProperties: false throughout), so a field
 * added in code without the schema fails here, and the coverage check at the
 * end fails for a field the schema promises that code never writes.
 */

const readSchema = (name: string) =>
  JSON.parse(readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8'))
const schema = readSchema('audit-event.schema.json')

// validateFormats off for the same reason as policy-schema.test.ts; `at` also
// carries a pattern, so the timestamp is still checked.
const validate = new Ajv2020({
  strict: true,
  strictRequired: false,
  validateFormats: false,
  allErrors: true,
}).compile(schema)

function expectValid(event: unknown): void {
  if (validate(event) !== true) {
    throw new Error(
      `schema rejects an event the guard emitted:\n${JSON.stringify(validate.errors, null, 2)}\n${JSON.stringify(event)}`,
    )
  }
}

const schemaAccepts = (event: unknown) => validate(event) === true

const KEY = 'k'.repeat(32)

// Synthetic values only. The id and card pass their checksums.
const ALL_SIX =
  'บัตร 3-1005-00123-45-8 เบอร์ 091-888-7777 อีเมล Somchai@example.com ' +
  'เลขบัญชี 123-4-56789-0 บัตรเครดิต 4111 1111 1111 1111 ไลน์ U4af4980629a4b1c2d3e4f5a6b7c8d9e0'
const MESSAGES = [
  ALL_SIX,
  'สวัสดีครับ ไม่มีอะไร',
  '',
  'เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ติดต่อร้านที่ 02-123-4567 หรือ support@myshop.co.th',
  'ตอบ [PHONE:bcdfghjkmnpqrstv] และ [tok:bbbbbbbbbbbbbbbb] และ tok:cccccccccccccccc',
]

function ruleFor(action: Action): EntityRule {
  return action === 'tokenise' ? { action, allowedPurposes: ['otp_send'] } : { action }
}

// Every record that left the guard, from every test in this file.
const seen: AuditRecord[] = []

function build(input: PolicyInput, extra: Partial<GuardOptions> = {}) {
  const events: AuditRecord[] = []
  const guard = createGuard({
    policy: definePolicy(input),
    hmacKey: KEY,
    onAudit: (e) => {
      expectValid(e)
      // Through JSON, as a log pipeline would see it: no undefined, no symbols.
      expectValid(JSON.parse(JSON.stringify(e)))
      events.push(e)
      seen.push(e)
    },
    ...extra,
  })
  return { guard, events }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('every event the guard emits passes the schema', () => {
  for (const action of ACTIONS) {
    for (const placeholderLanguage of ['th', 'en'] as const) {
      it(`every entity under ${action}, placeholders in ${placeholderLanguage}`, async () => {
        const entities = Object.fromEntries(ENTITY_TYPES.map((e) => [e, ruleFor(action)]))
        const { guard } = build({ entitySet: '0.1', entities, placeholderLanguage })
        for (const text of MESSAGES)
          for (const boundary of ['inbound', 'tool_output', 'outbound'] as const) {
            guard.processSync(text, { sessionId: 'conv_a', boundary })
            await guard.process(text, { sessionId: 'conv_a', boundary, ref: 'msg_1' })
          }
      })
    }
  }

  for (const onUnmapped of ['redact', 'flag', 'ignore'] as const) {
    it(`unmapped entities under onUnmapped: ${onUnmapped}`, () => {
      const { guard } = build({
        entitySet: '0.1',
        onUnmapped,
        entities: { PHONE: { action: 'mask', keep: 'last4' } },
      })
      for (const text of MESSAGES) guard.processSync(text)
    })
  }

  it('an allowlist, written every way, and a context', () => {
    const { guard } = build({
      entitySet: '0.1',
      entities: { PHONE: { action: 'redact', minConfidence: 0.5 }, EMAIL: { action: 'redact' } },
      allowlist: {
        exact: ['02-123-4567', '๐๒๑๒๓๔๕๖๗', 'SUPPORT@myshop.co.th'],
        pattern: ['.*@myshop\\.co\\.th'],
      },
    })
    for (const text of MESSAGES) guard.processSync(text, { context: 'ขอเลขบัญชีด้วยครับ' })
  })

  it('a block', () => {
    const { guard } = build({ entitySet: '0.1', entities: { TH_NATIONAL_ID: { action: 'block' } } })
    expect(guard.processSync(ALL_SIX).outcome).toBe('blocked')
  })

  it('a token store that refuses, which blocks the message', () => {
    const { guard, events } = build(
      { entitySet: '0.1', entities: { PHONE: ruleFor('tokenise') } },
      { tokenStore: createMemoryTokenStore({ maxTokens: 0 }) },
    )
    expect(guard.processSync(ALL_SIX, { sessionId: 'conv_a' }).outcome).toBe('blocked')
    const scan = events.at(-1)
    expect(scan?.type === 'scan' && scan.findings.some((f) => f.action === 'tokenise')).toBe(true)
  })

  it('a detector that throws, an async one processSync skips, and no detectors at all', async () => {
    const broken: Detector = {
      id: 'broken',
      entities: ['PHONE'],
      detect() {
        throw new Error('boom')
      },
    }
    const slow: Detector = { id: 'slow', entities: ['BANK_ACCOUNT'], detect: async () => [] }
    const policy: PolicyInput = { entitySet: '0.1', entities: { PHONE: { action: 'redact' } } }
    const { guard } = build(policy, { detectors: [broken, slow, ...BUILTIN_DETECTORS] })
    guard.processSync(ALL_SIX)
    await guard.process(ALL_SIX)
    build(policy, { detectors: [] }).guard.processSync(ALL_SIX)
  })

  it('every way a token comes back out in a reply', () => {
    const { guard, events } = build({
      entitySet: '0.1',
      entities: {
        PHONE: ruleFor('tokenise'),
        TH_NATIONAL_ID: {
          action: 'tokenise',
          allowedPurposes: ['kyc'],
          display: 'redact',
          ttlSec: 60,
        },
      },
    })
    const mine = guard.processSync(ALL_SIX, { sessionId: 'conv_a' }).text
    const theirs = guard.processSync('เบอร์ 0812345678', { sessionId: 'conv_b' }).text
    guard.processSync(`${mine} ${theirs} [tok:bbbbbbbbbbbbbbbb] [EMAIL:bcdfghjkmnpqrstv]`, {
      sessionId: 'conv_a',
      boundary: 'outbound',
    })
    const out = events.at(-1)
    const kinds = out?.type === 'scan' ? out.rendered?.map((r) => r.as) : []
    expect(new Set(kinds)).toEqual(new Set(['masked', 'placeholder', 'foreign', 'unknown']))
  })

  it('a token store that is down — on the way in, on resolve, and on the way out (D15)', async () => {
    const down = {
      sync: false,
      set: async () => {
        throw new Error('ClientClosedError')
      },
      get: async () => {
        throw new Error('ClientClosedError')
      },
      delete: async () => {},
      clearSession: async () => {},
    }
    const { guard } = build(
      { entitySet: '0.1', entities: { PHONE: ruleFor('tokenise') } },
      { tokenStore: down },
    )
    expect((await guard.process('เบอร์ 0918887777', { sessionId: 'conv_a' })).outcome).toBe(
      'blocked',
    )
    expect(
      await guard.resolve('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send', sessionId: 'conv_a' }),
    ).toEqual({
      ok: false,
      reason: 'store_unavailable',
    })
    await guard.process('ส่งไป [tok:bbbbbbbbbbbbbbbb]', {
      sessionId: 'conv_a',
      boundary: 'outbound',
    })
  })

  it('every way a resolve can end', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { guard } = build({
      entitySet: '0.1',
      entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], ttlSec: 1 } },
    })
    const token =
      /\[tok:[a-z]{16}\]/.exec(
        guard.processSync('เบอร์ 0918887777', { sessionId: 'conv_a' }).text,
      )?.[0] ?? ''
    expect(
      guard.resolveSync(token, {
        purpose: 'otp_send',
        sessionId: 'conv_a',
        caller: 'otp-tool',
        ref: 'call_1',
      }).ok,
    ).toBe(true)
    guard.resolveSync(token, { purpose: 'marketing', sessionId: 'conv_a' })
    guard.resolveSync(token, { purpose: 'otp_send', sessionId: 'conv_b' })
    guard.resolveSync('0918887777', { purpose: 'otp_send', sessionId: 'conv_a' })
    guard.resolveSync('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send', sessionId: 'conv_a' })
    vi.setSystemTime(Date.now() + 5_000)
    expect(guard.resolveSync(token, { purpose: 'otp_send', sessionId: 'conv_a' })).toEqual({
      ok: false,
      reason: 'expired',
    })
  })
})

describe('the schema describes nothing the guard never writes', () => {
  // Runs after the block above, over everything it emitted.
  const keysOf = (items: readonly object[]) => new Set(items.flatMap((o) => Object.keys(o)))
  const propsOf = (def: string) => new Set(Object.keys(schema.$defs[def].properties))

  it('every field of every record type appears in at least one real event', () => {
    const byType = (t: AuditRecord['type']) => seen.filter((e) => e.type === t)
    const scans = seen.flatMap((e) => (e.type === 'scan' ? [e] : []))
    expect(keysOf(byType('policy.loaded'))).toEqual(propsOf('policyLoaded'))
    expect(keysOf(byType('scan'))).toEqual(propsOf('scan'))
    expect(keysOf(byType('token.resolve'))).toEqual(propsOf('tokenResolve'))
    expect(keysOf(scans.flatMap((s) => s.findings))).toEqual(propsOf('finding'))
    expect(keysOf(scans.flatMap((s) => s.rendered ?? []))).toEqual(propsOf('rendered'))
  })

  it('every resolve reason and every scan outcome but error appears', () => {
    const reasons = new Set(
      seen.flatMap((e) => (e.type === 'token.resolve' && e.reason ? [e.reason] : [])),
    )
    expect(reasons).toEqual(new Set(schema.$defs.tokenResolve.properties.reason.enum))
    // 'error' is reserved: today a failure the guard cannot handle throws (D4)
    // and writes no event. Listed so a later release can without a new version.
    const outcomes = new Set(seen.flatMap((e) => (e.type === 'scan' ? [e.outcome] : [])))
    expect([...outcomes, 'error'].sort()).toEqual(
      [...schema.$defs.scan.properties.outcome.enum].sort(),
    )
  })
})

describe('the schema file', () => {
  it('names every entity and action the library supports, and no others', () => {
    expect(schema.$defs.entity.enum).toEqual([...ENTITY_TYPES])
    expect(schema.$defs.action.enum).toEqual([...ACTIONS])
  })

  it('describes a policy rule exactly as policy.schema.json does', () => {
    expect(schema.$defs.rule).toEqual(readSchema('policy.schema.json').$defs.rule)
  })
})

describe('what the schema rejects', () => {
  // A real event of each type to break one field at a time.
  function sample() {
    const events: AuditRecord[] = []
    const guard = createGuard({
      policy: definePolicy({
        entitySet: '0.1',
        entities: { PHONE: ruleFor('tokenise'), EMAIL: { action: 'redact' } },
        allowlist: { exact: ['02-123-4567'] },
      }),
      onAudit: (e) => events.push(e),
    })
    guard.processSync('เบอร์ 0918887777 อีเมล a@b.co', { sessionId: 's' })
    guard.resolveSync('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send', sessionId: 's' })
    const json = (e: AuditRecord | undefined) => JSON.parse(JSON.stringify(e))
    const [loaded, scan, resolve] = events
    for (const e of events) expectValid(e)
    return { loaded: json(loaded), scan: json(scan), resolve: json(resolve) }
  }

  it('a field it does not know, at any depth — the way a real value would sneak in', () => {
    const { loaded, scan, resolve } = sample()
    expect(schemaAccepts({ ...scan, text: '0918887777' })).toBe(false)
    expect(schemaAccepts({ ...resolve, value: '0918887777' })).toBe(false)
    scan.findings[0].value = '0918887777'
    expect(schemaAccepts(scan)).toBe(false)
    loaded.policy.allowlist.raw = ['02-123-4567']
    expect(schemaAccepts(loaded)).toBe(false)
  })

  it('an allowlist entry that is not a digest', () => {
    const { loaded } = sample()
    loaded.policy.allowlist.exact = ['02-123-4567']
    expect(schemaAccepts(loaded)).toBe(false)
  })

  it('another schemaVersion or type', () => {
    const { scan } = sample()
    expect(schemaAccepts({ ...scan, schemaVersion: '1.1' })).toBe(false)
    expect(schemaAccepts({ ...scan, type: 'scan.v2' })).toBe(false)
  })

  it('token fields on a finding that did not tokenise', () => {
    const { scan } = sample()
    const email = scan.findings.find((f: { entity: EntityType }) => f.entity === 'EMAIL')
    email.tokenId = 'bbbbbbbbbbbbbbbb'
    email.ttlSec = 300
    email.allowedPurposes = ['otp_send']
    expect(schemaAccepts(scan)).toBe(false)
  })

  it('rendered on a scan that was not outbound', () => {
    const { scan } = sample()
    expect(
      schemaAccepts({ ...scan, rendered: [{ kind: 'hash', entity: 'PHONE', as: 'placeholder' }] }),
    ).toBe(false)
  })

  it('a resolve that was allowed but gives a reason, or denied without one', () => {
    const { resolve } = sample()
    expect(resolve.outcome).toBe('denied')
    const { reason: _, ...noReason } = resolve
    expect(schemaAccepts(noReason)).toBe(false)
    expect(schemaAccepts({ ...resolve, outcome: 'allowed', entity: 'PHONE' })).toBe(false)
  })

  it('a token id that could be a number', () => {
    const { resolve } = sample()
    expect(schemaAccepts({ ...resolve, tokenId: '0918887777' })).toBe(false)
  })
})
