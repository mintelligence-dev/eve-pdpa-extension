import { describe, expect, it } from 'vitest'
import { maskValue } from '../src/actions/mask.js'
import { createGuard } from '../src/guard.js'
import { definePolicy } from '../src/policy.js'
import type { AuditEvent, AuditRecord, PolicyInput, TokenRecord, TokenStore } from '../src/types.js'

// D20: what the user benchmark found in the guard's handling of its own input,
// its audit trail and the policy it was given (13 Oct).

const PHONES: PolicyInput = { entitySet: '0.1', entities: { PHONE: { action: 'redact' } } }
const TOKENS: PolicyInput = {
  entitySet: '0.1',
  entities: { PHONE: { action: 'tokenise', allowedPurposes: ['otp_send'], display: 'mask' } },
}
const invalid = expect.objectContaining({ code: 'ERR_PDPA_INVALID_INPUT' })

function withAudit(input: PolicyInput, tokenStore?: TokenStore) {
  const events: AuditRecord[] = []
  const guard = createGuard({
    policy: definePolicy(input),
    onAudit: (e) => events.push(e),
    ...(tokenStore === undefined ? {} : { tokenStore }),
  })
  const scans = () => events.filter((e): e is AuditEvent => e.type === 'scan')
  return { guard, scans }
}

describe('audit event ids', () => {
  it('stay distinct under a policy that does not tokenise', () => {
    const { guard, scans } = withAudit(PHONES)
    for (let i = 0; i < 200; i++) guard.processSync('โทร 0812345678')
    expect(new Set(scans().map((e) => e.eventId)).size).toBe(200)
  })
})

describe('a call that throws', () => {
  it('is on record as outcome "error", with no text and no values', () => {
    const { guard, scans } = withAudit(TOKENS)
    expect(() => guard.processSync('เบอร์ 0918887777')).toThrow(
      expect.objectContaining({ code: 'ERR_PDPA_NO_SESSION' }),
    )
    const [event, ...rest] = scans()
    expect(rest).toEqual([])
    expect(event).toMatchObject({ outcome: 'error', sessionId: 'anonymous', findings: [] })
    expect(JSON.stringify(event)).not.toContain('0918887777')
  })

  it('is recorded by process too', async () => {
    const { guard, scans } = withAudit(TOKENS)
    await expect(guard.process('เบอร์ 0918887777')).rejects.toThrow()
    expect(scans().map((e) => e.outcome)).toEqual(['error'])
  })
})

describe('input the guard refuses', () => {
  it('a boundary that is not one of the five, with no event written for it', () => {
    const { guard, scans } = withAudit(PHONES)
    expect(() =>
      guard.processSync('โทร 0812345678', { boundary: 'Outbound' as unknown as 'outbound' }),
    ).toThrow(invalid)
    expect(scans()).toEqual([])
  })
})

describe('the policy a guard is given', () => {
  it('must be the one definePolicy returned, not a copy changed by spread', () => {
    const policy = definePolicy(PHONES)
    const changed = { ...policy, entities: {} } as typeof policy
    expect(() => createGuard({ policy: changed, onAudit: () => {} })).toThrow(/used as returned/)
    expect(() => createGuard({ policy, onAudit: () => {} })).not.toThrow()
  })

  it('does not change when the object it was built from does', () => {
    const input = { entitySet: '0.1', entities: { PHONE: { action: 'redact' as const } } }
    const policy = definePolicy(input)
    ;(input.entities.PHONE as { action: string }).action = 'flag'
    expect(policy.entities.PHONE?.action).toBe('redact')
    expect(Object.isFrozen(policy.entities)).toBe(true)
  })
})

describe('an expired token in a reply', () => {
  it('reads as one the guard does not hold, even while the store still has it', () => {
    // A store that never sweeps, as a host's own store may not.
    const records = new Map<string, TokenRecord>()
    const store: TokenStore = {
      sync: true,
      set: (id, rec) => void records.set(id, rec),
      get: (id) => records.get(id),
      delete: (id) => void records.delete(id),
      clearSession: () => {},
    }
    const { guard } = withAudit(TOKENS, store)
    const tok = /\[tok:[a-z]{16}\]/.exec(
      guard.processSync('เบอร์ 0918887777', { sessionId: 'conv_a' }).text,
    )?.[0] as string
    for (const [id, rec] of records) records.set(id, { ...rec, expiresAt: Date.now() - 1 })

    const r = guard.processSync(`ส่งไปที่ ${tok}`, { sessionId: 'conv_a', boundary: 'outbound' })
    expect(r.text).toBe('ส่งไปที่ [ข้อมูลที่ปิดไว้]')
  })
})

describe('mask keep: "first2last4"', () => {
  it('keeps the first two and the last four, as the Notion example does', () => {
    expect(maskValue('091-888-7777', 'first2last4')).toBe('09x-xxx-7777')
    expect(maskValue('๐๙๑๘๘๘๗๗๗๗', 'first2last4')).toBe('๐๙xxxx๗๗๗๗')
  })

  it('hides everything when nothing would be left hidden', () => {
    expect(maskValue('123456', 'first2last4')).toBe('xxxxxx')
    expect(maskValue('1234567', 'first2last4')).toBe('12x4567')
  })

  it('is accepted by a policy and applied by the guard', () => {
    const guard = createGuard({
      policy: definePolicy({
        entitySet: '0.1',
        entities: { PHONE: { action: 'mask', keep: 'first2last4' } },
      }),
      onAudit: () => {},
    })
    expect(guard.processSync('เบอร์ 091-888-7777 ค่ะ').text).toBe('เบอร์ 09x-xxx-7777 ค่ะ')
  })
})
