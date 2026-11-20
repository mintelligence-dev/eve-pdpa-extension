import { describe, expect, it } from 'vitest'
import { PdpaError } from '../src/errors.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import { createMemoryTokenStore } from '../src/tokens/memory-store.js'
import type {
  AuditEvent,
  AuditRecord,
  Candidate,
  Detector,
  GuardOptions,
  PolicyInput,
} from '../src/types.js'

/** A guard and the scan events it wrote. */
function build(policy: PolicyInput, extra: Partial<GuardOptions> = {}) {
  const events: AuditRecord[] = []
  const guard = createGuard({
    policy: definePolicy(policy),
    onAudit: (e) => events.push(e),
    ...extra,
  })
  const lastScan = () => events.filter((e): e is AuditEvent => e.type === 'scan').at(-1)
  return { guard, events, lastScan }
}

const TOKENISE = { action: 'tokenise', allowedPurposes: ['otp_send'] } as const

describe('every event carries timestamp, not at', () => {
  it('scan, policy.loaded and token.resolve', () => {
    const { guard, events } = build({ entitySet: '0.1', entities: { PHONE: TOKENISE } })
    guard.processSync('เบอร์ 0918887777', { sessionId: 's' })
    guard.resolveSync('[tok:bbbbbbbbbbbbbbbb]', { purpose: 'otp_send', sessionId: 's' })
    expect(events.map((e) => e.type)).toEqual(['policy.loaded', 'scan', 'token.resolve'])
    for (const e of events) {
      expect(e.schemaVersion).toBe('2.0')
      expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect('at' in e).toBe(false)
    }
  })
})

describe('result says what happened to each value', () => {
  it('applied, for every action that ran', () => {
    const { guard, lastScan } = build({
      entitySet: '0.1',
      entities: { PHONE: { action: 'mask' }, EMAIL: { action: 'flag' } },
    })
    guard.processSync('เบอร์ 0918887777 อีเมล somchai@example.com')
    expect(lastScan()?.findings.map((f) => [f.entity, f.action, f.result])).toEqual([
      ['PHONE', 'mask', 'applied'],
      ['EMAIL', 'flag', 'applied'],
    ])
  })

  it('allowlisted: the action named, not carried out', () => {
    const { guard, lastScan } = build({
      entitySet: '0.1',
      entities: { PHONE: TOKENISE },
      allowlist: { exact: ['02-123-4567'] },
    })
    const r = guard.processSync('ร้าน 02-123-4567', { sessionId: 's' })
    expect(r.text).toBe('ร้าน 02-123-4567')
    const f = lastScan()?.findings[0]
    expect([f?.action, f?.result, f?.allowlisted]).toEqual(['tokenise', 'allowlisted', true])
  })

  it('failed: the token store refused, so the message was blocked', () => {
    const { guard, lastScan } = build(
      { entitySet: '0.1', entities: { PHONE: TOKENISE } },
      { tokenStore: createMemoryTokenStore({ maxTokens: 0 }) },
    )
    expect(guard.processSync('เบอร์ 0918887777', { sessionId: 's' }).outcome).toBe('blocked')
    expect(lastScan()?.findings[0]?.result).toBe('failed')
  })

  it('widened: two overlapping values hidden as one span, tokenise turned redact', () => {
    const script: Candidate[] = [
      { entity: 'PHONE', start: 0, end: 10, confidence: 0.99, detector: '' },
      { entity: 'BANK_ACCOUNT', start: 5, end: 15, confidence: 0.99, detector: '' },
    ]
    const scripted: Detector = {
      id: 'scripted',
      entities: ['PHONE', 'BANK_ACCOUNT'],
      detect: () => script,
    }
    const { guard, lastScan } = build(
      { entitySet: '0.1', entities: { PHONE: TOKENISE, BANK_ACCOUNT: { action: 'redact' } } },
      { detectors: [scripted] },
    )
    guard.processSync('x'.repeat(20), { sessionId: 's' })
    const f = lastScan()?.findings
    expect(f).toHaveLength(1)
    expect([f?.[0]?.start, f?.[0]?.end, f?.[0]?.action, f?.[0]?.result]).toEqual([
      0,
      15,
      'redact',
      'widened',
    ])
  })
})

describe('belowThreshold counts what was read too weakly to act on', () => {
  it('per type, only when there is some', () => {
    const { guard, lastScan } = build({ entitySet: '0.1', entities: {} })
    guard.processSync('บัตร 3-1005-00123-45-9 บัตรเครดิต 9111 1111 1111 1110')
    expect(lastScan()?.belowThreshold).toEqual({ TH_NATIONAL_ID: 1, CREDIT_CARD: 1 })
    guard.processSync('สวัสดีค่ะ')
    expect(lastScan()?.belowThreshold).toBeUndefined()
  })

  it('a lowered threshold acts instead of counting', () => {
    const { guard, lastScan } = build({
      entitySet: '0.1',
      entities: { CREDIT_CARD: { action: 'redact', minConfidence: 0.6 } },
    })
    guard.processSync('บัตรเครดิต 9111 1111 1111 1110')
    expect(lastScan()?.belowThreshold).toBeUndefined()
    expect(lastScan()?.findings[0]?.result).toBe('applied')
  })

  it('not for a type the policy ignores', () => {
    const { guard, lastScan } = build({
      entitySet: '0.1',
      onUnmapped: 'ignore',
      entities: { PHONE: { action: 'redact' } },
    })
    guard.processSync('บัตรเครดิต 9111 1111 1111 1110')
    expect(lastScan()?.belowThreshold).toBeUndefined()
  })
})

describe('blockedBy and errorCode say why', () => {
  it('blockedBy lists the types that stopped the message, in reading order, once each', () => {
    const { guard, lastScan } = build({
      entitySet: '0.1',
      entities: { EMAIL: { action: 'block' }, PHONE: { action: 'block' } },
    })
    const r = guard.processSync('a@example.com 0918887777 b@example.com')
    expect(r.blockedBy).toEqual(['EMAIL', 'PHONE'])
    expect(lastScan()?.blockedBy).toEqual(['EMAIL', 'PHONE'])
  })

  it('no blockedBy on a message that went through', () => {
    const { guard, lastScan } = build({ entitySet: '0.1', entities: {} })
    guard.processSync('เบอร์ 0918887777')
    expect(lastScan()?.outcome).toBe('processed')
    expect(lastScan()?.blockedBy).toBeUndefined()
  })

  it('errorCode is the PdpaError code, never its message', () => {
    const { guard, lastScan } = build(
      { entitySet: '0.1', entities: { PHONE: TOKENISE } },
      {
        tokenStore: {
          sync: false,
          set: async () => {},
          get: async () => undefined,
          delete: async () => {},
          clearSession: async () => {},
        },
      },
    )
    expect(() => guard.processSync('เบอร์ 0918887777')).toThrow(PdpaError)
    const e = lastScan()
    expect([e?.outcome, e?.errorCode]).toEqual(['error', 'ERR_PDPA_ASYNC_STORE'])
    expect(JSON.stringify(e)).not.toContain('0918887777')
  })

  it('errorCode is unexpected for an error that is not a PdpaError', async () => {
    const { guard, lastScan } = build({ entitySet: '0.1', entities: {} })
    // Not a string: the guard fails on it with a plain TypeError.
    await expect(guard.process(42 as unknown as string)).rejects.toThrow(TypeError)
    const e = lastScan()
    expect([e?.outcome, e?.errorCode]).toEqual(['error', 'unexpected'])
  })
})
